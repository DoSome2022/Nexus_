-- 搜尋索引（依 .claude/CLAUDE.data-model.md 搜尋設計）
-- pg_trgm：title 模糊搜尋（fuzzy）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Record_title_trgm_idx"
  ON "Record" USING GIN ("title" gin_trgm_ops);

-- JSONB 全欄位搜尋（data 內容）
CREATE INDEX IF NOT EXISTS "Record_data_gin_idx"
  ON "Record" USING GIN ("data" jsonb_path_ops);

-- 近義詞搜尋的 tsvector 欄位留待搜尋 Task（TASK-00X）再建，
-- 需先設定同義詞字典（thesaurus / synonym），此處只先打地基。
