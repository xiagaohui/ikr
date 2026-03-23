import OpenAI from 'openai'

const apiKey = process.env.ZHIPU_API_KEY
if (!apiKey) throw new Error('ZHIPU_API_KEY is required')

// 智谱 AI 兼容 OpenAI 格式，直接指定 baseURL
export const client = new OpenAI({
  apiKey,
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
})

export const MODELS = {
  main: 'glm-z1-flash',  // 当前可用模型（充值后换 glm-5 或 glm-4-plus）
  fast: 'glm-4-flash',   // 轻量任务（分类、画像）
} as const
