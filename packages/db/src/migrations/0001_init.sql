-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 向量索引（ivfflat，需要数据量足够后创建，先用 HNSW）
CREATE INDEX IF NOT EXISTS knowledge_cards_embedding_idx
  ON knowledge_cards
  USING hnsw (embedding vector_cosine_ops);

-- 遗忘曲线更新函数
CREATE OR REPLACE FUNCTION update_retention_score()
RETURNS void AS $$
  UPDATE knowledge_cards
  SET retention_score = EXP(
    -EXTRACT(EPOCH FROM (NOW() - COALESCE(last_activated_at, created_at))) / 86400.0 / 10.0
  )
  WHERE last_activated_at IS NOT NULL OR created_at IS NOT NULL;
$$ LANGUAGE SQL;

-- 全文检索触发器（中英文混合，使用 simple 配置）
CREATE OR REPLACE FUNCTION knowledge_cards_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_cards_search_vector_trigger
  BEFORE INSERT OR UPDATE ON knowledge_cards
  FOR EACH ROW EXECUTE FUNCTION knowledge_cards_search_vector_update();
