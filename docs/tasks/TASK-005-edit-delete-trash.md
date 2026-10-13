STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-005: 編輯 / 刪除流程 / 垃圾桶

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

核心流程剩下「檢視/編輯」與「刪除僅 Admin + Mail 確認 + 軟刪除」未完成。
本 Task 補上：編輯（含兩份 log）、刪除申請→確認→軟刪除（含保密檔案移 .trash）、
垃圾桶（Admin 可見 + 恢復）。

**Mail 確認的誠實處理**：專案尚無 SMTP 服務 → 本 Task 的「Mail 確認」以
**確認 URL（含一次性 token）顯示給 Admin** 模擬（等同郵件內容），
SMTP 實際寄送留待 mail 服務 Task 接上（DeletionRequest 設計不變，只換傳遞管道）。

## 範圍 (Scope)

- In scope:
  - `record.update`：title / data / isPublic / isEditableByOthers 可編輯；canEdit 檢查
    - 每欄位寫 ChangeLog（old → new）；**保密資料的 ChangeLog 寫入檔案 `changes` 陣列**（DB 不存內容）
    - 保密更新：新內容寫檔 → DB metadata（$transaction 含 OperationLog）→ **DB 失敗用舊內容寫回檔案**（回滾）
    - OperationLog（UPDATE）
  - 刪除流程（僅 ADMIN）：
    - `record.requestDelete`：建立 DeletionRequest（token 一次性、15 分鐘過期、存 sha256 hash）→ 回傳 token（僅顯示一次）
    - `record.confirmDelete`：token 驗證 → 軟刪除（deletedAt）+ 保密檔案移 `.trash` + OperationLog（DELETE）
  - 垃圾桶（僅 ADMIN）：
    - `record.listTrash`：deletedAt 非空列表
    - `record.restore`：deletedAt 清空 + 保密檔案移回 + OperationLog（RESTORE）
  - UI：檢視頁編輯按鈕（canEdit）/ 刪除區塊（canDelete）→ 編輯頁表單、刪除確認頁、`/trash` 頁（列表 + 恢復）
  - DTO 增加 `canEdit` / `canDelete`（依 actor 計算，UI 渲染按鈕用）
- Out of scope:
  - **RecordRelation 關聯**（獨立 TASK-007）
  - SMTP 實際寄信（本 Task 以確認 URL 顯示模擬）
  - 編輯時變更「保密」性質（storage 位置不變——DB↔檔案遷移複雜，列為限制）
  - 已軟刪除資料的檢視/編輯（垃圾桶內僅可恢復）

## 驗收標準 (Acceptance Criteria)

- [x] 作者可編輯自己的資料（title/data/可見性）；非作者編輯 → 404 不洩漏
- [x] 保密資料編輯：檔案內容更新 + changes 陣列 append ChangeLog；DB data/schema 仍為 NULL
- [x] 非保密編輯：DB 更新 + ChangeLog 每欄位一筆 + OperationLog（UPDATE）
- [x] 編輯保密資料 DB 失敗 → 檔案回滾為舊內容（無不一致）
- [x] 非 Admin 請求刪除 → 拒絕（FORBIDDEN）
- [x] Admin 刪除流程：request → 得到一次性 token → confirm 軟刪除；無效/過期 token 被拒
- [x] 保密資料刪除後檔案移入 `localdata/.trash/`；恢復後移回
- [x] 垃圾桶僅 Admin 可見；恢復後資料可再次搜尋/檢視
- [x] 編輯後搜尋結果反映新 title（updatedAt 排序）
- [x] Harness 全過 + 單測（ChangeLog diff 純函式、保密回滾、token 驗證）
- [x] 實測報告：`docs/tests/TASK-005-edit-delete-test.md`

## 技術方案 (Approach)

- **service**（`record-service.ts` 擴充）：
  - `updateRecord`：讀 → canEdit → diff 欄位（抽純函式 `diffRecordFields`）→
    保密：`readRecordFile`（舊）→ `updateRecordFile`（新 + changes）→ DB $transaction（update + OperationLog）失敗 → 舊內容寫回；
    非保密：DB $transaction（update + ChangeLog 每欄位 + OperationLog）
  - `requestDelete`：canDelete（ADMIN）→ DeletionRequest（token = randomBytes(32)，存 sha256 hash，15 分鐘）→ 回傳 token
  - `confirmDelete`：查未核准未過期 request → hash 比對 → approvedAt → 軟刪除 + （保密）`moveToTrash` → OperationLog
  - `listTrash` / `restoreRecord`：Admin；restore 清 deletedAt + （保密）`restoreFromTrash`（repository 新增，.trash 移回）
- **schema**（`record.ts` 擴充）：update（至少一欄位 refine）、deleteRequest、confirmDelete（token min 1）、restore
- **DTO**：`RecordDetailDTO` 加 `canEdit` / `canDelete`（service 依 actor + canEdit/canDelete 純函式計算）
- **UI**：
  - `src/components/record-edit-form.tsx`（client，RHF；title/dataJson/可見性三選項；保密資料鎖「儲存位置」）
  - `src/app/records/[id]/edit/page.tsx`
  - 檢視頁：編輯按鈕（canEdit）、刪除區塊（canDelete：request → 顯示確認 URL）
  - `src/app/records/[id]/delete-confirm/page.tsx`（讀 token → client 按鈕 confirmDelete → redirect /trash）
  - `src/app/trash/page.tsx`（Admin，列表 + 恢復按鈕）
- 涉及檔案：
  - 新：`record-edit-form.tsx`、`records/[id]/edit/page.tsx`、`records/[id]/delete-confirm/page.tsx`、`trash/page.tsx`、`harness/unit/record-update.test.ts`
  - 改：`record-service.ts`、`routers/record.ts`、`record.ts`（schema）、`localdata-repository.ts`（+restoreFromTrash）、`records/[id]/page.tsx`、`operation-log.ts`（action 加 DELETE_REQUEST / RESTORE）、`record-dto`（併入 service）
- DB migration：無（DeletionRequest 表已存在）
- 影響 API：有（record.update / requestDelete / confirmDelete / listTrash / restore）

## 安全考量 (Security)

- 權限：update 走 canEdit（保密僅作者）；requestDelete/confirmDelete/listTrash/restore 一律 Admin 檢查
- token：randomBytes(32)、只存 sha256、一次性（approvedAt）、15 分鐘過期；無效 token 統一錯誤訊息
- 審計：UPDATE 每欄位 ChangeLog；DELETE/RESTORE 寫 OperationLog；保密 ChangeLog 不進 DB
- 回滾：保密更新 DB 失敗 → 檔案寫回舊內容（不殘留半新狀態）
- Rate limit：寫入 30/min/user（update/delete/restore 共用）
- 路徑：restoreFromTrash 沿用 recordFilePath 的 id 白名單

## Harness

- 單元測試：`diffRecordFields`（各種欄位變化）、保密更新回滾（mock DB 失敗 → 舊內容寫回）、token 驗證（hash 比對/過期/已用）
- 整合測試（curl + 報告）：編輯（作者/他人/保密 changes）→ 刪除流程（非 Admin 拒 → request → confirm → .trash）→ 垃圾桶 → 恢復 → 再搜尋
- E2E：延後（沿用測試報告慣例）

## 風險與回滾

- 風險：保密更新「先檔後 DB」中斷 → 已設計檔案回滾；若回滾也失敗（極端）→ log error，檔案新內容 + DB 舊 metadata（可接受，記錄）
- 風險：Mail 為模擬（URL 顯示）→ SMTP 接上後改傳遞管道，流程不變
- 風險：restore 與 trash 檔案移動在 DB transaction 外 → 先 DB 後檔（DB 成功才動檔），檔案失敗 log error
- 回滾方式：無 migration；`git revert`
