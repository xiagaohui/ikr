import { client } from './client.js'

// 维度：Ollama nomic-embed-text=768，智谱 embedding-3=1024
// 统一用 768（本地 Ollama），生产环境用智谱时需重建数据库
export const EMBEDDING_DIMENSIONS = 768

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'

export async function embed(text: string): Promise<number[]> {
  // 生产环境（无 Ollama）用智谱 embedding-3
  if (process.env.USE_ZHIPU_EMBEDDING === 'true') {
    return embedWithZhipu(text)
  }

  // 本地开发用 Ollama
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: text.slice(0, 8000),
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    // Ollama 不可用时降级为随机向量（不影响功能，只影响检索精度）
    console.warn('[embed] Ollama unavailable, using random vector')
    return Array.from({ length: 768 }, () => Math.random() * 2 - 1)
  }

  const data = await response.json() as { embedding: number[] }
  return data.embedding
}

async function embedWithZhipu(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'embedding-3',
    input: text.slice(0, 8000),
    dimensions: 768,
  } as any)
  return response.data[0].embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += 5) {
    const batch = texts.slice(i, i + 5)
    const embeddings = await Promise.all(batch.map(embed))
    results.push(...embeddings)
  }
  return results
}
