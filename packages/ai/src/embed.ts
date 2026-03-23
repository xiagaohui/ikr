// Ollama nomic-embed-text 维度为 768
export const EMBEDDING_DIMENSIONS = 768

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: text.slice(0, 8000),
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.status} ${await response.text()}`)
  }

  const data = await response.json() as { embedding: number[] }
  return data.embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // 批量处理，每批最多 5 个，保证顺序
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += 5) {
    const batch = texts.slice(i, i + 5)
    const embeddings = await Promise.all(batch.map(embed))
    results.push(...embeddings)
  }
  return results
}
