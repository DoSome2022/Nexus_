-- TASK-006：近義詞搜尋（synonym dictionary + tsvector generated column + GIN）
-- 注意：dictionary 建立時即讀取 thesaurus 檔（compose 已掛載至容器 tsearch_data/）

-- 1. 同義詞字典
CREATE TEXT SEARCH DICTIONARY nexus_syn (
  TEMPLATE = synonym,
  SYNONYMS = nexus_syn
);

-- 2. 全文檢索配置（simple 為底 + 同義詞字典）
CREATE TEXT SEARCH CONFIGURATION nexus_zh (COPY = simple);

ALTER TEXT SEARCH CONFIGURATION nexus_zh
  ALTER MAPPING FOR asciiword, word, hword, asciihword, hword_part, hword_asciipart
  WITH nexus_syn, simple;

-- 3. tsvector generated column（to_tsvector 帶 regconfig 為 immutable，可作 generated column）
ALTER TABLE "Record" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('nexus_zh'::regconfig, coalesce(title, ''::text))) STORED;

-- 4. GIN index（schema 已 @@index 納管，此處為套用）
CREATE INDEX "Record_search_vector_idx" ON "Record" USING GIN ("searchVector");
