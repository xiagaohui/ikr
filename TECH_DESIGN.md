# IKR 技术方案

> 基于 OpenClaw Agent 架构思想，设计支持 MCP、Skill 快速扩展和用户个性化的 AI Agent 系统

---

## 一、架构设计原则

参考 OpenClaw 的核心设计思想，IKR 采用以下原则：

1. **Workspace-as-Personalization**：用户个性化状态以文件形式存储，Agent 直接读写，透明可控
2. **Skill 延迟加载**：Skill 列表轻量注入 System Prompt，按需展开，支持任意数量扩展
3. **注册式扩展 API**：工具、渠道、技能通过 `register()` 动态注册，而非硬编码
4. **分段组装 System Prompt**：各模块独立维护，可插拔替换
5. **渠道路由 Binding**：多平台（服务号/小程序/Web）通过配置路由，不写 if/else

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                        客户端层                               │
│   微信服务号（触发器）    微信小程序（主战场）    Web（保底）   │
└────────────┬─────────────────┬──────────────────┬────────────┘
             │                 │                  │
             └─────────────────┴──────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │     Channel Router   │  Binding 路由
                    │  （渠道适配 + 路由）  │  服务号/小程序/Web → Agent
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │     Agent Runtime    │  核心 Agent 引擎
                    │                     │
                    │  ┌───────────────┐  │
                    │  │ System Prompt │  │  分段组装
                    │  │  Builder      │  │
                    │  └───────┬───────┘  │
                    │          │          │
                    │  ┌───────▼───────┐  │
                    │  │  Skill Layer  │  │  延迟加载
                    │  └───────┬───────┘  │
                    │          │          │
                    │  ┌───────▼───────┐  │
                    │  │  Tool Layer   │  │  注册式扩展
                    │  │  MCP Bridge   │  │
                    │  └───────────────┘  │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼──────┐    ┌──────────▼──────┐    ┌─────────▼──────┐
│ Content      │    │  Knowledge       │    │  User          │
│ Service      │    │  Service         │    │  Service       │
│ 内容处理      │    │  知识检索+留存    │    │  用户+画像      │
└───────┬──────┘    └──────────┬──────┘    └─────────┬──────┘
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼──────┐    ┌──────────▼──────┐    ┌─────────▼──────┐
│ PostgreSQL   │    │   pgvector       │    │    Redis        │
│ 主数据库      │    │   向量检索        │    │  会话/缓存/队列  │
└──────────────┘    └─────────────────┘    └────────────────┘
        │
┌───────▼──────┐
│   BullMQ     │   异步任务队列
│  内容消化     │   （不阻塞用户响应）
└───────┬──────┘
        │
┌───────▼──────┐
│  Claude API  │   claude-opus-4-6
└──────────────┘
```

---

## 三、Agent Runtime 设计

### 3.1 Agent 定义

每个用户拥有一个独立的 Agent 实例，包含：

```
~/.ikr/users/<userId>/
├── workspace/
│   ├── USER.md          # 用户档案（行业、角色、偏好）
│   ├── MEMORY.md        # 精选长期记忆
│   ├── PROFILE.md       # AI 推断的认知画像（领域、关注点）
│   └── memory/
│       └── YYYY-MM-DD.md  # 每日记忆日志
├── skills/              # 用户级别的私有 Skill（未来支持用户自定义）
└── sessions/            # 会话记录（JSONL）
```

**服务端部署时**，workspace 存储在数据库 + 对象存储，逻辑结构与本地一致，Agent 通过统一的文件接口读写。

### 3.2 System Prompt 分段组装

参考 OpenClaw 的分段设计，IKR 的 System Prompt 由以下模块组成：

```
[1] 角色定义模块      # "你是用户的个人决策顾问..."
[2] 回答规范模块      # 可实操三层机制、输出格式约束
[3] 对话模式模块      # 当前模式：决策模式 / 深度思考模式
[4] Skill 列表模块    # 可用 Skill 的 XML 索引（延迟加载）
[5] 用户画像模块      # 注入 PROFILE.md 内容
[6] 用户记忆模块      # 注入 MEMORY.md 精选记忆
[7] 知识库检索结果    # 每次提问时动态注入相关卡片（带类型标注）
[8] 当前时间 + 平台   # 上下文感知
```

每个模块独立维护，Plugin 可通过钩子注入额外模块：

```typescript
// Plugin 注入自定义 System Prompt 片段
api.registerHook('before_prompt_build', ({ userId, query }) => {
  return {
    appendSystemContext: `用户当前订阅计划：${plan}`
  }
})
```

### 3.3 Agent Loop（核心数据流）

```
用户发送消息
      ↓
① Channel Router 识别来源（服务号/小程序/Web）
      ↓
② 加载用户 Workspace（USER.md、MEMORY.md、PROFILE.md）
      ↓
③ 语义检索知识库（pgvector，混合检索）
      ↓
④ 加载可用 Skill 列表（XML 索引注入）
      ↓
⑤ 组装 System Prompt（分段）
      ↓
⑥ 判断是否需要澄清追问（问题模糊度检测）
      ↓
⑦ 调用 Claude API（流式输出）
      ↓
⑧ Tool 调用处理（如需要搜索、计算等）
      ↓
⑨ 更新知识卡片激活时间（留存调度）
      ↓
⑩ 写入对话记录 + 触发记忆 Flush（context 接近上限时）
      ↓
⑪ 格式化输出 → 推送给用户
```

---

## 四、Skill 系统设计

### 4.1 Skill 结构

每个 Skill 是一个目录，包含 `SKILL.md`：

```
skills/
├── answer-advisor/        # 核心：可实操回答（决策模式）
│   └── SKILL.md
├── deep-thinking/         # 深度思考模式（苏格拉底式追问）
│   └── SKILL.md
├── content-classifier/    # 内容分类识别
│   └── SKILL.md
├── knowledge-retrieval/   # 知识库检索策略
│   └── SKILL.md
├── source-finder/         # 源头资料查找
│   └── SKILL.md
├── profile-builder/       # 用户画像推断
│   └── SKILL.md
└── [用户自定义 Skill]/
    └── SKILL.md
```

**SKILL.md 格式示例（answer-advisor）：**

```markdown
---
name: answer-advisor
description: 给出可实操的多方案决策建议，每个方案包含适用前提、具体步骤和判断标准
metadata:
  ikr:
    priority: high
    always: true
---

# Answer Advisor Skill

当用户提出需要决策或解决方案的问题时，按以下结构回答：

## 回答结构
每个方案必须包含：
- **适用前提**：满足什么条件时选这个方案
- **具体步骤**：第一步→第二步（2-4步，每步可执行）
- **判断标准**：怎么知道做对了
- **知识来源**：标注来自用户知识库还是通用知识

## 优先级规则
1. 优先使用用户知识库中的内容作为依据
2. 知识库无相关内容时，使用通用知识并明确标注
3. 推荐方案排第一，说明推荐理由
4. 问题模糊时，只问一个澄清问题，给出 A/B/C 选项

## 输出格式
使用 JSON schema 约束输出...
```

### 4.2 Skill 加载优先级

```
用户私有 Skill（workspace/skills/）        ← 最高优先级
系统内置 Skill（bundled）
MCP 注册的 Skill                           ← 通过 MCP 动态加载
```

### 4.3 Skill 注入 System Prompt（延迟加载）

System Prompt 只注入 Skill 索引，模型按需读取详细指令：

```xml
<available_skills>
  <skill>
    <name>answer-advisor</name>
    <description>给出可实操的多方案决策建议</description>
    <location>/skills/answer-advisor/SKILL.md</location>
  </skill>
  <skill>
    <name>source-finder</name>
    <description>查找相关源头资料作为延伸参考</description>
    <location>/skills/source-finder/SKILL.md</location>
  </skill>
</available_skills>
```

每个 Skill 仅消耗约 20-30 tokens，支持扩展数十个 Skill 而不撑爆 context。

---

## 五、内容分类与深度思考模式实现

### 5.1 内容分类识别

**分类在消化流程的第一步执行，结果影响后续所有提取逻辑。**

```typescript
// 内容分类器
async function classifyContent(content: string): Promise<ContentClassification> {
  const result = await claude.generate({
    system: `你是内容分类专家。将内容按信息结构分类，可以是多个类型的组合。

    类型定义：
    - argument: 论点型，作者在论证一个主张
    - operation: 操作型，描述如何做某件事
    - fact: 事实型，陈述数据、定义、客观规律
    - narrative: 叙事型，讲案例、故事、复盘

    输出 JSON：
    {
      primaryType: "argument" | "operation" | "fact" | "narrative",
      secondaryTypes: [...],  // 次要类型，按段落分布
      hasTimelyData: boolean, // 是否包含时效性数据
      publishedAt: string | null  // 推断的发布时间
    }`,
    user: content.slice(0, 3000)  // 取前 3000 字判断
  })
  return JSON.parse(result)
}
```

**各类型对应的提取 Prompt：**

```typescript
const EXTRACT_PROMPTS: Record<ContentType, string> = {
  argument: `
    提取论点型知识卡片，每张卡片包含：
    - content: 核心主张（一句话，可独立理解）
    - basis: 支撑依据（1-2条）
    - condition: 适用条件（什么情况下成立）
    - limitation: 局限或反例（如有）
    - quote: 原文出处
  `,
  operation: `
    提取操作型知识卡片，每张卡片包含：
    - content: 做法描述（一句话）
    - prerequisite: 前提条件
    - steps: 操作步骤（有序数组，2-4步）
    - successCriteria: 判断成功的标准
    - quote: 原文出处
  `,
  fact: `
    提取事实型知识卡片，每张卡片包含：
    - content: 核心事实（一句话）
    - source: 数据来源
    - scope: 适用范围（样本、地域、行业）
    - publishedAt: 数据时间
    - isTimely: 是否有时效风险
    - quote: 原文出处
  `,
  narrative: `
    提取叙事型知识卡片，每张卡片包含：
    - content: 案例摘要（一句话）
    - context: 背景和决策者处境
    - action: 关键决策和行动
    - result: 结果
    - transferable: 可迁移的规律（最重要）
    - quote: 原文出处
  `
}
```

**知识卡片数据结构扩展：**

```sql
-- 在 knowledge_cards 表中新增字段
ALTER TABLE knowledge_cards ADD COLUMN card_type VARCHAR(20);
  -- argument / operation / fact / narrative

ALTER TABLE knowledge_cards ADD COLUMN type_metadata JSONB;
  -- 各类型的专属字段（basis/steps/transferable 等）

ALTER TABLE knowledge_cards ADD COLUMN is_timely BOOLEAN DEFAULT false;
ALTER TABLE knowledge_cards ADD COLUMN data_published_at TIMESTAMPTZ;
  -- 事实型卡片的数据时间，用于时效性提醒
```

**检索时的类型权重：**

```typescript
// 不同问题类型，优先召回不同类型的卡片
function getTypeWeights(queryIntent: QueryIntent): TypeWeights {
  switch (queryIntent) {
    case 'how_to':       // "怎么做"类问题
      return { operation: 1.5, argument: 1.0, fact: 0.8, narrative: 1.2 }
    case 'why':          // "为什么"类问题
      return { argument: 1.5, narrative: 1.2, fact: 1.0, operation: 0.8 }
    case 'what_happened': // "发生了什么"类问题
      return { narrative: 1.5, fact: 1.2, argument: 1.0, operation: 0.8 }
    case 'decision':     // 决策类问题
      return { argument: 1.3, operation: 1.3, narrative: 1.2, fact: 1.0 }
  }
}
```

---

### 5.2 深度思考模式实现

**模式状态管理（Redis）：**

```typescript
// 对话模式存储在会话状态中
interface SessionState {
  conversationId: string
  mode: 'decision' | 'deep_thinking'  // 当前模式
  deepThinkingContext?: {
    originalQuestion: string   // 触发深度思考的原始问题
    thinkingStage: number      // 当前追问轮次
    userInsights: string[]     // 用户已得出的结论
    frameworkUsed: string[]    // 已调用的知识库框架
  }
}
```

**模式切换触发：**

```typescript
// 用户发送特定信号时切换模式
function detectModeSwitch(message: string, currentMode: string): ModeAction {
  if (message === 'deep' || message.includes('深入理解') || message === 'B') {
    return { action: 'switch_to_deep_thinking' }
  }
  if (message === 'exit' || message.includes('退出')) {
    return { action: 'switch_to_decision' }
  }
  return { action: 'stay' }
}
```

**深度思考模式 Prompt（deep-thinking Skill）：**

```markdown
# Deep Thinking Skill

当用户选择深度思考模式时，切换为苏格拉底式引导：

## 核心规则
1. 不直接给出答案或结论
2. 每次只问一个问题，等待用户回答
3. 优先调用用户知识库里的框架来引导（"你读过的 X 框架..."）
4. 根据用户的回答，逐步引导向更深层的原因
5. 用户自己推导出结论后，只补充遗漏的关键盲点

## 追问策略
- 第 1 轮：帮用户定位问题所在的层次
- 第 2 轮：引导用户分析根本原因
- 第 3 轮：引导用户推导解决方向
- 第 4 轮（最后）：用户得出结论，IKR 补充盲点

## 盲点补充格式
"你的分析很准确。补充一个你可能没考虑到的视角：
 基于你收录的《XXX》，[补充内容]"
```

**深度思考模式的检索策略：**

```typescript
// 深度思考模式下，优先检索"框架类"卡片
async function deepThinkingSearch(userId: string, question: string) {
  // 优先召回论点型和操作型卡片（包含框架和方法论）
  const cards = await hybridSearch(userId, question, {
    typeWeights: { argument: 1.5, operation: 1.5, fact: 0.8, narrative: 1.0 },
    purpose: 'framework'  // 用于引导思考，而非直接回答
  })
  return cards
}
```

---

## 六、MCP 集成设计

### 5.1 MCP Bridge

IKR 实现标准 MCP Server 接口，对外暴露知识库能力；同时作为 MCP Client 接入外部工具：

```typescript
// IKR 作为 MCP Server（对外暴露）
mcpServer.registerTool('search_knowledge', {
  description: '在用户知识库中语义搜索相关内容',
  inputSchema: { query: string, limit: number },
  handler: async ({ query, userId }) => {
    return await knowledgeService.semanticSearch(userId, query)
  }
})

mcpServer.registerTool('add_knowledge', {
  description: '向用户知识库添加新内容',
  inputSchema: { url: string, content: string },
  handler: async ({ url, content, userId }) => {
    return await contentService.ingest(userId, { url, content })
  }
})

// IKR 作为 MCP Client（接入外部工具）
const externalTools = await mcpClient.connect('mcp://web-search-server')
// 自动注册为可用 Tool，Agent 可直接调用
```

### 5.2 Tool 注册 API

参考 OpenClaw 的注册式设计：

```typescript
// 内置工具注册
toolRegistry.register('knowledge_search', {
  description: '语义搜索用户知识库',
  schema: Type.Object({
    query: Type.String(),
    limit: Type.Number({ default: 10 })
  }),
  handler: knowledgeSearchHandler
})

toolRegistry.register('web_search', {
  description: '搜索互联网获取源头资料',
  schema: Type.Object({ query: Type.String() }),
  handler: webSearchHandler,
  requires: { env: ['SEARCH_API_KEY'] }  // 环境变量 gate
})

// Plugin 注册额外工具
pluginApi.registerTool('notion_sync', {
  description: '同步到 Notion 知识库',
  schema: ...,
  handler: ...,
  requires: { env: ['NOTION_TOKEN'] }
})
```

### 5.3 支持的 MCP 扩展场景

```
内置工具（Phase 0）：
  knowledge_search     语义检索知识库
  profile_read         读取用户画像
  memory_read/write    读写用户记忆

Phase 1 扩展：
  web_search           搜索源头资料
  url_fetch            抓取网页内容
  video_transcript     获取视频字幕

未来 MCP 扩展（用户自选安装）：
  notion_sync          同步到 Notion
  obsidian_bridge      与 Obsidian 联动
  calendar_context     读取日历注入上下文
  slack_context        读取 Slack 消息上下文
  github_context       读取代码仓库上下文
```

---

## 六、用户个性化设计

### 6.1 三层个性化

```
第一层：系统推断（自动，无感）
  - 分析知识库内容 → 推断行业/角色/阶段
  - 写入 PROFILE.md，每次新增内容后异步更新
  - 每次提问自动注入，无需用户操作

第二层：记忆积累（半自动）
  - 对话中重要信息自动写入 MEMORY.md
  - context 接近上限时静默触发记忆 Flush
  - 用户可查看和编辑自己的 MEMORY.md

第三层：用户主动设置（显式）
  - 用户可在小程序编辑 USER.md（角色、偏好、禁忌）
  - 用户可安装自定义 Skill
  - 用户可配置 MCP 工具（如接入 Notion）
```

### 6.2 PROFILE.md 格式

由 AI 自动维护，每次更新后覆盖写入：

```markdown
# 用户认知画像
更新时间：2024-03-20

## 行业领域
互联网 / SaaS / B端产品

## 职能角色
产品经理，偏增长方向，可能处于创业或成长期公司

## 所处阶段
成长期（基于近期收录内容推断：关注 PMF 验证、用户增长、团队管理）

## 近期关注点（最近 2 周）
- 用户增长策略
- 产品 PMF 验证
- AI 产品设计

## 知识积累深度
- 深：产品设计、用户增长
- 中：团队管理、融资
- 浅：技术架构、市场营销
```

### 6.3 记忆 Flush 机制

参考 OpenClaw 的自动 compaction 设计：

```typescript
// 对话 context 接近上限时，静默触发记忆整理
async function triggerMemoryFlush(userId: string, sessionId: string) {
  const flushPrompt = `
    回顾这段对话，把值得长期记住的信息写入用户记忆文件。
    格式：memory/YYYY-MM-DD.md
    包括：用户提到的重要背景、做出的决策、反馈的偏好。
    如果没有值得记录的内容，回复 NO_MEMORY。
  `
  await agentRuntime.runSilentTurn(userId, flushPrompt)
}
```

用户完全无感知，记忆自动积累，下次对话自动带入。

---

## 七、渠道路由设计（Channel Router）

参考 OpenClaw 的 Binding 路由，用配置驱动多渠道分发：

```typescript
// channel-bindings.config.ts
export const bindings: ChannelBinding[] = [
  {
    channel: 'wechat_service_account',
    agentMode: 'lightweight',      // 服务号：轻量模式，回答精简
    maxResponseLength: 600,        // 微信消息长度限制
    overflowAction: 'redirect_miniprogram',  // 超长时引导小程序
    sessionTTL: 30 * 60,           // 30分钟会话超时
  },
  {
    channel: 'wechat_miniprogram',
    agentMode: 'full',             // 小程序：完整模式
    maxResponseLength: null,       // 无限制
    streaming: true,               // 支持流式输出
    sessionTTL: 7 * 24 * 60 * 60, // 7天会话
  },
  {
    channel: 'web',
    agentMode: 'full',
    streaming: true,
    sessionTTL: 30 * 24 * 60 * 60,
  }
]
```

渠道路由逻辑：

```typescript
class ChannelRouter {
  async route(message: InboundMessage): Promise<AgentConfig> {
    const binding = this.bindings.find(b => b.channel === message.channel)
    return {
      userId: await this.resolveUserId(message),  // unionid 跨渠道身份统一
      agentMode: binding.agentMode,
      sessionId: await this.resolveSession(message, binding),
      outputConfig: {
        maxLength: binding.maxResponseLength,
        streaming: binding.streaming,
        overflowAction: binding.overflowAction,
      }
    }
  }

  // 服务号 openid + 小程序 openid → 同一个 userId（通过 unionid）
  async resolveUserId(message: InboundMessage): Promise<string> {
    const unionid = await wechatService.getUnionId(message.openid, message.channel)
    return await userService.findOrCreateByUnionId(unionid)
  }
}
```

---

## 八、技术难点与解决方案

### 难点一：微信文章内容抓取

**问题**：微信公众号文章防抓取，服务端无法直接获取正文。

**分阶段解决方案：**

```
Phase 0（降级方案，先跑通流程）：
  用户分享 link 类型消息时，微信传递：
  - title（文章标题）
  - description（摘要，约 100-200 字）
  - url（原文链接）
  用 description 作为内容输入，质量有限但够验证流程。
  在消化完成通知里告知用户："已基于文章摘要提炼，
  如需完整分析，请在小程序内打开原文"

Phase 1（正式方案）：
  小程序内置 WebView 打开文章，通过 JS Bridge 提取正文：
  - 用户点击"在 IKR 中阅读"
  - 小程序 WebView 加载文章
  - JS 注入提取 document.body.innerText
  - 上传正文到后端处理
  这是目前合规且可行的方案，用户多一步操作，
  但体验可以通过 UI 设计降低摩擦。

Phase 2（扩展方案）：
  浏览器插件，用户在 PC 端阅读时一键收录，
  完整获取正文，无抓取限制。
```

### 难点二：服务号 5 秒响应限制

**问题**：微信要求服务号 5 秒内响应，AI 生成通常需要 10-30 秒。

**解决方案：**

```typescript
// 消息处理器
async function handleWechatMessage(message: WechatMessage) {

  // 1. 立即返回占位消息（< 500ms）
  await wechatReply(message, '收到，正在思考…⏳')

  // 2. 异步处理 AI 生成
  await queue.add('chat', {
    userId: message.openid,
    query: message.content,
    replyVia: 'customer_service_api'  // 用客服消息接口异步推送
  })
}

// Worker 处理完成后
async function sendAsyncReply(userId: string, content: string) {
  // 客服消息接口：需要服务号认证（300元/年，企业资质）
  await wechatCustomerServiceApi.send(userId, content)
}
```

**前提条件**：需要微信服务号通过企业认证，获取客服消息接口权限。这是上线前的资质准备事项。

### 难点三：回答质量保证（RAG 质量）

**问题**：召回不相关卡片，或回答停留在框架层面不够实操。

**混合检索策略：**

```typescript
async function hybridSearch(userId: string, query: string): Promise<KnowledgeCard[]> {

  // 向量检索（语义相关性）
  const vectorResults = await pgvector.search({
    embedding: await embed(query),
    userId,
    limit: 20
  })

  // BM25 关键词检索
  const bm25Results = await postgres.query(`
    SELECT *, ts_rank(search_vector, plainto_tsquery($1)) AS rank
    FROM knowledge_cards
    WHERE user_id = $2
      AND search_vector @@ plainto_tsquery($1)
    ORDER BY rank DESC
    LIMIT 20
  `, [query, userId])

  // 融合 + 重排序（RRF: Reciprocal Rank Fusion）
  const merged = reciprocalRankFusion(vectorResults, bm25Results)

  // 留存调度权重（遗忘风险高的卡片适当提权）
  const reranked = merged.map(card => ({
    ...card,
    finalScore: card.rrfScore * 0.7 + (1 - card.retentionScore) * 0.3
  })).sort((a, b) => b.finalScore - a.finalScore)

  return reranked.slice(0, 10)
}
```

**输出格式约束（JSON Schema）：**

```typescript
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    solutions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'prerequisite', 'steps', 'successCriteria', 'source'],
        properties: {
          title: { type: 'string' },
          isRecommended: { type: 'boolean' },
          prerequisite: { type: 'string' },   // 适用前提
          steps: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
          successCriteria: { type: 'string' }, // 判断标准
          source: {
            type: 'object',
            properties: {
              type: { enum: ['knowledge_base', 'general_ai'] },
              references: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    },
    needsClarification: { type: 'boolean' },
    clarificationQuestion: { type: 'string' },
    clarificationOptions: { type: 'array', items: { type: 'string' }, maxItems: 3 }
  }
}

// 输出验证，不合格则重试（最多 2 次）
async function generateAnswer(prompt: string): Promise<Answer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await claude.generate(prompt)
    const parsed = JSON.parse(raw)
    if (validateSchema(parsed, ANSWER_SCHEMA)) return parsed
  }
  throw new Error('Answer generation failed after 3 attempts')
}
```

### 难点四：小程序 AI 对话审核风险

**问题**：微信对 AI 对话类小程序审核严格，可能被拒或下架。

**应对策略：**

```
1. 产品定位为"知识助手"而非"AI 聊天"，规避敏感分类
2. 提交审核前，确保：
   - 有明确的内容边界（仅基于用户知识库回答）
   - 有违禁内容过滤机制
   - 有用户协议和隐私政策
3. Web 端始终维护作为保底，小程序审核期间用 Web 服务种子用户
4. 准备企业主体资质（ICP 备案、营业执照）
```

---

## 九、数据模型

### 核心表结构

```sql
-- 用户表
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wechat_unionid  VARCHAR(64) UNIQUE NOT NULL,
  wechat_service_openid   VARCHAR(64),  -- 服务号 openid
  wechat_mini_openid      VARCHAR(64),  -- 小程序 openid
  plan            VARCHAR(20) DEFAULT 'free',
  plan_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 用户 Workspace 文件表（对应文件系统的 Markdown 文件）
CREATE TABLE user_workspace_files (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id),
  filename  VARCHAR(100) NOT NULL,  -- USER.md / MEMORY.md / PROFILE.md 等
  content   TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, filename)
);

-- 知识条目表（文章级）
CREATE TABLE knowledge_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id),
  url          TEXT,
  title        TEXT,
  source       VARCHAR(50),         -- wechat_mp / webpage / video
  raw_content  TEXT,
  summary      JSONB,               -- { points, concepts, logic }
  status       VARCHAR(20) DEFAULT 'processing',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 知识卡片表（原子知识点）
CREATE TABLE knowledge_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id),
  item_id           UUID REFERENCES knowledge_items(id),
  content           TEXT NOT NULL,
  source_quote      TEXT,
  card_type         VARCHAR(20),     -- argument / operation / fact / narrative
  type_metadata     JSONB,           -- 各类型专属字段
  is_timely         BOOLEAN DEFAULT false,
  data_published_at TIMESTAMPTZ,     -- 事实型卡片的数据时间
  embedding         vector(1536),
  search_vector     tsvector,        -- BM25 全文检索
  last_activated_at TIMESTAMPTZ,
  retention_score   FLOAT DEFAULT 1.0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 向量索引
CREATE INDEX ON knowledge_cards USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- 全文索引
CREATE INDEX ON knowledge_cards USING gin(search_vector);
-- 自动更新全文索引
CREATE TRIGGER update_search_vector BEFORE INSERT OR UPDATE ON knowledge_cards
  FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger(search_vector, 'pg_catalog.simple', content);

-- 源头参考表（独立于个人知识库）
CREATE TABLE reference_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID REFERENCES knowledge_items(id),
  title       TEXT,
  url         TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 对话表
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  channel     VARCHAR(30),           -- wechat_service_account / wechat_miniprogram / web
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 消息表
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  role            VARCHAR(10),       -- user / assistant
  content         TEXT,
  content_json    JSONB,             -- 结构化回答（方案列表）
  cards_used      UUID[],            -- 调用的知识卡片 ID（用于更新激活时间）
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Skill 注册表（系统 + 用户自定义）
CREATE TABLE skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),  -- NULL = 系统内置
  name        VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  content     TEXT,                  -- SKILL.md 内容
  enabled     BOOLEAN DEFAULT true,
  source      VARCHAR(20),           -- builtin / user / mcp
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- MCP 工具注册表
CREATE TABLE mcp_tools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),  -- NULL = 全局
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  server_url  TEXT,                  -- MCP Server 地址
  schema      JSONB,                 -- 工具参数 schema
  enabled     BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 十、项目结构

```
ikr/
├── apps/
│   ├── api/                    # Fastify API Server
│   │   ├── src/
│   │   │   ├── routes/         # HTTP 路由
│   │   │   ├── channels/       # 渠道适配器
│   │   │   │   ├── wechat-service-account.ts
│   │   │   │   ├── wechat-miniprogram.ts
│   │   │   │   └── web.ts
│   │   │   ├── agent/          # Agent Runtime
│   │   │   │   ├── runtime.ts          # 核心 Agent 引擎
│   │   │   │   ├── prompt-builder.ts   # System Prompt 分段组装
│   │   │   │   ├── skill-loader.ts     # Skill 延迟加载
│   │   │   │   ├── tool-registry.ts    # Tool 注册
│   │   │   │   └── memory-flush.ts     # 记忆 Flush
│   │   │   ├── services/
│   │   │   │   ├── content.service.ts  # 内容处理
│   │   │   │   ├── knowledge.service.ts # 知识检索+留存
│   │   │   │   ├── user.service.ts     # 用户+画像
│   │   │   │   └── mcp.service.ts      # MCP Bridge
│   │   │   └── workers/        # BullMQ Workers
│   │   │       ├── content-digest.worker.ts
│   │   │       └── profile-update.worker.ts
│   └── miniprogram/            # 微信小程序
│       ├── pages/
│       │   ├── index/          # 首页（提问入口）
│       │   ├── chat/           # 对话页
│       │   └── library/        # 知识库
│       └── components/
├── skills/                     # 内置 Skill 定义
│   ├── answer-advisor/
│   │   └── SKILL.md
│   ├── knowledge-retrieval/
│   │   └── SKILL.md
│   ├── source-finder/
│   │   └── SKILL.md
│   └── profile-builder/
│       └── SKILL.md
├── packages/
│   ├── db/                     # 数据库 Schema + 迁移（Drizzle ORM）
│   ├── ai/                     # Claude API 封装 + Prompt 模板
│   └── shared/                 # 共享类型定义
└── infra/                      # 部署配置
    ├── railway.toml
    └── docker-compose.yml      # 本地开发
```

---

## 十一、技术选型汇总

| 层级 | 技术 | 版本/说明 |
|------|------|----------|
| 后端框架 | Fastify | v4，轻量高性能 |
| ORM | Drizzle ORM | TypeScript 原生，schema 即类型 |
| 主数据库 | PostgreSQL | v16 + pgvector 扩展 |
| 全文检索 | PostgreSQL tsvector | 内置，无需额外服务 |
| 向量检索 | pgvector | IVFFlat 索引，支持余弦相似度 |
| 混合检索融合 | RRF（代码实现）| Reciprocal Rank Fusion |
| 缓存 | Redis | v7，会话 + 热点缓存 |
| 消息队列 | BullMQ | 基于 Redis，异步任务 |
| AI 模型 | Claude API | claude-opus-4-6，摘要+问答 |
| Embedding | Claude Embeddings | text-embedding-3-small 备选 |
| 小程序 | 微信原生小程序 | TypeScript + Skyline 渲染 |
| Web 保底 | Next.js 15 | App Router |
| 部署 | Railway | 自动扩缩容，支持 PostgreSQL |
| 对象存储 | Cloudflare R2 | 原始内容备份 |
| 监控 | Sentry + Railway Metrics | 错误追踪 + 性能监控 |

---

## 十二、Phase 0 开发计划

```
Week 1：基础设施
  ├── Monorepo 初始化（pnpm workspace）
  ├── 数据库初始化（PostgreSQL + pgvector + tsvector）
  ├── Drizzle ORM Schema 定义
  ├── Redis + BullMQ 配置
  └── Fastify 基础框架 + 健康检查

Week 2：微信接入 + 内容处理
  ├── 微信服务号消息回调（收录 + 确认回复）
  ├── 内容清洗（link 消息 description 提取）
  ├── BullMQ Worker：Claude 消化 → 知识卡片 → 向量化
  └── 消化完成通知推送（客服消息接口）

Week 3：Agent Runtime + 问答核心
  ├── Skill Loader（加载内置 Skill，生成 XML 索引）
  ├── System Prompt Builder（分段组装）
  ├── 混合检索（pgvector + BM25 + RRF 融合）
  ├── 用户画像推断（PROFILE.md 自动生成）
  └── Claude 问答调用 + JSON Schema 输出约束

Week 4：小程序 + 端到端打通
  ├── 小程序登录（code2session + JWT）
  ├── 服务号 → 小程序 unionid 身份统一
  ├── 小程序首页 + 对话页 + 知识库页
  ├── 服务号多轮对话（Redis 会话管理）
  └── 服务号超长回答 → 引导小程序

Week 5：冷启动 + 质量保证 + 上线
  ├── 冷启动兜底（通用 AI + 积累进度提示）
  ├── 回答质量验证（JSON Schema 校验 + 重试）
  ├── 错误处理 + 重试机制
  ├── 记忆 Flush 机制
  └── 种子用户内测（10人）
```

---

## 十三、未来扩展路径

```
Phase 1 扩展：
  - 小程序 WebView 正文提取（解决抓取问题）
  - 视频内容支持（字幕提取）
  - MCP Server 对外开放（第三方工具接入 IKR 知识库）

Phase 2 扩展：
  - 用户自定义 Skill（上传 SKILL.md）
  - MCP 工具市场（用户选择安装）
  - 知识图谱可视化
  - 团队版（共享知识库 + 多 Agent 路由）

Phase 3 扩展：
  - 浏览器插件（内容收录 + 划线收录）
  - 开放 API（第三方应用调用 IKR 知识库）
  - 自定义 Agent（用户配置自己的 SOUL.md）
```
