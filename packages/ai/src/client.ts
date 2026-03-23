import OpenAI from 'openai'

const apiKey = process.env.ZHIPU_API_KEY
if (!apiKey) throw new Error('ZHIPU_API_KEY is required')

// 智谱 AI 兼容 OpenAI 格式，直接指定 baseURL
export const client = new OpenAI({
  apiKey,
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
})

export const MODELS = {
  main: 'glm-4-flash',  // 微信场景需要快速响应，用 flash 保证 5 秒内回复
  fast: 'glm-4-flash',
} as const
