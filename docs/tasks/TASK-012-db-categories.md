# TASK-012: 資料分類樹（Category + RecordCategory）

STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

## 模式

- [x] Solo

## 背景 (Why)

使用者希望資料有階層分類：輸入「橙」→ 找到橙的資料 → 橙屬於「水果」→ 水果屬於
「食物」；水果下還有蘋果、香蕉；食物下還有菜、肉、魚。經確認的設計決策：

- **多分類**：一筆 Record 可掛多個分類（RecordCategory join 表）
- **人人可建**：分類 CRUD 作者制（作者或 ADMIN 可改/刪），全站可見
- **完整方案**：分類瀏覽頁（樹 + 麵包屑）、搜尋結果顯示分類路徑、檢視頁分類 chips +
  同分類資料 + 分類管理元件
- 建立/編輯表單不處理分類（檢視頁管理，避免 record-service 交易複雜化）
- 分類名稱納入搜尋（ancestor namePath 進 searchContent 的 suffix 段）

## 範圍 (Scope)

- In scope:
  - Category 自關聯樹（parentId）＋ RecordCategory 多對多
  - 分類 CRUD（作者/ADMIN、per-parent 重名、cycle 檢查；刪除僅阻擋「有子分類」，
    有連結時自動解綁全部連結含垃圾桶）
  - link/unlink（record canEdit/ADMIN、上限 20、即時重建 searchContent）
  - 分類頁（/categories 樹、/categories/[id] 麵包屑瀏覽、new/edit）
  - 檢視頁分類 section + 同分類資料；搜尋結果分類路徑
  - rename/move 後子樹 searchContent 重建；backfill 併入分類名
  - seed 種子樹（食物 > 水果 > 橙/蘋果/香蕉；食物 > 菜/肉/魚）
  - **複製分類（TASK-013）**：連同子分類樹與資料連結一起複製（資料不複製）；
    新根名自動「(副本)」後綴、同層衝突遞增；人人可複製，複製者成為新樹建立者
  - **建立/編輯表單選分類（後續調整）**：createRecordSchema/updateRecordSchema 加
    `categoryIds`（≤20）；建立時同 transaction 建連結 + searchContent 併入分類名；
    編輯時「取代整組」連結（RECORD_CATEGORY UPDATE 審計）；表單加 CategoryPicker 多選
- Out of scope:
  - 分類排序、圖示、顏色、標籤權限（分類全站可見）
  - 保密資料用分類名搜尋（保密 searchContent 恆 NULL 的既有底線）
  - Browse 合併子孫資料（只列直接掛載，子分類另列）
  - 複製資料內容本身（TASK-013 只複製連結）

## 驗收標準 (Acceptance Criteria)

- [x] 分類樹建立/瀏覽/麵包屑上跳（食物 → 水果 → 橙）
- [x] 多分類連結、每筆上限 20、重複阻擋（DB unique + service）
- [x] per-parent 重名阻擋（含根層 null parent）
- [x] cycle 阻擋（不可移至自己/子孫下）
- [x] 刪除：有子分類仍阻擋；有資料連結（含垃圾桶）→ 自動解除後刪除
      （需求調整；回傳 unlinked 數、重建受影響 searchContent）
- [x] 權限：非作者 USER 不可改/刪他人分類；ADMIN 可
- [x] 搜「水果」/「食物」可命中子分類資料（ancestor namePath 進索引）
- [x] 搜尋結果顯示「食物 / 水果 / 橙」路徑
- [x] 檢視頁 chips 跳分類頁、同分類資料區塊、link/unlink 即時
- [x] 編輯 Record 不會洗掉分類名；rename/move 重建子樹索引；backfill 同步
- [x] 複製分類：子樹 + 連結一併複製、名稱避讓、人人可複製、搜尋索引同步
- [x] 建立/編輯表單可多選分類；編輯取代整組；保密資料連結可改但不寫索引
- [x] lint / typecheck / test / build 全過

## 技術方案 (Approach)

- 涉及檔案：
  - schema：`prisma/schema.prisma`（Category、RecordCategory；User/Record 加關聯）
  - migration：`prisma/migrations/20261117121322_add_categories`（**手動省略非法語句**：
    generated column 的 DROP DEFAULT 為非法；Record_data_gin_idx 的 DROP/CREATE 由引擎
    drift 偵測產生，重播時與 migration 8 撞名——dev DB 缺索引 drift 已用 psql 補回）
  - 純函式：`src/lib/category-tree.ts`（建樹/祖先/cycle/子孫，全部 visited guard 防環）
  - schema：`src/lib/schemas/category.ts`（parentId 的 null/undefined 語意）
  - 查詢/索引：`src/server/services/category-query.ts`（2 個 flat query 組 path，
    無 recursive CTE；$executeRaw 重建不 bump updatedAt）
  - service：`src/server/services/category-service.ts`、`canManageCategory` 進
    `src/server/security/permissions.ts`
  - record-service：DTO 加 `categories`/`categorySiblings`；`searchRecords` slice 後
    批次 enrich（withCategories 預設 false，熱路徑省查詢）；`getRecord` options；
    `updateRecord` 重建併入 namePath；`restoreRecord` 非保密重建
  - search-text：`buildSearchContent(title, data, categoryNames = [])`（suffix 段；
    無分類名時輸出與舊版 byte-for-byte 相同）
  - tRPC：`routers/category.ts`（list/browse/create/update/delete/link/unlink）
  - UI：categories 四頁 + category-tree-view / category-form / category-delete-button /
    category-manager；records/[id]、search、首頁修改
  - 腳本：backfill 併入分類名；seed-test-data 種子樹 + 連結（冪等）
- DB migration：有（新增 2 表 + 索引 + FK；不動 Record 表本身）
- 影響 API：有——record.search 新增 optional `withCategories`；新增 category router

## 安全考量 (Security)

- 權限檢查點：
  - 分類讀取：登入即可（全站可見）
  - 分類寫入：作者或 ADMIN（`canManageCategory`）；不存在 → NOT_FOUND、
    無權 → FORBIDDEN（分類存在性非秘密，與 Record 的統一 NOT_FOUND 不同）
  - link/unlink：record 可讀且（canEdit 或 ADMIN）；垃圾桶僅 ADMIN；統一 NOT_FOUND
  - browse 資料列表：SQL 先過（deletedAt null + 公開/作者）+ canRead 兜底
  - 同分類資料：同上 + 排除自己 + take 20
- 輸入驗證（Zod）：分類名 trim 1-100；parentId null（根）/undefined（不變更）語意；
  link 上限 20（service）
- Rate limit：所有 mutation `assertWriteAllowed`（30/min）
- 審計：CATEGORY 與 RECORD_CATEGORY 的 CREATE/UPDATE/DELETE 各一筆 OperationLog
- 索引一致性：link/unlink/rename/move/updateRecord/restore/backfill 全部重建
  searchContent；重建失敗 log 後不阻斷（derived data）；保密資料恆不寫索引
- cycle/環：service 檢查 + 純函式 visited guard（資料異常不 hang）

## Harness

- 單元測試：
  - `category-tree.test.ts`（14 案）：巢狀/排序（與實作同 collator 斷言）/環不 hang
    不遺失/祖先/path/cycle/子孫/flatten
  - `category-schema.test.ts`（7 案）：trim、null/undefined 語意、至少一項
  - `category-service.test.ts`（17 案）：作者制、重名、cycle、刪除阻擋、browse 過濾、
    link 權限/上限/重複、OperationLog
  - `category-query.test.ts`（5 案）：批次 refs/path、空 ids 不查、重建只動非保密
  - `record-service.test.ts`（+2）、`record-update.test.ts`（+3）、`permissions.test.ts`
    （+3）、`search-text.test.ts`（+4）、`db-overview*.test.ts`（10 表）
- 整合測試：無（seed:test 冪等實測兩次）
- E2E：無（手動矩陣見測試報告）

## 風險與回滾

- 風險：
  - searchContent 反正規化過期 → 所有寫入點重建 + backfill 同步；重建失敗只 log
  - per-parent 重名 race（無 DB unique；Prisma 不支援 NULLS NOT DISTINCT）→ Solo 接受
  - 移動分類 race 造成環 → 純函式 visited guard；service 先檢查
  - 熱路徑多查詢 → withCategories 預設 false，只有 /search 頁啟用
  - 分類名全站可見（含可能敏感的組織資訊）→ 需求指定；文件明載
  - 複製分類會把連結複製到他人資料上（不經其作者同意）→ 內部工具接受；
    確認對話框明示、OperationLog 可稽核、刪除副本即整樹解綁還原
  - migration 引擎對 tsvector generated column 的 DROP DEFAULT 每次都會生成 →
    後續 migration 需相同手動省略（已註明於 migration 檔內）
- 回滾方式：兩張表純新增（Record/User 無新欄位）→ `DROP TABLE "RecordCategory";
  DROP TABLE "Category";`；程式碼回滾後舊版 updateRecord/backfill 會洗掉分類名
  （僅 derived data，非資料遺失）
