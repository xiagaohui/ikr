import { client, MODELS } from './client.js'
import type { ContentType, CardTypeMetadata } from '@ikr/shared'

const EXTRACT_PROMPTS: Record<ContentType, string> = {
  argument: `提取论点型知识卡片，每张卡片输出 JSON：
{
  "content": "核心主张（一句话，可独立理解）",
  "sourceQuote": "原文出处（引用原文）",
  "typeMetadata": {
    "basis": ["支撑依据1", "支撑依据2"],
    "condition": "适用条件",
    "limitation": "局限或反例（可选）"
  }
}`,
  operation: `提取操作型知识卡片，每张卡片输出 JSON：
{
  "content": "做法描述（一句话）",
  "sourceQuote": "原文出处",
  "typeMetadata": {
    "prerequisite": "前提条件",
    "steps": ["第一步", "第二步", "第三步"],
    "successCriteria": "判断成功的标准"
  }
}`,
  fact: `提取事实型知识卡片，每张卡片输出 JSON：
{
  "content": "核心事实（一句话）",
  "sourceQuote": "原文出处",
  "isTimely": true,
  "typeMetadata": {
    "source": "数据来源",
    "scope": "适用范围",
    "publishedAt": "数据时间（可选）"
  }
}`,
  narrative: `提取叙事型知识卡片，每张卡片输出 JSON：
{
  "content": "案例摘要（一句话）",
  "sourceQuote": "原文出处",
  "typeMetadata": {
    "context": "背景和决策者处境",
    "action": "关键决策和行动",
    "result": "结果",
    "transferable": "可迁移的规律（最重要）"
  }
}`
}

export interface DigestResult {
  summary: {
    points: string[]
    concepts: Array<{ term: string; definition: string }>
    logic: string
  }
  cards: Array<{
    content: string
    sourceQuote: string
    cardType: ContentType
    typeMetadata: CardTypeMetadata
    isTimely?: boolean
  }>
}

export async function digestContent(
  content: string,
  primaryType: ContentType,
  secondaryTypes: ContentType[]
): Promise<DigestResult> {
  const [summary, cards] = await Promise.all([
    generateSummary(content, primaryType),
    extractCards(content, primaryType, secondaryTypes)
  ])
  return { summary, cards }
}

async function generateSummary(content: string, type: ContentType) {
  const typeHints: Record<ContentType, string> = {
    argument: '重点提炼作者的核心主张和论证逻辑',
    operation: '重点提炼操作步骤和适用场景',
    fact: '重点提炼核心数据和结论',
    narrative: '重点提炼案例经过和可迁移规律'
  }

  const response = await client.chat.completions.create({
    model: MODELS.main,
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: `你是知识提炼专家。${typeHints[type]}。只输出严格的 JSON：
{
  "points": ["核心论点1", "核心论点2", "核心论点3"],
  "concepts": [{"term": "概念名", "definition": "定义"}],
  "logic": "作者的整体逻辑链（一段话）"
}`
      },
      {
        role: 'user',
        content: `请提炼以下内容：\n\n${content.slice(0, 8000)}`
      }
    ]
  })

  const raw = response.choices[0]?.message?.content || '{}'
  // 过滤推理模型的 <think>...</think> 标签
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  try {
    return JSON.parse(jsonMatch?.[0] || text)
  } catch {
    return { points: [], concepts: [], logic: '' }
  }
}

async function extractCards(
  content: string,
  primaryType: ContentType,
  secondaryTypes: ContentType[]
) {
  const allTypes = [primaryType, ...secondaryTypes.filter(t => t !== primaryType)]
  const results: DigestResult['cards'] = []

  for (const type of allTypes) {
    const response = await client.chat.completions.create({
      model: MODELS.main,
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content: `你是知识卡片提取专家。从内容中提取 ${type} 类型的知识卡片，提取 3-5 张最有价值的。
${EXTRACT_PROMPTS[type]}

只输出 JSON 数组：[卡片1, 卡片2, ...]`
        },
        {
          role: 'user',
          content: `请从以下内容提取 ${type} 类型知识卡片：\n\n${content.slice(0, 8000)}`
        }
      ]
    })

    const raw = response.choices[0]?.message?.content || '[]'
    const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    try {
      const cards = JSON.parse(jsonMatch?.[0] || text)
      results.push(...cards.map((c: any) => ({ ...c, cardType: type })))
    } catch {
      // 解析失败跳过
    }
  }

  return results
}
