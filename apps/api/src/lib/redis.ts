import { Redis } from 'ioredis'
import type { SessionState } from '@ikr/shared'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
export const redis = new Redis(redisUrl)

const SESSION_TTL = 30 * 60  // 30 分钟

// ─── 会话管理 ────────────────────────────────────────────
export async function getSession(openid: string): Promise<SessionState | null> {
  const data = await redis.get(`session:${openid}`)
  if (!data) return null
  return JSON.parse(data) as SessionState
}

export async function setSession(openid: string, state: SessionState): Promise<void> {
  await redis.setex(`session:${openid}`, SESSION_TTL, JSON.stringify(state))
}

export async function deleteSession(openid: string): Promise<void> {
  await redis.del(`session:${openid}`)
}

// ─── 用户画像缓存 ─────────────────────────────────────────
export async function getProfileCache(userId: string): Promise<string | null> {
  return redis.get(`profile:${userId}`)
}

export async function setProfileCache(userId: string, profile: string): Promise<void> {
  await redis.setex(`profile:${userId}`, 60 * 60 * 24, profile)  // 24小时
}
