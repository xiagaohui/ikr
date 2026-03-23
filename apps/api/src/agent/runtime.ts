import { client, MODELS } from '@ikr/ai'
import { db, knowledgeCards, messages, conversations } from '@ikr/db'
import { eq, count, sql } from '@ikr/db'
import { buildSystemPrompt } from './prompt-builder.js'
import { hybridSearch, detectQueryIntent, activateCards } from './knowledge-retrieval.js'
import { getProfileCache } from '../lib/redis.js'
import { userService } from '../services/user.service.js'
import type { SessionState } from '@ikr/shared'

interface ChatInput {
  userId: string
  query: string
  session: SessionState
  channel: string
}

interface ChatOutput {
  text: string
  updatedSession: SessionState
}

export const agentRuntime = {

  async chat(input: ChatInput): Promise<ChatOutput> {
    const { userId, query, session, channel } = input

    // ─── 检测模式切换指令 ──────────────────────────────────
    const updatedSession = handleModeSwitch(query, session)
    const currentMode = updatedSession.mode

    // ─── 加载用户 Workspace ────────────────────────────────
    const [userProfile, userMemory] = await Promise.all([
      getProfileCache(userId).then(cache =>
        cache || userService.getWorkspaceFile(userId, 'PROFILE.md')
      ),
      userService.getWorkspaceFile(userId, 'MEMORY.md')
    ])

    // ─── 获取知识库卡片总数（冷启动判断）─────────────────
    const countResult = await db
      .select({ value: count() })
      .from(knowledgeCards)
      .where(eq(knowledgeCards.userId, userId))
    const cardCount = countResult[0]?.value ?? 0

    // ─── 语义检索相关卡片 ──────────────────────────────────
    const queryIntent = detectQueryIntent(query)
    const retrievedCards = await hybridSearch(userId, query, {
      limit: 8,
      mode: currentMode,
      queryIntent
    })

    // ─── 组装 System Prompt ────────────────────────────────
    const systemPrompt = buildSystemPrompt({
      userProfile: userProfile || '',
      userMemory: userMemory || '',
      retrievedCards,
      session: updatedSession,
      channel,
      cardCount: Number(cardCount)
    })

    // ─── 构建对话历史 ──────────────────────────────────────
    const historyMessages = updatedSession.history.map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content
    }))

    // ─── 调用智谱 AI ───────────────────────────────────────
    const response = await client.chat.completions.create({
      model: MODELS.main,
      max_tokens: channel === 'wechat_service_account' ? 800 : 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: query }
      ]
    })

    const raw = response.choices[0]?.message?.content || ''
    // 过滤推理模型的 <think> 标签
    const responseText = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    // ─── 更新知识卡片激活时间（留存调度）─────────────────
    const usedCardIds = retrievedCards.map(c => c.id)
    await activateCards(usedCardIds)

    // ─── 写入消息记录 ──────────────────────────────────────
    // 分开插入：user 消息无 cardsUsed，assistant 消息单独处理数组类型
    await db.insert(messages).values({
      conversationId: updatedSession.conversationId,
      role: 'user',
      content: query
    })

    if (usedCardIds.length > 0) {
      const uuidArray = `{${usedCardIds.join(',')}}`
      await db.execute(sql`
        INSERT INTO messages (conversation_id, role, content, cards_used)
        VALUES (
          ${updatedSession.conversationId}::uuid,
          'assistant',
          ${responseText},
          ${uuidArray}::uuid[]
        )
      `)
    } else {
      await db.insert(messages).values({
        conversationId: updatedSession.conversationId,
        role: 'assistant',
        content: responseText
      })
    }

    // ─── 更新深度思考状态 ──────────────────────────────────
    if (currentMode === 'deep_thinking' && updatedSession.deepThinkingContext) {
      updatedSession.deepThinkingContext.thinkingStage += 1
      updatedSession.deepThinkingContext.userInsights.push(query)
    }

    // ─── 触发记忆 Flush（history 超过 16 轮时）────────────
    if (updatedSession.history.length >= 16) {
      triggerMemoryFlush(userId, updatedSession).catch(console.error)
    }

    return { text: responseText, updatedSession }
  }
}

// ─── 模式切换检测 ───────────────────────────────────────────
function handleModeSwitch(query: string, session: SessionState): SessionState {
  const q = query.trim().toLowerCase()

  if ((q === '深入' || q === '深入理解' || q === 'deep') &&
      session.mode === 'decision') {
    return {
      ...session,
      mode: 'deep_thinking',
      deepThinkingContext: {
        originalQuestion: query,  // 当前问题即为深度思考的起点
        thinkingStage: 0,
        userInsights: [],
        frameworksUsed: []
      }
    }
  }

  if ((q === '退出' || q === 'exit') && session.mode === 'deep_thinking') {
    const { deepThinkingContext: _, ...rest } = session
    return { ...rest, mode: 'decision' }
  }

  return session
}

// ─── 记忆 Flush（静默，用户无感知）──────────────────────────
async function triggerMemoryFlush(userId: string, session: SessionState) {
  const recentHistory = session.history.slice(-10)
  const historyText = recentHistory
    .map(h => `${h.role === 'user' ? '用户' : 'IKR'}: ${h.content}`)
    .join('\n')

  const response = await client.chat.completions.create({
    model: MODELS.fast,
    max_tokens: 256,
    messages: [
      {
        role: 'system',
        content: '从对话中提取值得长期记住的信息（用户的重要背景、决策、偏好）。用 Markdown 格式输出，简洁。如果没有值得记录的内容，只输出 NO_MEMORY。'
      },
      { role: 'user', content: `对话记录：\n${historyText}` }
    ]
  })

  const memoryText = response.choices[0]?.message?.content || ''

  if (memoryText === 'NO_MEMORY' || !memoryText.trim()) return

  const existing = await userService.getWorkspaceFile(userId, 'MEMORY.md') || ''
  const date = new Date().toISOString().split('T')[0]
  const updated = `${existing}\n\n## ${date}\n${memoryText}`

  await userService.setWorkspaceFile(userId, 'MEMORY.md', updated)
}
