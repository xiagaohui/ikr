import { Queue } from 'bullmq'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connectionOpts = { url: redisUrl }

// ─── 内容消化队列 ──────────────────────────────────────────
export const digestQueue = new Queue('content-digest', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  }
})

// ─── 画像更新队列 ──────────────────────────────────────────
export const profileQueue = new Queue('profile-update', {
  connection: connectionOpts,
  defaultJobOptions: { attempts: 2 }
})

// ─── 微信对话队列（替代 setImmediate，提供重试保证）────────
export const wechatChatQueue = new Queue('wechat-chat', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 }
  }
})

export const queueConnection = connectionOpts
