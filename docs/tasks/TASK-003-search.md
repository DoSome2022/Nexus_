STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-003: 搜尋 + 資料建立（含 TASK-004 保密選項 UI）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

登入已完成（TASK-002），資料模型與搜尋索引（pg_trgm / jsonb GIN）已就緒（TASK-001）、
權限純函式與 localdata 儲存層已就緒（TASK-004 底層）。
下一步是核心流程：搜尋首頁 → 結果列表 → 檢視資料。
**搜尋需要資料才能測試**，因此本 Task 同時納入「建立資料」（含 TASK-004 的「保密」選項 UI），
讓搜尋 + 保密權限過濾可以端到端驗證。

## 範圍 (Scope)

- In scope:
  - tRPC client 基礎設施（react-query Provider + client，供 client 元件呼叫）
  - `record.create`：建立資料（title / data / 公開 / 可被他人編輯 / **保密**三選一）
    - 保密：先寫 localdata 檔 → DB metadata（data/schema 為 null）→ DB 失敗刪檔回滾（TASK-004 驗收）
    - 建立寫 OperationLog（CREATE）
  - `record.search`：標題模糊搜尋（pg_trgm）+ 權限過濾（canRead：公開或作者）+ 軟刪除過濾
    - 保密資料作者可搜出（Badge 標記），非作者不可見
  - `record.get`：檢視單筆（canRead 檢查；保密資料從 localdata 檔案載入內容）
  - 搜尋首頁（Google 式置中搜尋條 + 「新增資料」入口 + 登出）
  - 結果頁 `/search?q=`（搜尋條置頂 + 列表；條件走 URL searchParams、debounce 300ms、useTransition）
  - 檢視頁 `/records/[id]`
  - Rate limit：搜尋 60/min/user、寫入 30/min/user（in-memory，同 TASK-002 機制）
  - seed 測試資料（demo 使用者 + 公開/私有/保密混合資料，供權限過濾實測）
- Out of scope:
  - **近義詞搜尋**（tsvector + 同義詞字典）：需 postgres 容器掛 thesaurus 檔案 + tsvector 欄位 + migration，獨立 Task（TASK-006）做較乾淨
  - **全欄位（data 內容）搜尋**：自由格式 JSON 的內容搜尋需 searchable text 設計，獨立後續 Task；本 Task 僅標題
  - 編輯 / 刪除 / 關聯（RecordRelation）/ 垃圾桶（後續 Task）
  - Playwright E2E（沿用 curl 實測 + 測試報告慣例）

## 驗收標準 (Acceptance Criteria)

- [x] 首頁：置中搜尋條；輸入關鍵字 → `/search?q=...`
- [x] 結果頁：搜尋條置頂、條件在 URL；列表顯示 title + 可見性 Badge；無結果顯示「沒有數據」
- [x] 建立表單三選項：公開 / 私有 / 保密；選保密時「公開」「可被他人編輯」停用並強制為否
- [x] 建立保密資料：data/schema 寫入 `localdata/<id>.json`、DB data/schema 為 null；DB 失敗無孤兒檔（回滾）
- [x] 搜尋權限：`isPublic=false` 資料非作者搜不到；保密資料非作者搜不到、作者搜得到
- [x] 檢視：非作者/未授權存取 → 拒絕；保密資料內容從檔案載入；檔案遺失回報錯誤不洩漏路徑
- [x] Rate limit：搜尋 60/min/user、寫入 30/min/user 生效
- [x] 建立寫 OperationLog（CREATE，含 durationMs）
- [x] Harness（lint + typecheck + test + build）全過；新增單測（create schema、visibility 互斥、search 權限過濾邏輯）
- [x] 實測報告：`docs/tests/TASK-003-search-test.md`（登入 → 建立 → 搜尋權限 → 檢視 → rate limit）

## 技術方案 (Approach)

- **tRPC 分層**（依 CLAUDE.backend.md）：routers 只做 Zod → session → 權限 → service 呼叫
  - `src/server/services/record-service.ts`（新）：create / search / get 業務邏輯（含保密寫入順序與回滾）
  - `src/server/trpc/routers/record.ts`（新）：`create`（protectedProcedure + 寫入 rate limit）、
    `search`（protectedProcedure + 搜尋 rate limit）、`get`（protectedProcedure）
  - DTO 白名單：`record-dto.ts`（列表不含 data 內容，檢視才含）
- **搜尋實作**：`title: { contains: q, mode: "insensitive" }`（pg_trgm GIN 加速）+ `deletedAt: null` +
  OR（isPublic / authorId = me）→ orderBy updatedAt DESC → limit 50
- **保密建立順序**：`createRecordFile` → DB row → DB 失敗 `removeRecordFile` 回滾
  （localdata-repository 需新增 `removeRecordFile`；ChangeLog 對保密資料寫檔案 `changes`，建立時為空陣列）
- **前端**：
  - `src/trpc/client.ts` + `src/trpc/react.tsx`（新，@trpc/react-query Provider 掛 root layout）
  - `src/components/search-bar.tsx`（client：首頁置中 / 結果頁置頂，共用元件；結果頁 debounce 300ms + router.replace）
  - `src/components/create-record-form.tsx`（client，RHF + zodResolver；data 用 JSON textarea 貼入）
  - 首頁 `page.tsx`（server：置中搜尋條 + 新增入口 + 登出）、`src/app/search/page.tsx`（server：讀 searchParams → tRPC server caller → 列表）、`src/app/records/[id]/page.tsx` + `src/app/records/new/page.tsx`
- **Zod**（`src/lib/schemas/record.ts`）：create（title 1–200、data JSON 解析成功且 ≤ 1MB、三旗標；保密 → 強制另兩旗標 false）、search（q 1–200）
- **seed**：`harness/scripts/seed-test-data.ts`（demo@nexus.local / USER + 公開/私有/保密各數筆，保密寫入 localdata）
- 涉及檔案：
  - 新：`src/server/services/record-service.ts`、`src/server/trpc/routers/record.ts`、`src/server/trpc/lib/record-dto.ts`、`src/lib/schemas/record.ts`、`src/trpc/client.ts`、`src/trpc/react.tsx`、`src/components/search-bar.tsx`、`src/components/create-record-form.tsx`、`src/app/search/page.tsx`、`src/app/records/new/page.tsx`、`src/app/records/[id]/page.tsx`、`harness/scripts/seed-test-data.ts`、`harness/unit/*.test.ts`
  - 改：`src/server/trpc/root.ts`（掛 record router）、`src/app/layout.tsx`（TrpcProvider）、`src/app/page.tsx`（搜尋首頁）、`src/server/repositories/localdata-repository.ts`（+removeRecordFile）、`package.json`（seed-test script）
- DB migration：無
- 影響 API：有（record.create / record.search / record.get）

## 安全考量 (Security)

- 權限檢查點：create（protectedProcedure + isConfidential 強制互斥）、search（SQL 層 OR 過濾 + service 層 canRead 兜底）、get（canRead；非作者 404 不洩漏存在性）
- 輸入驗證（Zod）：title 長度、data JSON 格式 + ≤ 1MB、q 長度；error 不洩漏 SQL/路徑
- Rate limit：搜尋 60/min/user、寫入 30/min/user（in-memory）
- 保密回滾：DB 失敗刪檔；檔案遺失 → TRPCError NOT_FOUND（不洩漏絕對路徑）
- 列表 DTO 不含 data 內容（防止列表介面洩漏私有/保密內容）

## Harness

- 單元測試：create schema（JSON 非法、超 1MB、保密互斥）、search 權限過濾邏輯（service 純函式部分）、removeRecordFile
- 整合測試（curl + 測試報告）：登入 → 建立三種資料 → 作者/他人視角搜尋 → 檢視保密（檔案載入）→ rate limit
- E2E：延後（Playwright 未裝，沿用 TASK-002 測試報告慣例）

## 風險與回滾

- 風險：pg_trgm 對中文標題的模糊搜尋效果較弱（trigram 是字元層級）→ 中文情境先驗證效果；近義詞/全文改進留 TASK-006
- 風險：保密建立「先檔後 DB」若 DB 失敗已回滾；若刪檔失敗殘留孤兒檔 → 記錄為低風險（檔名含 id，可人工清理）
- 風險：in-memory rate limit 多實例不共享（Solo 接受，同 TASK-002）
- 回滾方式：無 migration；出問題 `git revert` 對應 commit
