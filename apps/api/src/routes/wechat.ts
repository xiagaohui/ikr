import type { FastifyInstance } from 'fastify'
import {
  verifySignature, parseWechatXml, buildTextReply,
} from '../channels/wechat.js'
import { digestQueue, wechatChatQueue } from '../lib/queue.js'
import { userService } from '../services/user.service.js'

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
      // 立即回复（< 1 秒）
      const quickReply = buildTextReply(openid, WECHAT_APP_ID,
        `✅ 已收录《${message.title || '文章'}》\n正在消化，稍后通知你...`
      )
      reply.type('text/xml').send(quickReply)

      // 异步消化
      const user = await userService.findOrCreateByServiceOpenid(openid)
      await digestQueue.add('digest', {
        userId: user.id,
        url: message.url,
        title: message.title,
        description: message.description,  // Phase 0 用摘要字段
        openid
      })

      return
    }

    // ─── 文字消息（对话）──────────────────────────────────
    if (message.msgType === 'text' && message.content) {
      const query = message.content.trim()

      // 立即回复占位（解决 5 秒限制）
      const thinkingReply = buildTextReply(openid, WECHAT_APP_ID, '收到，正在思考... ⏳')
      reply.type('text/xml').send(thinkingReply)

      // 推入队列异步处理，提供重试保证（替代 setImmediate）
      await wechatChatQueue.add('chat', { openid, query })

      return
    }

    // 其他消息类型，返回空响应
    return reply.type('text/xml').send('<xml></xml>')
  })
}

