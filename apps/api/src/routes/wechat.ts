import type { FastifyInstance } from 'fastify'
import {
  verifySignature, parseWechatXml, buildTextReply,
} from '../channels/wechat.js'
import { digestQueue } from '../lib/queue.js'
import { userService } from '../services/user.service.js'
import { agentRuntime } from '../agent/runtime.js'
import { getSession, setSession } from '../lib/redis.js'
import { db, conversations } from '@ikr/db'
import type { SessionState } from '@ikr/shared'

const WECHAT_APP_ID = process.env.WECHAT_APP_ID || ''

export async function wechatRoutes(app: FastifyInstance) {

  // ─── 服务号验证（GET）────────────────────────────────────
  app.get('/callback', async (req, reply) => {
    const { signature, timestamp, nonce, echostr } = req.query as Record<string, string>
    if (verifySignature(signature, timestamp, nonce)) {
      return reply.send(echostr)
    }
    return reply.status(403).send('Forbidden')
  })

  // ─── 消息接收（POST）─────────────────────────────────────
  app.post('/callback', async (req, reply) => {
    const { signature, timestamp, nonce } = req.query as Record<string, string>

    if (!verifySignature(signature, timestamp, nonce)) {
      return reply.status(403).send('Forbidden')
    }

    const xml = req.body as string
    const message = await parseWechatXml(xml)
    const openid = message.fromUserName

    // ─── 关注事件 ──────────────────────────────────────────
    if (message.msgType === 'event' && message.event === 'subscribe') {
      await userService.findOrCreateByServiceOpenid(openid)
      return reply.type('text/xml').send(
        buildTextReply(openid, WECHAT_APP_ID,
          '欢迎使用 IKR 智慧知识库！\n\n' +
          '📚 转发文章给我，我帮你自动消化提炼\n' +
          '💡 遇到问题直接问我，我基于你的知识库给出可实操的建议\n\n' +
          '开始吧，把你想收藏的文章转发过来！'
        )
      )
    }

    // ─── 文章链接收录 ──────────────────────────────────────
    if (message.msgType === 'link' && message.url) {
      const user = await userService.findOrCreateByServiceOpenid(openid)
      await digestQueue.add('digest', {
        userId: user.id,
        url: message.url,
        title: message.title,
        description: message.description,
        openid
      })
      return reply.type('text/xml').send(
        buildTextReply(openid, WECHAT_APP_ID,
          `✅ 已收录《${message.title || '文章'}》\n正在消化，约30秒后完成，之后可以直接提问。`
        )
      )
    }

    // ─── 文字消息（同步处理，5秒内直接回复）──────────────
    if (message.msgType === 'text' && message.content) {
      const query = message.content.trim()

      try {
        const user = await userService.findOrCreateByServiceOpenid(openid)

        // 获取或创建会话
        let session = await getSession(openid)
        if (!session) {
          const [conv] = await db.insert(conversations)
            .values({ userId: user.id, channel: 'wechat_service_account' })
            .returning()
          session = {
            conversationId: conv.id,
            mode: 'decision',
            history: [],
            lastActiveAt: Date.now()
          } as SessionState
        }

        // 同步调用 AI（需在 5 秒内完成）
        const result = await agentRuntime.chat({
          userId: user.id,
          query,
          session,
          channel: 'wechat_service_account'
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
        await setSession(openid, result.updatedSession)

        // 截断超长回复（微信单条消息限制 2048 字节）
        let replyText = result.text
        if (Buffer.byteLength(replyText, 'utf8') > 2000) {
          replyText = replyText.slice(0, 600) + '\n\n...(内容较长，建议访问网页版查看完整回答)'
        }

        return reply.type('text/xml').send(
          buildTextReply(openid, WECHAT_APP_ID, replyText)
        )
      } catch (err) {
        console.error('[wechat] chat error:', err)
        return reply.type('text/xml').send(
          buildTextReply(openid, WECHAT_APP_ID, '处理超时，请稍后重试。复杂问题建议访问网页版。')
        )
      }
    }

    return reply.type('text/xml').send('<xml></xml>')
  })
}
