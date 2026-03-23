import { buildSkillsXml, loadSkillIndex } from './skill-loader.js'
import type { RetrievedCard } from './knowledge-retrieval.js'
import type { SessionState } from '@ikr/shared'

interface PromptContext {
  userProfile: string
  userMemory: string
  retrievedCards: RetrievedCard[]
  session: SessionState
  channel: string
  cardCount: number  // 用户知识库总卡片数（冷启动判断）
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const skillsXml = buildSkillsXml(loadSkillIndex())
  const isDecisionMode = ctx.session.mode === 'decision'
  const isColdStart = ctx.cardCount < 20  // 少于 20 张卡片视为冷启动

  const sections: string[] = []

  // ─── [1] 角色定义 ──────────────────────────────────────
  sections.push(`你是用户的个人决策顾问 IKR。你了解用户读过什么、积累了什么，在用户遇到问题时给出基于其知识背景的可实操建议。`)

  // ─── [2] 对话模式 ──────────────────────────────────────
  if (isDecisionMode) {
    sections.push(`## 当前模式：决策模式
给出可实操的多方案建议。每个方案必须包含：
- 适用前提（满足什么条件时选这个方案）
- 具体步骤（2-4步，每步可执行）
- 判断标准（怎么知道做对了）
- 知识来源（来自用户知识库 / 通用知识）

推荐方案排第一。问题模糊时，只问一个澄清问题，给出 A/B/C 选项。

回答结束后，附加一行：
"💡 想深入理解这个问题？回复「深入」切换思考模式"`)
  } else {
    const dtCtx = ctx.session.deepThinkingContext
    sections.push(`## 当前模式：深度思考模式
不直接给出答案。用苏格拉底式追问引导用户自己推导结论。

规则：
1. 每次只问一个问题，等待用户回答
2. 优先用用户知识库里的框架来引导（"你读过的 X 框架..."）
3. 根据用户回答逐步引导向更深层原因
4. 当前是第 ${(dtCtx?.thinkingStage ?? 0) + 1} 轮追问（最多 4 轮）
5. 第 4 轮后输出用户推导的总结 + 补充盲点

盲点补充格式："你的分析很准确。补充一个你可能没考虑到的视角：基于你收录的《XXX》，[补充内容]"

回答结束后附加："回复「退出」返回决策模式"`)
  }

  // ─── [3] Skill 列表（微信渠道跳过，节省 token）──────────
  if (ctx.channel !== 'wechat_service_account') {
    sections.push(skillsXml)
  }

  // ─── [4] 用户画像 ──────────────────────────────────────
  if (ctx.userProfile && ctx.userProfile.length > 50) {
    sections.push(`## 用户认知画像\n${ctx.userProfile}`)
  }

  // ─── [5] 用户记忆 ──────────────────────────────────────
  if (ctx.userMemory && ctx.userMemory.length > 50) {
    sections.push(`## 用户长期记忆\n${ctx.userMemory}`)
  }

  // ─── [6] 知识库检索结果 ────────────────────────────────
  if (ctx.retrievedCards.length > 0) {
    const cardsText = ctx.retrievedCards.map(card => {
      const timelyNote = card.isTimely ? '⚠️ 含时效性数据' : ''
      return `【${card.cardType}】${card.content}${timelyNote}\n来源：${card.itemTitle || '未知'}\n${card.sourceQuote ? `原文："${card.sourceQuote}"` : ''}`
    }).join('\n\n---\n\n')

    sections.push(`## 用户知识库相关内容\n${cardsText}`)
  } else if (isColdStart) {
    sections.push(`## 知识库状态
用户知识库还在积累中（当前 ${ctx.cardCount} 张知识点）。
本次基于通用知识回答，并在回答末尾提示：
"（当前基于通用知识回答。收录内容越多，建议越贴合你的实际情况。）"`)
  }

  // ─── [7] 平台和时间 ────────────────────────────────────
  const platformNote: Record<string, string> = {
    wechat_service_account: '当前平台：微信服务号（回答控制在 500 字以内，重要内容提示去小程序查看完整版）',
    wechat_miniprogram: '当前平台：微信小程序（可以详细展开）',
    web: '当前平台：Web（可以详细展开）'
  }
  sections.push(`${platformNote[ctx.channel] || ''}
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)

  return sections.join('\n\n')
}
