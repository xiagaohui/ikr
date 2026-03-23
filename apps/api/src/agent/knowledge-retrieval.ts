import { db, knowledgeCards } from '@ikr/db'
import { embed } from '@ikr/ai'
import { eq, sql } from '@ikr/db'
import type { ContentType } from '@ikr/shared'

export interface RetrievedCard {
  id: string
  content: string
  sourceQuote: string | null
  cardType: string | null
  typeMetadata: unknown
  isTimely: boolean | null
  dataPublishedAt: Date | null
  itemTitle: string | null
  score: number
}

type QueryIntent = 'how_to' | 'why' | 'decision' | 'general'

// 类型权重配置
const TYPE_WEIGHTS: Record<QueryIntent, Record<ContentType, number>> = {
  how_to:   { operation: 1.5, argument: 1.0, fact: 0.8, narrative: 1.2 },
  why:      { argument: 1.5, narrative: 1.2, fact: 1.0, operation: 0.8 },
  decision: { argument: 1.3, operation: 1.3, narrative: 1.2, fact: 1.0 },
  general:  { argument: 1.0, operation: 1.0, fact: 1.0, narrative: 1.0 },
}

// 深度思考模式的检索权重（优先框架类）
const DEEP_THINKING_WEIGHTS: Record<ContentType, number> = {
  argument: 1.5, operation: 1.5, fact: 0.8, narrative: 1.0
}

export async function hybridSearch(
  userId: string,
  query: string,
  options: {
    limit?: number
    mode?: 'decision' | 'deep_thinking'
    queryIntent?: QueryIntent
  } = {}
): Promise<RetrievedCard[]> {
  const { limit = 10, mode = 'decision', queryIntent = 'general' } = options

  // 生成查询向量（失败时降级为纯 BM25 检索）
  let embeddingStr: string | null = null
  try {
    const queryEmbedding = await embed(query)
    embeddingStr = `[${queryEmbedding.join(',')}]`
  } catch (err) {
    console.warn('[retrieval] embedding failed, falling back to BM25 only:', (err as Error).message)
  }

  // 无向量时直接用 BM25 全文检索
  if (!embeddingStr) {
    return bm25Search(userId, query, limit)
  }

  const typeWeights = mode === 'deep_thinking'
    ? DEEP_THINKING_WEIGHTS
    : TYPE_WEIGHTS[queryIntent]

  // 混合检索：向量相似度 + BM25 全文检索 + 类型权重 + 留存优先
  // RRF 修正：用大值替代 NULL rank，而非用 0，避免只在一个索引中的结果被低估
  const results = await db.execute(sql`
    WITH vector_search AS (
      SELECT
        kc.id,
        kc.content,
        kc.source_quote,
        kc.card_type,
        kc.type_metadata,
        kc.is_timely,
        kc.data_published_at,
        kc.retention_score,
        ki.title as item_title,
        ROW_NUMBER() OVER (ORDER BY kc.embedding <=> ${embeddingStr}::vector) as vector_rank
      FROM knowledge_cards kc
      LEFT JOIN knowledge_items ki ON kc.item_id = ki.id
      WHERE kc.user_id = ${userId}::uuid
        AND kc.embedding IS NOT NULL
      ORDER BY kc.embedding <=> ${embeddingStr}::vector
      LIMIT 20
    ),
    bm25_search AS (
      SELECT
        kc.id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank(kc.search_vector, plainto_tsquery('simple', ${query})) DESC
        ) as bm25_rank
      FROM knowledge_cards kc
      WHERE kc.user_id = ${userId}::uuid
        AND kc.search_vector @@ plainto_tsquery('simple', ${query})
      LIMIT 20
    ),
    rrf AS (
      SELECT
        COALESCE(v.id, b.id) as id,
        (
          1.0 / (60 + COALESCE(v.vector_rank, 1000)) +
          1.0 / (60 + COALESCE(b.bm25_rank, 1000))
        ) as rrf_score
      FROM vector_search v
      FULL OUTER JOIN bm25_search b ON v.id = b.id
    )
    SELECT
      v.id, v.content, v.source_quote, v.card_type,
      v.type_metadata, v.is_timely, v.data_published_at,
      v.item_title,
      (
        r.rrf_score *
        CASE v.card_type
          WHEN 'argument'  THEN ${typeWeights.argument}::float
          WHEN 'operation' THEN ${typeWeights.operation}::float
          WHEN 'fact'      THEN ${typeWeights.fact}::float
          WHEN 'narrative' THEN ${typeWeights.narrative}::float
          ELSE 1.0
        END * 0.7 +
        (1.0 - COALESCE(v.retention_score, 1.0)) * 0.3
      ) as final_score
    FROM vector_search v
    JOIN rrf r ON v.id = r.id
    ORDER BY final_score DESC
    LIMIT ${limit}
  `)

  return (results as any[]).map(row => ({
    id: row.id,
    content: row.content,
    sourceQuote: row.source_quote,
    cardType: row.card_type,
    typeMetadata: row.type_metadata,
    isTimely: row.is_timely,
    dataPublishedAt: row.data_published_at,
    itemTitle: row.item_title,
    score: Number(row.final_score)
  }))
}

// 检测问题意图
export function detectQueryIntent(query: string): QueryIntent {
  const howToPatterns = /怎么|如何|怎样|步骤|方法|操作/
  const whyPatterns = /为什么|原因|为何|怎么会/
  const decisionPatterns = /应该|该怎么|建议|选择|决定|方向/

  if (howToPatterns.test(query)) return 'how_to'
  if (whyPatterns.test(query)) return 'why'
  if (decisionPatterns.test(query)) return 'decision'
  return 'general'
}

// 更新卡片激活时间（留存调度）
export async function activateCards(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return
  // 用字符串拼接构造 UUID 数组，避免 Drizzle 序列化问题
  const uuidArray = `{${cardIds.join(',')}}`
  await db.execute(sql`
    UPDATE knowledge_cards
    SET last_activated_at = NOW()
    WHERE id = ANY(${uuidArray}::uuid[])
  `)
}

// BM25 纯文本检索（embedding 不可用时的降级方案）
async function bm25Search(
  userId: string,
  query: string,
  limit: number
): Promise<RetrievedCard[]> {
  const results = await db.execute(sql`
    SELECT
      kc.id, kc.content, kc.source_quote, kc.card_type,
      kc.type_metadata, kc.is_timely, kc.data_published_at,
      kc.retention_score, ki.title as item_title,
      ts_rank(kc.search_vector, plainto_tsquery('simple', ${query})) as score
    FROM knowledge_cards kc
    LEFT JOIN knowledge_items ki ON kc.item_id = ki.id
    WHERE kc.user_id = ${userId}::uuid
      AND kc.search_vector @@ plainto_tsquery('simple', ${query})
    ORDER BY score DESC
    LIMIT ${limit}
  `)

  return (results as any[]).map(row => ({
    id: row.id,
    content: row.content,
    sourceQuote: row.source_quote,
    cardType: row.card_type,
    typeMetadata: row.type_metadata,
    isTimely: row.is_timely,
    dataPublishedAt: row.data_published_at,
    itemTitle: row.item_title,
    score: Number(row.score)
  }))
}
