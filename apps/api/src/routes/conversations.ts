import type { FastifyInstance } from 'fastify'
import { db, conversations, messages } from '@ikr/db'
import { eq, desc } from '@ikr/db'
import { agentRuntime } from '../agent/runtime.js'
import { getSession, setSession } from '../lib/redis.js'
import type { SessionState } from '@ikr/shared'

export async function conversationsRoutes(app: FastifyInstance) {

  // 创建对话（从 JWT 取 userId）
  app.post('/', async (req) => {
    const userId = (req as any).userId
    const { channel = 'wechat_miniprogram' } = req.body as any
    const [conv] = await db.insert(conversations)
      .values({ userId, channel })
      .returning()
    return { conversation: conv }
  })

  // 发送消息
  app.post('/:id/messages', async (req, reply) => {
    const { id: conversationId } = req.params as { id: string }
    const userId = (req as any).userId
    const { content } = req.body as { content: string }

    if (!content?.trim()) {
      return reply.status(400).send({ error: 'content is required' })
    }

    // 获取或创建会话状态
    let session = await getSession(`conv:${conversationId}`)
    if (!session) {
      session = {
        conversationId,
        mode: 'decision',
        history: [],
        lastActiveAt: Date.now()
      } as SessionState
    }

    let result
    try {
      result = await agentRuntime.chat({
        userId,
        query: content.trim(),
        session,
        channel: 'wechat_miniprogram'
      })
    } catch (err) {
      console.error('[chat] Error:', err)
      return reply.status(500).send({ error: 'AI processing failed' })
    }

    // 更新 Redis 会话历史
    result.updatedSession.history.push(
      { role: 'user', content: content.trim() },
      { role: 'assistant', content: result.text }
    )
    if (result.updatedSession.history.length > 20) {
      result.updatedSession.history = result.updatedSession.history.slice(-20)
    }
    result.updatedSession.lastActiveAt = Date.now()
    await setSession(`conv:${conversationId}`, result.updatedSession)

    return {
      message: result.text,
      mode: result.updatedSession.mode,
      conversationId
    }
  })

  // 获取对话历史
  app.get('/:id/messages', async (req) => {
    const { id } = req.params as { id: string }
    const msgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, id),
      orderBy: desc(messages.createdAt),
      limit: 50
    })
    return { messages: msgs.reverse() }
  })
}
