import { Worker } from 'bullmq'
import { db, knowledgeItems } from '@ikr/db'
import { eq, desc } from '@ikr/db'
import { client, MODELS } from '@ikr/ai'
import { userService } from '../services/user.service.js'
import { setProfileCache } from '../lib/redis.js'

export const profileWorker = new Worker('profile-update', async (job) => {
  const { userId } = job.data

  // 取最近 50 篇知识条目的摘要
  const recentItems = await db.query.knowledgeItems.findMany({
    where: eq(knowledgeItems.userId, userId),
    orderBy: desc(knowledgeItems.createdAt),
    limit: 50,
    columns: { title: true, summary: true, primaryType: true, createdAt: true }
  })

  if (recentItems.length < 3) return  // 内容太少，不推断

  const itemsText = recentItems.map(item =>
    `- ${item.title}（${item.primaryType}类型）`
  ).join('\n')

  const response = await client.chat.completions.create({
    model: MODELS.fast,
    max_tokens: 512,
    messages: [
      {
        role: 'system',
        content: '你是用户画像分析专家。根据用户收录的内容，推断用户的背景和关注点。输出 Markdown 格式的画像文件，包含：行业领域、职能角色、所处阶段、近期关注点、知识积累深度。保持简洁，每项不超过一行。'
      },
      {
        role: 'user',
        content: `用户最近收录的内容：\n${itemsText}\n\n请推断用户画像。`
      }
    ]
  })

  const profileContent = response.choices[0]?.message?.content || ''

  const fullProfile = `# 认知画像\n更新时间：${new Date().toISOString().split('T')[0]}\n\n${profileContent}`

  // 写入 Workspace 文件
  await userService.setWorkspaceFile(userId, 'PROFILE.md', fullProfile)
  // 同步更新 Redis 缓存
  await setProfileCache(userId, fullProfile)

  console.log(`[profile] Updated for user=${userId}`)
}, { connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' }, concurrency: 5 })
