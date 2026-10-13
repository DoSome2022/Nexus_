STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-007: 資料關聯（RecordRelation + 跳轉）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

核心流程最後一塊：「關聯資料可跳轉」。資料之間可建立帶 label 的關聯，
檢視頁顯示關聯列表、點擊跳到另一端資料。RecordRelation 表 TASK-001 已建（無 migration）。

## 範圍 (Scope)

- In scope:
  - `relation.create`：{ fromId, toId, label? }；**兩端都 canRead 才可建立**（保密資料自然只有作者能關聯，不洩漏存在性）；防自關聯、防重複
  - `relation.delete`：任一端的 canEdit（作者/可被他人編輯）或 Admin 可刪除
  - 檢視頁：關聯列表（label + 另一端標題，可跳轉）+ 新增關聯（輕量選取器：搜尋關鍵字 → 下拉選取）
  - 關聯顯示過濾：**另一端不可讀的關聯不顯示**（防洩漏存在性）
  - 審計：建立/刪除寫 OperationLog（targetType: RECORD_RELATION）
- Out of scope:
  - RecordRelation 加 creatorId 欄位（刪除權限以「端點 canEdit」判定，不需 migration；若未來要顯示建立者再補）
  - 關聯圖視覺化、反向自動建立（關聯是單向帶 label）
  - 批量關聯、匯入

## 驗收標準 (Acceptance Criteria)

- [x] demo 可關聯自己可讀的兩筆資料（label 可選）
- [x] 自關聯（fromId = toId）被拒
- [x] 重複關聯被拒
- [x] 對不可讀資料建立關聯被拒（含他人保密資料，不洩漏存在性）
- [x] 檢視頁顯示關聯（雙向：in/out），點擊跳轉到另一端
- [x] 另一端不可讀的關聯不顯示（如 admin 看 demo 的關聯時，私有端被隱藏）
- [x] 刪除權限：作者/可編輯者/Admin 可刪；其他人 404
- [x] OperationLog 記錄 RECORD_RELATION CREATE/DELETE
- [x] Harness 全過 + 單測（權限規則、自關聯/重複、顯示過濾）
- [x] 實測報告：`docs/tests/TASK-007-relations-test.md`

## 技術方案 (Approach)

- **service**：`src/server/services/relation-service.ts`（新）
  - `createRelation`：from≠to → 讀兩端（含 deletedAt/權限欄位）→ 任一不可讀 NOT_FOUND → 重複查詢 → 建立 + OperationLog
  - `deleteRelation`：讀 relation + 兩端 record → canEdit(任一端) 或 Admin → 刪除 + OperationLog
  - `listRelations`：併入 `getRecord` 回傳（relationsFrom/relationsTo include 對端 title/權限欄位 →
    過濾對端 canRead → 統一形狀 `{ id, direction, label, related: { id, title, isPublic, isConfidential } }`）
- **schema**：`src/lib/schemas/relation.ts`（新）：create { fromId, toId, label ≤ 100 可選 }、delete { id }
- **router**：`src/server/trpc/routers/relation.ts`（新）：create/delete（protectedProcedure + 寫入 rate limit）；root.ts 掛載
- **DTO**：`RecordDetailDTO` 加 `relations: RelationDTO[]`
- **UI**：
  - 檢視頁：關聯區塊（列表 + 跳轉連結）
  - `src/components/relation-picker.tsx`（client）：輸入關鍵字 → `trpc.record.search` 下拉（300ms debounce）→ 選取 → `trpc.relation.create` → refresh
  - `src/components/relation-item.tsx`?（刪除按鈕 client）→ `relation-delete-button.tsx`（client，canEdit 端點或 Admin 才顯示）
- 涉及檔案：
  - 新：`relation-service.ts`、`routers/relation.ts`、`schemas/relation.ts`、`relation-picker.tsx`、`relation-delete-button.tsx`、`harness/unit/relation-service.test.ts`
  - 改：`record-service.ts`（getRecord 併入 relations）、`root.ts`、`records/[id]/page.tsx`
- DB migration：無（RecordRelation 表已存在）
- 影響 API：有（relation.create / relation.delete；record.get 回傳加 relations）

## 安全考量 (Security)

- 權限：建立需兩端 canRead（他人保密資料不可關聯——看不到自然無法選取，service 層仍強制）；
  刪除需任一端 canEdit 或 Admin；無權一律 NOT_FOUND（不洩漏存在性）
- 顯示過濾：關聯另一端不可讀 → 不顯示（含 title）
- 審計：CREATE/DELETE 寫 OperationLog
- Rate limit：寫入 30/min/user 共用
- 自關聯/重複：service 層拒絕（防資料污染）

## Harness

- 單元測試：create 權限規則（不可讀端、自關聯、重複）、delete 權限（canEdit 端/Admin/無權）、顯示過濾純函式
- 整合測試（curl + 報告）：建立 → 檢視顯示（雙向）→ 跳轉 → 刪除 → 權限與過濾（admin 看 demo 關聯）
- E2E：延後

## 風險與回滾

- 風險：無 creatorId 欄位，刪除權限以端點 canEdit 判定（記錄為設計決定，未來可加欄位）
- 風險：關聯指向已軟刪除資料 → listRelations 過濾 deletedAt（與 getRecord 一致）
- 回滾方式：無 migration；`git revert`
