STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-008: 表單範本系統（Record Templates）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

建立/編輯資料的「資料內容」是 JSON textarea，檢視頁直接印 raw JSON `<pre>`——
沒有程式基礎的使用者無法操作。資料模型早在 TASK-001 就預留了 `Record.schema Json?`
（「欄位定義」）欄位，`createRecord` 寫死 `const schema = {}` 留待本 Task。

本 Task 建立**表單範本系統**：Admin 定義範本（欄位名稱/標籤/型別/必填），
使用者在建立資料時選範本 → 依欄位填表單；檢視頁依欄位友善顯示。
無範本/資料與範本不符時回退為原 JSON 流程（工程師與舊資料不受影響）。

## 範圍 (Scope)

- In scope:
  - 新表 `RecordTemplate`（name 唯一、fields Json、createdBy、硬刪除）
  - 範本管理 UI（Admin）：`/templates` 列表、`/templates/new`、`/templates/[id]/edit`（欄位動態編輯器）
  - tRPC `template.list`（所有登入者）/ `create` / `update` / `delete`（僅 Admin，頁面 404 + API 403 雙重防護）
  - `record.create` 選用 `templateId`：服務端驗證資料相符 → `Record.schema` 寫入範本 **snapshot**（`{ v: 1, templateName, fields }`）
  - 建立/編輯頁：選範本 → 依欄位填表單（text/textarea/number/boolean/list/date）；「無範本」維持 JSON
  - 檢視頁：snapshot 相符 → 友善欄位顯示（boolean → 是/否 Badge、list → chips、textarea 保留換行）；不符 → 提示 + raw JSON
  - 保密資料：snapshot 跟著內容寫進 localdata 檔案（DB 列 schema/data 仍為 NULL）
  - 防繞：`record.update` 對「原本與 snapshot 相符」的紀錄，拒絕會破壞相符性的資料變更
  - 審計：範本 CRUD 各寫 OperationLog（targetType `RECORD_TEMPLATE`）
  - Seed：示範範本（會議紀錄 ×5 欄、聯絡人 ×4 欄）+ 範本示範資料（公開 + 保密各一）
- Out of scope:
  - 編輯頁切換範本 / 自由 JSON 紀錄轉範本（未來 TASK）
  - select/options 型別、巢狀欄位
  - 個人範本（全站共用即可）、範本匯出入、依範本搜尋
  - 範本軟刪除（硬刪除；紀錄靠 snapshot 存活）

## 驗收標準 (Acceptance Criteria)

- [x] Admin 可建立/編輯/刪除範本；重複名稱 → CONFLICT；0 欄位/重複欄位名被拒
- [x] 非 Admin：`/templates*` 頁面 404；`template.create/update/delete` API → 403
- [x] `record.create` 帶 templateId：資料不符範本（缺必填/型別錯/未知欄位）→ BAD_REQUEST，不落資料
- [x] 建立成功後 DB `Record.schema` 含 snapshot；檢視頁友善顯示；編輯頁回填
- [x] 保密資料 + 範本：DB schema/data NULL、localdata 檔含 schema snapshot、檢視頁友善
- [x] 編輯相符紀錄：ChangeLog 只記資料變更、schema 不變；直接改 API 塞未知欄位 → BAD_REQUEST
- [x] 範本編輯/刪除後，既有紀錄顯示不受影響（snapshot 不回溯）
- [x] 舊資料（schema `{}`）檢視/編輯維持 raw JSON；「無範本」建立流程不變
- [x] 範本 CRUD 寫 OperationLog（CREATE/UPDATE/DELETE × RECORD_TEMPLATE）
- [x] Harness 全過 + 單測（template schema / 純函式 / service 權限與審計，新增 38 案，共 112 案）
- [x] 實測報告：`docs/tests/TASK-008-record-templates-test.md`

## 技術方案 (Approach)

- **資料模型**：`RecordTemplate`（id/name 唯一/description/fields Json/createdById/時間戳）
  migration `20261102034424_add_record_template`（手動移除 Prisma drift 雜訊：既有 GIN index 重建與 searchVector DROP DEFAULT）
- **共用純函式**（`src/lib/template-data.ts`，可單元測試）：
  - snapshot：`buildRecordTemplateSnapshot` / `parseRecordTemplateSnapshot`（無效 → null）
  - 相符檢查：`schemaMatchesData`（欄位集合 + 型別 + required；boolean 的 required 無意義；list = string[]；date = `YYYY-MM-DD`）
  - 表單值轉換：`serializeTemplateValues`（number 轉數字、list 以中/英逗號分割、boolean 恒寫入、空選填省略）
    / `toTemplateFormValues`（編輯回填）
  - `buildRecordFormSchema(fields | null)`：單一 zod schema + 頂層 superRefine 依模式驗證
    （union 回傳型別會破壞 zodResolver 推斷；RHF 7.89 每次 render 會重設 `control._options`，動態 resolver 安全——已讀原始碼驗證）
- **template-service**（`src/server/services/template-service.ts`）：list（損壞列跳過 + error log）、
  create/update/delete（assertAdmin → FORBIDDEN；名稱重複預查 → CONFLICT；硬刪除）；每筆寫 `logOperation`
- **template router**（`src/server/trpc/routers/template.ts`）：protectedProcedure + router 層 assertAdmin（雙重防護）+ `assertWriteAllowed`
- **record-service 擴充**：
  - `resolveCreateSchema`：templateId → 讀範本 → zod 驗證 fields → `schemaMatchesData` 不符 → BAD_REQUEST → 回 snapshot
  - `assertDataStillMatchesSchema`：update 時「原本相符」的紀錄新資料也必須相符（保密分支用檔案內 snapshot）
  - 保密建立：snapshot 隨內容寫入 localdata 檔（DB 仍 NULL）
- **UI**：
  - `template-fields-editor.tsx`：RHF `useFieldArray` 動態欄位列（名稱/標籤/型別 select/必填/刪除）；boolean 的必填停用
  - `template-form.tsx`（建立/編輯共用）+ `template-delete-button.tsx`（AlertDialog 確認）
  - `template-select.tsx`（dumb 受控 select）、`record-data-fields.tsx`（FormProvider 逐欄渲染）、
    `record-data-view.tsx`（server 可直接用，React 自動轉義）
  - `create-record-form.tsx` / `record-edit-form.tsx` 改用 `RecordFormValues` + 動態 schema；
    編輯頁由 server page 算 snapshot 相符性後傳入（不可切換範本）
- **Seed**：示範範本 + 範本示範資料（冪等；admin 不存在則跳過範本並警告）

## 安全考量

- 範本管理權限：頁面層 notFound（不洩漏）+ router/service 層 FORBIDDEN（雙重）
- 資料與範本的相符性由**服務端**驗證（client 序列化不信任）；update 防繞同規則
- 名稱重複：預查 CONFLICT + DB unique 約束兜底
- 檢視/編輯的相符性判定只讀 snapshot（不 join 範本表），範本刪除不影響任何紀錄

## 已知限制

- 編輯頁不可切換範本（未來 TASK）；自由 JSON 紀錄無法就地轉範本
- list 值不可含逗號（以逗號分隔）；date 為純字串 `YYYY-MM-DD`（無時區轉換）
- 範本硬刪除不可回復（OperationLog 留審計；紀錄靠 snapshot 存活）

## Harness

- 單測新增：`template-schema.test.ts`（欄位名 regex/重複/20 欄上限/型別 enum）、
  `template-data.test.ts`（snapshot roundtrip、相符檢查、序列化、動態 form schema 兩模式）、
  `template-service.test.ts`（權限、CONFLICT/NOT_FOUND、審計寫入）
- 共 112 案全過；`./harness/scripts/check.sh`（lint → typecheck → test → build）全過
