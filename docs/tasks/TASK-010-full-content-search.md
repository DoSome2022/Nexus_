STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-010: 全欄位內容搜尋（Google 式）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

TASK-003/006 的搜尋只比對**標題**。實務上資料的價值在 `data` 內容（如「hangs」這筆：
`修改日子: 2026-11-02`、`內容: 數千字 markdown`），打「網頁」這類內容字眼完全找不到。
使用者要求 Google 式搜尋：輸入內容關鍵字就找得到、關鍵字越多結果越精確。

使用者確認的三個決策：
1. **保密資料內容也要搜**（內容仍不進 DB，查詢時讀作者自己的 localdata 檔案）
2. **日期衍生詞**：打「11月」能找到 `2026-11-02`（含文字內的 `2026/11/2`）
3. **結果頁顯示命中片段 + 高亮**（下拉建議維持只顯示標題）

## 範圍 (Scope)

- In scope:
  - `Record.searchContent`（非保密內容索引文字；保密一律 NULL）+ trgm GIN + CHECK 約束
  - `searchVector` 改為 `title + searchContent`（同義詞路徑也吃到內容）
  - 寫入路徑：create/update 以 `buildSearchContent` 計算（data + title 日期衍生詞）
  - 查詢切詞：空白切分、去重、上限 10、每詞 AND；ILIKE 萬用字 escape
  - 排序：命中標題詞數 → ts_rank → updatedAt
  - 保密：作者自己的列讀 localdata 檔案做同套 extractor 比對、合併排序
  - `record.search` 加 `withSnippet`；結果頁片段 + `<mark>` 高亮
  - Backfill script（不 bump updatedAt、冪等）+ seed 補值
- Out of scope:
  - 中文分詞（沿用純 substring + 同義詞向量，ILIKE 是主力）
  - 保密資料同義詞（送 PG 違反 TASK-004「內容不進 DB」精神；僅字面 + 日期詞）
  - 段落級 snippet 欄位對應（片段以第一個命中開窗）
  - 全形數字 / 其他日期格式（支援 `Y-M-D`、`Y/M/D`、`Y年M月D日`、`Y年M月`）

## 驗收標準 (Acceptance Criteria)

- [x] 「網頁」找到 hangs（內容命中）；「11月」找到 hangs 與 Q4 產品例會（日期衍生詞）
- [x] 多詞 AND：「網頁 工程師」命中、「網頁 不存在詞」空
- [x] demo 搜「體檢」找到自己保密資料（localdata 內容）；admin 看不到他人保密
- [x] demo 搜「11月」找到「驗證：週會 2026-11-02」（title 日期衍生詞）
- [x] `%`、`_` 為字面（無 LIKE 萬用字注入）；`_` 只命中內容真的含 `_` 的記錄
- [x] 結果頁 SSR 有片段 + `<mark>`；suggest 下拉/關聯選取器標題式顯示但內容命中
- [x] DTO 白名單：不回傳 data/schema/searchContent；snippet 經 canRead 過濾後才產生
- [x] 保密檔案損毀 → 跳過該筆 + 結構化 log，不中斷搜尋
- [x] Backfill 後不變式：非保密無 NULL、保密無內容文字（0/0）
- [x] Harness 全過 + 單測 163 案（新增/更新 33 案）
- [x] 實測報告：`docs/tests/TASK-010-full-content-search-test.md`

## 技術方案 (Approach)

- 涉及檔案：
  - 新增 `src/lib/search-text.ts`（純函式）、`src/components/highlight-snippet.tsx`、
    `harness/scripts/backfill-search-content.ts`、`harness/unit/search-text.test.ts`
  - 修改 `prisma/schema.prisma` + 新 migration `20261102121320_add_search_content`、
    `src/server/services/record-service.ts`（create/update/search）、
    `src/lib/schemas/record.ts`、`src/server/trpc/routers/record.ts`、
    `src/app/search/page.tsx`、`harness/scripts/seed-test-data.ts`、
    `harness/unit/record-{service,update,schema}.test.ts`、`package.json`
- DB migration：有（`searchContent` TEXT + CHECK + searchVector 重建 + trgm GIN；
  回滾 SQL 見下）
- 影響 API：`record.search` 新增輸入 `withSnippet`（預設 false）、回傳加 `snippet`
- `searchContent` 佈局：`<data 扁平文字，\n 連接>` + U+001F + `<日期衍生詞>`
  （U+001F 分隔讓 snippet 只取顯示段；控制字元 extraction 時剝除）
- 多詞 SQL：`Prisma.sql` / `Prisma.join` 組固定片段，term/pattern 一律參數化；
  每詞 `(title ILIKE OR searchContent ILIKE OR searchVector @@ tsquery)` AND 連接
- 保密合併：`findMany(authorId=actor, isConfidential)` → `readRecordFile` →
  `buildSearchContent` → `matchesAllTerms`；rank=0；共用 comparator 合併排序

## 安全考量 (Security)

- 權限檢查點：SQL 先過 `isPublic OR authorId`、保密僅作者列；canRead 兜底（含保密檔案掃描前）
- 輸入驗證（Zod）：q 1-200、limit 1-100、withSnippet boolean
- ILIKE 萬用字：`escapeLikePattern`（先 `\` 再 `%` `_`）+ SQL `ESCAPE '\'`
- 保密內容不進 DB：service 不寫 + CHECK `Record_confidential_no_search_content` + backfill 防禦清除
- DTO 白名單：絕不回傳 `data`/`schema`/`searchContent`；snippet 為純文字（React escape）
- 保密檔案掃描錯誤：只 log recordId 與 error name，不印內容/路徑
- Rate limit：沿用 60/min/user

## Harness

- 單元測試：`search-text.test.ts`（新增 26 案）；`record-service.test.ts`（+6）、
  `record-update.test.ts`（+5）、`record-schema.test.ts`（+1）
- 整合驗證：tsx 一次性腳本對真實 DB（見測試報告）；SSR curl 登入驗證片段與 `<mark>`
- E2E：未另開 Playwright（沿用既有流程）

## 風險與回滾

- 風險：
  - Migration 重建 generated column 會 rewrite `Record` 表（現 20 筆無感；正式環境需維修窗口）
  - migration 與 backfill 之間內容搜尋不完整（`migrate deploy` 後立即跑 `npm run backfill:search`）
  - 保密掃檔成本：每次搜尋/建議讀作者全部保密檔案（debounce 300ms + 60/min 限制內；未來可快取）
  - 中文 thesaurus 特性：`plainto_tsquery('nexus_zh','員工')` 展開為 `'僱員' & '同事'`，
    向量是次要匹配（ILIKE 主力）
  - Prisma 不 diff Unsupported 欄位/CHECK 約束：手寫 migration（TASK-006 慣例），`migrate status` 把關
- 回滾方式（SQL）：
  ```sql
  DROP INDEX "Record_search_content_trgm_idx";
  DROP INDEX "Record_search_vector_idx";
  ALTER TABLE "Record" DROP COLUMN "searchVector";
  ALTER TABLE "Record" ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (to_tsvector('nexus_zh'::regconfig, coalesce("title", ''::text))) STORED;
  CREATE INDEX "Record_search_vector_idx" ON "Record" USING GIN ("searchVector");
  ALTER TABLE "Record" DROP CONSTRAINT "Record_confidential_no_search_content";
  ALTER TABLE "Record" DROP COLUMN "searchContent";
  ```
