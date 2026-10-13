STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-006: 近義詞搜尋（tsvector + synonym dictionary）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

搜尋目前只有標題 ILIKE（pg_trgm），輸入「僱員」找不到「員工」類資料。
本 Task 導入 PostgreSQL 全文檢索：synonym dictionary（同義詞字典）+ tsvector generated column，
讓「員工 ↔ 僱員/同事」等近義詞互相命中，並保留原有模糊搜尋。

**中文限制（誠實記錄）**：PostgreSQL default parser 無中文分詞，連續中文視為單一 token →
同義詞只對**完整詞組**有效（如 title 恰為「員工」、或詞典含「員工手冊 : 僱員手冊」條目）。
真正的中文分詞（zhparser 等）需自訂 postgres 映像編譯 → Out of scope，記錄於限制。

## 範圍 (Scope)

- In scope:
  - thesaurus 檔案 `infra/pg-tsearch/nexus_syn.syn`（進版控；種子詞條：員工/會議/年假 三組）
  - docker-compose：db 掛載 thesaurus 檔（readonly，alpine 路徑 `/usr/local/share/postgresql/tsearch_data/`）
  - migration：`nexus_syn` dictionary + `nexus_zh` TEXT SEARCH CONFIGURATION + `Record.searchVector` tsvector generated column + GIN index
  - `searchRecords` 改造：ILIKE（模糊）OR tsquery（近義詞），排序＝直接相符優先 → ts_rank → updatedAt；權限過濾/軟刪除不變
  - 同義詞維護流程文件化（改詞典 → `ALTER TEXT SEARCH DICTIONARY ... ` 重載）
- Out of scope:
  - 中文分詞器（zhparser/jieba，需自訂 postgres 映像）
  - data 內容全文搜尋（僅 title）
  - 多語言字典

## 驗收標準 (Acceptance Criteria)

- [x] `nexus_syn.syn` 掛載進 db 容器；`nexus_zh` configuration 建立成功
- [x] `Record.searchVector` generated column + GIN index 就緒（既有資料自動產生）
- [x] 搜「僱員」命中 title「員工」的資料（同義詞生效）
- [x] 搜「員工手冊」原有直接相符仍命中（ILIKE 不退化）
- [x] 權限過濾不變：他人私有/保密資料近義詞搜尋也不可見
- [x] 排序：直接相符排在近義詞命中之前
- [x] `prisma validate` + Harness 全過；無 drift 誤刪（schema 宣告 `Unsupported("tsvector")`）
- [x] 實測報告：`docs/tests/TASK-006-synonym-test.md`

## 技術方案 (Approach)

- **thesaurus**（`infra/pg-tsearch/nexus_syn.syn`）：
  ```
  員工 : 僱員 同事
  會議 : 例會 開會
  年假 : 特休 休假
  ```
- **compose**：db 加 `./infra/pg-tsearch/nexus_syn.syn:/usr/local/share/postgresql/tsearch_data/nexus_syn.syn:ro`
- **migration**（手寫 SQL，migrate dev --create-only 後編輯）：
  ```sql
  CREATE TEXT SEARCH DICTIONARY nexus_syn (TEMPLATE = synonym, SYNONYMS = nexus_syn);
  CREATE TEXT SEARCH CONFIGURATION nexus_zh (COPY = simple);
  ALTER TEXT SEARCH CONFIGURATION nexus_zh
    ALTER MAPPING FOR asciiword, word, hword, asciihword, hword_part, hword_asciipart
    WITH nexus_syn, simple;
  ALTER TABLE "Record" ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (to_tsvector('nexus_zh', coalesce(title, ''))) STORED;
  CREATE INDEX "Record_search_vector_idx" ON "Record" USING GIN ("searchVector");
  ```
  schema.prisma：Record 加 `searchVector Unsupported("tsvector")?`
  （TASK-001 教訓：索引/欄位盡量受 Prisma 管理；若 `@@index([searchVector], type: Gin)` 不支援
  Unsupported 欄位，則以 raw SQL 建 index 並在 TASK 記錄 drift 風險與還原方法）
- **searchRecords**：改用 `$queryRaw`（全部參數化，SQL 字串無使用者輸入）：
  ```sql
  WHERE "deletedAt" IS NULL
    AND ("title" ILIKE '%' || $1 || '%'
         OR "searchVector" @@ plainto_tsquery('nexus_zh', $1))
    AND ("isPublic" = true OR "authorId" = $2)
  ORDER BY ("title" ILIKE '%' || $1 || '%') DESC,
           ts_rank("searchVector", plainto_tsquery('nexus_zh', $1)) DESC,
           "updatedAt" DESC
  LIMIT $3
  ```
  回傳後仍跑 canRead 兜底（防禦性不變）
- **維護流程**：改 `nexus_syn.syn` → db 容器內 `ALTER TEXT SEARCH DICTIONARY nexus_syn (SYNONYMS = nexus_syn);`
  （不需重啟 DB；若容器重建自動生效）
- 涉及檔案：
  - 新：`infra/pg-tsearch/nexus_syn.syn`、`prisma/migrations/<ts>_synonym_search/`、`docs/tests/TASK-006-synonym-test.md`
  - 改：`docker-compose.yml`、`prisma/schema.prisma`、`src/server/services/record-service.ts`
- DB migration：有（dictionary + configuration + generated column + index）
- 影響 API：有（record.search 行為擴充，輸入/輸出形狀不變）

## 安全考量 (Security)

- SQL 全部參數化（$1 關鍵字、$2 使用者、$3 limit）；config 名 `nexus_zh` 寫死非輸入
- 權限 OR 過濾與 canRead 兜底不變（近義詞搜尋同樣受權限限制）
- thesaurus 檔 readonly 掛載、進版控；詞條由管理員維護（等同程式碼變更流程）
- Rate limit 60/min/user 不變

## Harness

- 單元測試：既有 66 案回歸（search 行為改動不大，service mock 測試不需變）；若 raw SQL 拆出純函式則補測
- 整合測試（curl + 報告）：同義詞命中、直接相符排序優先、權限過濾、無 drift（prisma validate + migrate status）
- E2E：延後

## 風險與回滾

- 風險：Unsupported tsvector 欄位 + raw SQL index 被後續 migrate dev drift 誤刪（TASK-001 教訓）
  → 實作時先驗證 `@@index` 對 Unsupported 欄位的支援；不支援則文件記錄 drift 監控與還原 SQL
- 風險：thesaurus 檔遺失/掛載失敗 → dictionary CREATE 會失敗（fail fast，易發現）
- 風險：中文無分詞 → 同義詞僅完整詞組有效（接受；zhparser 另開 Task）
- 回滾：migration 含 DROP CONFIGURATION/DICTIONARY/COLUMN 可寫反向 SQL；或 git revert + migrate down
