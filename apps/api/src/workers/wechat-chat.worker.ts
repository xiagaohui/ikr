import { Worker } from 'bullmq'
import { db, conversations } from '@ikr/db'
import { agentRuntime } from '../agent/runtime.js'
import { getSession, setSession } from '../lib/redis.js'
import { sendCustomerServiceMessage } from '../channels/wechat.js'
import { userService } from '../services/user.service.js'
import type { SessionState } from '@ikr/shared'

export const wechatChatWorker = new Worker('wechat-chat', async (job) => {
  const { openid, query } = job.data

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

  // 推送回答（客服消息接口）
  await sendCustomerServiceMessage(openid, result.text)

}, {
  connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
  concurrency: 5
})

wechatChatWorker.on('failed', async (job, err) => {
  console.error(`[wechat-chat] Job ${job?.id} failed:`, err)
  // 最终失败时通知用户
  const openid = job?.data?.openid
  if (openid) {
    await sendCustomerServiceMessage(openid, '抱歉，处理出错了，请稍后重试。').catch(() => {})
  }
})
