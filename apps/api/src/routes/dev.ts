/**
 * 开发测试接口（仅在 NODE_ENV !== 'production' 时启用）
 * 用于跳过微信认证，直接测试核心 AI 链路
 */
import type { FastifyInstance } from 'fastify'
import { db, users, conversations, knowledgeItems, knowledgeCards } from '@ikr/db'
import { eq } from '@ikr/db'
import { agentRuntime } from '../agent/runtime.js'
import { getSession, setSession } from '../lib/redis.js'
import { digestQueue } from '../lib/queue.js'
import { userService } from '../services/user.service.js'
import { fetchUrlContent } from '../services/fetch-content.service.js'
import type { SessionState } from '@ikr/shared'

export async function devRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV === 'production') return

  app.log.warn('⚠️  Dev routes enabled — disable in production')

  // ─── 创建测试用户并返回 token ──────────────────────────
  app.post('/dev/user', async () => {
    const testOpenid = `dev_${Date.now()}`
    const user = await userService.findOrCreateByServiceOpenid(testOpenid)
    const token = app.jwt.sign({ userId: user.id }, { expiresIn: '7d' })
    return { userId: user.id, token, openid: testOpenid }
  })

  // ─── 直接提问（跳过微信）──────────────────────────────
  app.post('/dev/chat', async (req, reply) => {
    const { userId, query, conversationId } = req.body as {
      userId: string
      query: string
      conversationId?: string
    }

    if (!userId || !query) {
      return reply.status(400).send({ error: 'userId and query are required' })
    }

    // 获取或创建对话
    let convId = conversationId
    if (!convId) {
      const [conv] = await db.insert(conversations)
        .values({ userId, channel: 'web' })
        .returning()
      convId = conv.id
    }

    // 获取或创建会话状态
    let session = await getSession(`conv:${convId}`)
    if (!session) {
      session = {
        conversationId: convId,
        mode: 'decision',
        history: [],
        lastActiveAt: Date.now()
      } as SessionState
    }

    const result = await agentRuntime.chat({
      userId,
      query,
      session,
      channel: 'web'
    })

    // 更新会话
    result.updatedSession.history.push(
      { role: 'user', content: query },
      { role: 'assistant', content: result.text }
    )
    if (result.updatedSession.history.length > 20) {
      result.updatedSession.history = result.updatedSession.history.slice(-20)
    }
    result.updatedSession.lastActiveAt = Date.now()
    await setSession(`conv:${convId}`, result.updatedSession)

    return {
      answer: result.text,
      mode: result.updatedSession.mode,
      conversationId: convId
    }
  })

  // ─── 通过 URL 收录（自动抓取正文）────────────────────
  app.post('/dev/ingest-url', async (req, reply) => {
    const { userId, url } = req.body as { userId: string; url: string }

    if (!userId || !url) {
      return reply.status(400).send({ error: 'userId and url are required' })
    }

    // 验证 URL 格式
    try { new URL(url) } catch {
      return reply.status(400).send({ error: '无效的 URL 格式' })
    }

    try {
      const fetched = await fetchUrlContent(url)
      await digestQueue.add('digest', {
        userId,
        url,
        title: fetched.title,
        description: fetched.content,
        openid: `dev_user_${userId}`
      })
      return { message: `已收录《${fetched.title}》，正在消化...`, title: fetched.title }
    } catch (err: any) {
      if (err.message === 'CONTENT_TOO_SHORT') {
        return reply.status(422).send({ error: '页面内容太少，无法提取有效文章' })
      }
      return reply.status(422).send({ error: `抓取失败：${err.message}` })
    }
  })

  // ─── 直接收录文章文本（跳过微信）──────────────────────
  app.post('/dev/ingest', async (req, reply) => {
    const { userId, url, title, content } = req.body as {
      userId: string
      url?: string
      title: string
      content: string
    }

    if (!userId || !title || !content) {
      return reply.status(400).send({ error: 'userId, title and content are required' })
    }

    await digestQueue.add('digest', {
      userId,
      url: url || `dev://${Date.now()}`,
      title,
      description: content,
      openid: `dev_user_${userId}`
    })

    return { message: `已加入消化队列，标题：${title}` }
  })

  // ─── 查看知识库 ────────────────────────────────────────
  app.get('/dev/library/:userId', async (req) => {
    const { userId } = req.params as { userId: string }
    const items = await db.query.knowledgeItems.findMany({
      where: eq(knowledgeItems.userId, userId),
      limit: 20
    })
    const cardCount = await db
      .select()
      .from(knowledgeCards)
      .where(eq(knowledgeCards.userId, userId))
    return {
      itemCount: items.length,
      cardCount: cardCount.length,
      items: items.map(i => ({
        id: i.id,
        title: i.title,
        status: i.status,
        type: i.primaryType,
        points: (i.summary as any)?.points?.slice(0, 2)
      }))
    }
  })
}
