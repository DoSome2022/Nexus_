-- TASK-006 修正：synonym template 每行僅支援單一同義詞（migration 1 行為不正確）
-- 改用 thesaurus template（支援多同義詞）。
-- 注意：generated column 依賴 config → 需先 drop column 才能換 dictionary

DROP INDEX "Record_search_vector_idx";
ALTER TABLE "Record" DROP COLUMN "searchVector";
DROP TEXT SEARCH CONFIGURATION nexus_zh;
DROP TEXT SEARCH DICTIONARY nexus_syn;

CREATE TEXT SEARCH DICTIONARY nexus_syn (
  TEMPLATE = thesaurus,
  DictFile = nexus_syn,
  Dictionary = simple
);

CREATE TEXT SEARCH CONFIGURATION nexus_zh (COPY = simple);

ALTER TEXT SEARCH CONFIGURATION nexus_zh
  ALTER MAPPING FOR asciiword, word, hword, asciihword, hword_part, hword_asciipart
  WITH nexus_syn, simple;

ALTER TABLE "Record" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('nexus_zh'::regconfig, coalesce(title, ''::text))) STORED;

CREATE INDEX "Record_search_vector_idx" ON "Record" USING GIN ("searchVector");
