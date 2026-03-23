import type { FastifyInstance } from 'fastify'
import { db, knowledgeItems, knowledgeCards } from '@ikr/db'
import { eq, desc, count } from '@ikr/db'

export async function itemsRoutes(app: FastifyInstance) {

  // 获取知识库列表
  app.get('/', async (req) => {
    const userId = (req as any).userId
    const items = await db.query.knowledgeItems.findMany({
      where: eq(knowledgeItems.userId, userId),
      orderBy: desc(knowledgeItems.createdAt),
      limit: 50
    })
    return { items }
  })

  // 获取单条详情（含知识卡片）
  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string }
    const item = await db.query.knowledgeItems.findFirst({
      where: eq(knowledgeItems.id, id)
    })
    const cards = await db.query.knowledgeCards.findMany({
      where: eq(knowledgeCards.itemId, id)
    })
    return { item, cards }
  })
}
