-- TASK-010：全欄位內容搜尋
-- 1) 內容索引文字（保密資料維持 NULL；內容仍只在 localdata）
-- 2) 安全不變式：保密資料不得有 DB 內容索引文字
-- 3) 重建 generated tsvector（title + searchContent；generated column 依賴 config，需先 drop）
-- 4) 內容子字串索引（ILIKE 用 pg_trgm）
-- 5) Prisma drift 修正：data GIN index（TASK-008 起遺留，drop/recreate 對齊 schema）
-- 註：generated column 的 DROP DEFAULT 為非法（PG：is a generated column），故省略

-- AlterTable
ALTER TABLE "Record" ADD COLUMN "searchContent" TEXT;

-- 安全不變式：保密資料不得有 DB 內容索引文字（service 層亦強制）
ALTER TABLE "Record" ADD CONSTRAINT "Record_confidential_no_search_content"
  CHECK (NOT "isConfidential" OR "searchContent" IS NULL);

-- 重建 generated tsvector（PG 對 generated column 存依賴，改表達式需 drop 重建）
DROP INDEX "Record_search_vector_idx";
ALTER TABLE "Record" DROP COLUMN "searchVector";
ALTER TABLE "Record" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'nexus_zh'::regconfig,
      coalesce("title", ''::text) || ' ' || coalesce("searchContent", ''::text)
    )
  ) STORED;
CREATE INDEX "Record_search_vector_idx" ON "Record" USING GIN ("searchVector");

-- 內容子字串索引
CREATE INDEX "Record_search_content_trgm_idx"
  ON "Record" USING GIN ("searchContent" gin_trgm_ops);

-- DropIndex（Prisma drift 修正，TASK-008 遺留）
DROP INDEX "Record_data_gin_idx";

-- CreateIndex
CREATE INDEX "Record_data_gin_idx" ON "Record" USING GIN ("data" jsonb_path_ops);
