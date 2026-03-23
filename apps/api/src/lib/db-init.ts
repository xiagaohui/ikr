/**
 * 生产环境数据库初始化
 * 在 API 启动时自动执行，确保表结构存在
 */
import { db } from '@ikr/db'
import { sql } from '@ikr/db'

export async function initDatabase() {
  try {
    // 启用 pgvector
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)

    // 建表（IF NOT EXISTS，幂等安全）
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wechat_unionid VARCHAR(64) UNIQUE,
        wechat_service_openid VARCHAR(64),
        wechat_mini_openid VARCHAR(64),
        plan VARCHAR(20) DEFAULT 'free',
        plan_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_workspace_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        filename VARCHAR(100) NOT NULL,
        content TEXT,
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, filename)
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        url TEXT, title TEXT, source VARCHAR(50),
        raw_content TEXT, summary JSONB, primary_type VARCHAR(20),
        status VARCHAR(20) DEFAULT 'processing',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS knowledge_cards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        item_id UUID REFERENCES knowledge_items(id),
        content TEXT NOT NULL,
        source_quote TEXT,
        card_type VARCHAR(20),
        type_metadata JSONB,
        is_timely BOOLEAN DEFAULT false,
        data_published_at TIMESTAMPTZ,
        embedding vector(768),
        search_vector tsvector,
        last_activated_at TIMESTAMPTZ,
        retention_score REAL DEFAULT 1.0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS knowledge_cards_user_id_idx ON knowledge_cards(user_id)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS knowledge_cards_search_vector_idx
        ON knowledge_cards USING gin(search_vector)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS knowledge_cards_embedding_idx
        ON knowledge_cards USING hnsw (embedding vector_cosine_ops)
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reference_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id UUID REFERENCES knowledge_items(id),
        title TEXT, url TEXT, description TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        channel VARCHAR(30),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id),
        role VARCHAR(10) NOT NULL,
        content TEXT, content_json JSONB, cards_used UUID[],
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS skills (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT, content TEXT,
        enabled BOOLEAN DEFAULT true, source VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mcp_tools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        name VARCHAR(100) NOT NULL,
        description TEXT, server_url TEXT, schema JSONB,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    // 全文检索触发器
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION knowledge_cards_search_vector_update()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)

    await db.execute(sql`
      DROP TRIGGER IF EXISTS knowledge_cards_search_vector_trigger ON knowledge_cards
    `)
    await db.execute(sql`
      CREATE TRIGGER knowledge_cards_search_vector_trigger
        BEFORE INSERT OR UPDATE ON knowledge_cards
        FOR EACH ROW EXECUTE FUNCTION knowledge_cards_search_vector_update()
    `)

    console.log('✅ Database initialized')
  } catch (err) {
    console.error('❌ Database init failed:', err)
    throw err
  }
}
