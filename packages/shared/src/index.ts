// 内容类型
export type ContentType = 'argument' | 'operation' | 'fact' | 'narrative'

// 对话模式
export type ConversationMode = 'decision' | 'deep_thinking'

// 渠道类型
export type ChannelType = 'wechat_service_account' | 'wechat_miniprogram' | 'web'

// 知识条目状态
export type KnowledgeItemStatus = 'processing' | 'done' | 'failed'

// 用户计划
export type UserPlan = 'free' | 'pro'

// Skill 来源
export type SkillSource = 'builtin' | 'user' | 'mcp'

// 内容分类结果
export interface ContentClassification {
  primaryType: ContentType
  secondaryTypes: ContentType[]
  hasTimelyData: boolean
  publishedAt: string | null
}

// 知识卡片（各类型的 type_metadata 结构）
export interface ArgumentMetadata {
  basis: string[]         // 支撑依据
  condition: string       // 适用条件
  limitation?: string     // 局限或反例
}

export interface OperationMetadata {
  prerequisite: string    // 前提条件
  steps: string[]         // 操作步骤
  successCriteria: string // 判断标准
}

export interface FactMetadata {
  source: string          // 数据来源
  scope: string           // 适用范围
  publishedAt?: string    // 数据时间
}

export interface NarrativeMetadata {
  context: string         // 背景
  action: string          // 关键决策
  result: string          // 结果
  transferable: string    // 可迁移规律
}

export type CardTypeMetadata =
  | ArgumentMetadata
  | OperationMetadata
  | FactMetadata
  | NarrativeMetadata

// 结构化回答
export interface Solution {
  title: string
  isRecommended: boolean
  prerequisite: string
  steps: string[]
  successCriteria: string
  source: {
    type: 'knowledge_base' | 'general_ai'
    references: string[]
  }
}

export interface AnswerResponse {
  solutions: Solution[]
  needsClarification: boolean
  clarificationQuestion?: string
  clarificationOptions?: string[]
  references?: Array<{ title: string; url: string }>
}

// 会话状态
export interface SessionState {
  conversationId: string
  mode: ConversationMode
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  deepThinkingContext?: {
    originalQuestion: string
    thinkingStage: number
    userInsights: string[]
    frameworksUsed: string[]
  }
  lastActiveAt: number
}
