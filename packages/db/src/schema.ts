import {
  pgTable, uuid, varchar, text, timestamp, boolean,
  jsonb, real, index, uniqueIndex, customType
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// pgvector 自定义类型
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return 'vector(768)' },  // Ollama nomic-embed-text 维度
  toDriver(value) { return JSON.stringify(value) },
  fromDriver(value) {
    if (typeof value === 'string') return JSON.parse(value)
    return value as number[]
  }
})

// tsvector 自定义类型
const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector' }
})

// ─── 用户表 ───────────────────────────────────────────────
export const users = pgTable('users', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  wechatUnionid:         varchar('wechat_unionid', { length: 64 }).unique(),
  wechatServiceOpenid:   varchar('wechat_service_openid', { length: 64 }),
  wechatMiniOpenid:      varchar('wechat_mini_openid', { length: 64 }),
  plan:                  varchar('plan', { length: 20 }).default('free'),
  planExpiresAt:         timestamp('plan_expires_at', { withTimezone: true }),
  createdAt:             timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── 用户 Workspace 文件（USER.md / MEMORY.md / PROFILE.md）─
export const userWorkspaceFiles = pgTable('user_workspace_files', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id).notNull(),
  filename:  varchar('filename', { length: 100 }).notNull(),
  content:   text('content'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniqueUserFile: uniqueIndex('uq_user_workspace_file').on(t.userId, t.filename)
}))

// ─── 知识条目（文章级）────────────────────────────────────
export const knowledgeItems = pgTable('knowledge_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').references(() => users.id).notNull(),
  url:         text('url'),
  title:       text('title'),
  source:      varchar('source', { length: 50 }),   // wechat_mp / webpage
  rawContent:  text('raw_content'),
  summary:     jsonb('summary'),                     // { points, concepts, logic }
  primaryType: varchar('primary_type', { length: 20 }), // argument/operation/fact/narrative
  status:      varchar('status', { length: 20 }).default('processing'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdIdx: index('knowledge_items_user_id_idx').on(t.userId),
}))

// ─── 知识卡片（原子知识点）───────────────────────────────
export const knowledgeCards = pgTable('knowledge_cards', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').references(() => users.id).notNull(),
  itemId:          uuid('item_id').references(() => knowledgeItems.id).notNull(),
  content:         text('content').notNull(),
  sourceQuote:     text('source_quote'),
  cardType:        varchar('card_type', { length: 20 }),  // argument/operation/fact/narrative
  typeMetadata:    jsonb('type_metadata'),                 // 各类型专属字段
  isTimely:        boolean('is_timely').default(false),
  dataPublishedAt: timestamp('data_published_at', { withTimezone: true }),
  embedding:       vector('embedding'),
  searchVector:    tsvector('search_vector'),
  lastActivatedAt: timestamp('last_activated_at', { withTimezone: true }),
  retentionScore:  real('retention_score').default(1.0),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdIdx:      index('knowledge_cards_user_id_idx').on(t.userId),
  cardTypeIdx:    index('knowledge_cards_type_idx').on(t.cardType),
  searchVectorIdx: index('knowledge_cards_search_vector_idx')
    .on(t.searchVector)
    .using(sql`gin`),
  // 向量索引通过 migration SQL 创建（drizzle 暂不原生支持 ivfflat）
}))

// ─── 源头参考（独立于个人知识库）───────────────────────
export const referenceItems = pgTable('reference_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  itemId:      uuid('item_id').references(() => knowledgeItems.id).notNull(),
  title:       text('title'),
  url:         text('url'),
  description: text('description'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── 对话表 ───────────────────────────────────────────────
export const conversations = pgTable('conversations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id).notNull(),
  channel:   varchar('channel', { length: 30 }),  // wechat_service_account / wechat_miniprogram / web
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdIdx: index('conversations_user_id_idx').on(t.userId),
}))

// ─── 消息表 ───────────────────────────────────────────────
export const messages = pgTable('messages', {
  id:             uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  role:           varchar('role', { length: 10 }).notNull(),  // user / assistant
  content:        text('content'),
  contentJson:    jsonb('content_json'),   // 结构化回答（AnswerResponse）
  cardsUsed:      uuid('cards_used').array(),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  conversationIdx: index('messages_conversation_id_idx').on(t.conversationId),
}))

// ─── Skill 注册表 ──────────────────────────────────────────
export const skills = pgTable('skills', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').references(() => users.id), // NULL = 系统内置
  name:        varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  content:     text('content'),   // SKILL.md 内容
  enabled:     boolean('enabled').default(true),
  source:      varchar('source', { length: 20 }),  // builtin / user / mcp
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── MCP 工具注册表 ────────────────────────────────────────
export const mcpTools = pgTable('mcp_tools', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').references(() => users.id), // NULL = 全局
  name:        varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  serverUrl:   text('server_url'),
  schema:      jsonb('schema'),
  enabled:     boolean('enabled').default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
})
