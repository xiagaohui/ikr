import { client, MODELS } from './client.js'
import type { ContentClassification, ContentType } from '@ikr/shared'

export async function classifyContent(content: string): Promise<ContentClassification> {
  const response = await client.chat.completions.create({
    model: MODELS.fast,
    max_tokens: 256,
    messages: [
      {
        role: 'system',
        content: `你是内容分类专家。将内容按信息结构分类。

类型定义：
- argument: 论点型，作者在论证一个主张，有观点有依据
- operation: 操作型，描述如何做某件事，有步骤有条件
- fact: 事实型，陈述数据、定义、客观规律
- narrative: 叙事型，讲案例、故事、复盘

只输出严格的 JSON，不要有其他内容：
{
  "primaryType": "argument|operation|fact|narrative",
  "secondaryTypes": [],
  "hasTimelyData": true|false,
  "publishedAt": "YYYY-MM-DD 或 null"
}`
      },
      {
        role: 'user',
        content: `请分类以下内容（取前2000字）：\n\n${content.slice(0, 2000)}`
      }
    ]
  })

  const raw = response.choices[0]?.message?.content || ''
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  try {
    return JSON.parse(jsonMatch?.[0] || text) as ContentClassification
  } catch {
    return {
      primaryType: 'argument' as ContentType,
      secondaryTypes: [],
      hasTimelyData: false,
      publishedAt: null
    }
  }
}
