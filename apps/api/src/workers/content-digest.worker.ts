import { Worker } from 'bullmq'
import { eq } from '@ikr/db'
import { queueConnection, profileQueue } from '../lib/queue.js'
import { db, knowledgeItems, knowledgeCards } from '@ikr/db'
import { classifyContent, digestContent, embedBatch } from '@ikr/ai'
import { sendCustomerServiceMessage } from '../channels/wechat.js'
import { userService } from '../services/user.service.js'

export const digestWorker = new Worker('content-digest', async (job) => {
  const { userId, url, title, description, openid } = job.data

  console.log(`[digest] Starting for user=${userId} url=${url}`)

  // ─── 1. 获取内容 ───────────────────────────────────────
  // Phase 0：使用 description 字段（文章摘要）
  // Phase 1：小程序 WebView 提取正文后传入
  const content = description || title || ''

  if (!content || content.length < 50) {
    console.warn(`[digest] Content too short, skipping: ${url}`)
    await sendCustomerServiceMessage(openid,
      `《${title}》内容较短，无法深度消化。\n` +
      `建议在小程序中打开原文后重新收录，可获得完整分析。`
    )
    return
  }

  // ─── 2. 写入知识条目（processing 状态）────────────────
  const [item] = await db.insert(knowledgeItems).values({
    userId,
    url,
    title,
    source: 'wechat_mp',
    rawContent: content,
    status: 'processing'
  }).returning()

  try {
    // ─── 3. 内容分类 ──────────────────────────────────────
    const classification = await classifyContent(content)
    console.log(`[digest] Classified as: ${classification.primaryType}`)

    // ─── 4. 分类型消化（摘要 + 知识卡片）────────────────
    const digestResult = await digestContent(
      content,
      classification.primaryType,
      classification.secondaryTypes
    )

    // ─── 5. 向量嵌入（批量）──────────────────────────────
    const cardTexts = digestResult.cards.map(c => c.content)
    const embeddings = await embedBatch(cardTexts)

    // ─── 6. 写入知识卡片 ───────────────────────────────────
    if (digestResult.cards.length > 0) {
      await db.insert(knowledgeCards).values(
        digestResult.cards.map((card, i) => ({
          userId,
          itemId: item.id,
          content: card.content,
          sourceQuote: card.sourceQuote,
          cardType: card.cardType,
          typeMetadata: card.typeMetadata,
          isTimely: card.isTimely ?? false,
          dataPublishedAt: classification.publishedAt
            ? (() => { const d = new Date(classification.publishedAt!); return isNaN(d.getTime()) ? null : d })()
            : null,
          embedding: embeddings[i],
          retentionScore: 1.0
        }))
      )
    }

    // ─── 7. 更新条目状态 ───────────────────────────────────
    await db.update(knowledgeItems)
      .set({
        primaryType: classification.primaryType,
        summary: digestResult.summary,
        status: 'done'
      })
      .where(eq(knowledgeItems.id, item.id))

    // ─── 8. 触发画像更新（异步）──────────────────────────
    await profileQueue.add('update-profile', { userId }, {
      jobId: `profile-${userId}`,  // 相同 jobId 会去重
      delay: 5000
    })

    // ─── 9. 推送消化完成通知 ──────────────────────────────
    const cardCount = digestResult.cards.length
    const points = digestResult.summary.points.slice(0, 3)
    const pointsText = points.map((p, i) => `${i + 1}. ${p}`).join('\n')
    const timelyWarning = classification.hasTimelyData
      ? '\n⚠️ 含时效性数据，使用时注意时间' : ''

    await sendCustomerServiceMessage(openid,
      `📚《${title}》消化完毕\n\n` +
      `提炼了 ${cardCount} 个知识点：\n${pointsText}\n` +
      `${timelyWarning}\n\n` +
      `遇到相关问题，直接问我就好。`
    )

    console.log(`[digest] Done for item=${item.id}, cards=${cardCount}`)

  } catch (err) {
    // 更新失败状态
    await db.update(knowledgeItems)
      .set({ status: 'failed' })
      .where(eq(knowledgeItems.id, item.id))

    await sendCustomerServiceMessage(openid,
      `《${title}》消化时出现问题，请稍后重试。`
    )

    throw err  // BullMQ 会自动重试
  }
}, { connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' }, concurrency: 3 })

digestWorker.on('failed', (job, err) => {
  console.error(`[digest] Job ${job?.id} failed:`, err.message, err.stack)
})
