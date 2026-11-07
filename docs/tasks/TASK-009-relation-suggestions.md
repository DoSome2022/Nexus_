STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-009: 自動偵測關聯建議（Relation Suggestions）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

TASK-007 的關聯是**手動**建立的（搜尋 + 選取）。實務上記錄的標題/內容常**提到**
其他記錄的標題——例如「甲君的某某網帳號」內含「甲君」與「某某網」——使用者希望系統
自動偵測這些提及並**建議**建立關聯，一鍵加入，不用自己想到去搜尋。

使用者決定的 UX（兩者都要）：
1. 檢視頁「關聯資料」區常駐「可能相關的資料 (N)」收合區塊（預設收合）
2. 建立/編輯完成後跳轉 `/records/<id>?hl=suggestions` → 區塊自動展開 + 琥珀色高亮一次

只建議、不自動建立；加入走既有 `relation.create`（兩端 canRead 服務端強制）。

## 範圍 (Scope)

- In scope:
  - `relation.suggest` query：掃描記錄標題 + data 文字值，找出「其他可讀記錄標題」的完整子字串提及
  - 配對規則：候選標題 ≥2 字；ASCII 標題邊界守衛（`IT` 不配 `WHITE`）；標題長度降冪排序（較具體優先）；上限 10 筆
  - 排除自己與已關聯（雙向，重用 getRecord DTO 內的 relations）
  - 權限：候選只含 canRead 可見記錄（SQL 先過公開/作者、只取標題與權限欄位，**不讀 data/schema**）；被檢視記錄不可讀 → NOT_FOUND
  - 保密記錄：內容從 localdata 檔案載入後掃描（getRecord 既有行為）
  - UI：`RelationSuggestions` 收合區塊（載入中渲染殼、0 筆不渲染）、一鍵加入、加入/手動增刪後 invalidate 建議清單
  - 建立/編輯成功跳轉帶 `?hl=suggestions`
  - Rate limit：60/min/user（同 search）
  - Seed：6 筆示範資料（甲君 / 某某網 / 帳號提及兩者 / 單字標題對照 / 保密提及對照）
- Out of scope:
  - 自動建立關聯（只建議）；「忽略」持久化（加入後自然消失）
  - 中文分詞（純子字串比對，誤配靠手動兜底）
  - 反向提及（單向掃描：A 的文字提到 B 的標題才建議 B）
  - 500 筆候選上限之突破（企業內部規模 OK，未來可 trigram 預篩）

## 驗收標準 (Acceptance Criteria)

- [x] 檢視「甲君的某某網帳號」→ 建議 某某網（3 字優先）、甲君；標題與 data 都掃描
- [x] 單字標題（如「王」）不被建議；無提及 → `[]`
- [x] 建立關聯後重查 → 已關聯者消失（雙向）；刪除關聯後重現
- [x] 反向查（甲君）→ 不建議帳號（單向掃描）
- [x] 保密記錄（作者）→ 內容從檔案載入後掃描，正常建議
- [x] 他人私有不洩漏；未登入 UNAUTHORIZED；第 61 次呼叫 TOO_MANY_REQUESTS
- [x] 一鍵加入寫 OperationLog（CREATE / RECORD_RELATION）
- [x] 頁面：常駐收合（`aria-expanded="false"`）；`?hl=suggestions` → 展開 + 高亮；建立/編輯後自動跳轉
- [x] Harness 全過 + 單測 127 案（新增 15 案）
- [x] 實測報告：`docs/tests/TASK-009-relation-suggestions-test.md`

## 技術方案 (Approach)

- **純函式**（`src/lib/relation-suggest.ts`）：`flattenText`（遞迴收集字串值、100k 字元預算、深度 8 守衛）、
  `containsTitle`（ASCII 邊界守衛 + 中文純 substring）、`findTitleMentions`（≥2 字、排除集合、長標題優先、cap 10）
- **service**（`record-service.ts` 擴充）：
  - `listReadableTitles(actor)`：`deletedAt IS NULL AND (isPublic OR authorId)` LIMIT 500，select 只含 id/title/權限欄位，canRead 兜底
  - `suggestRelations(id, actor)`：`getRecord`（不可讀 → NOT_FOUND；保密自動載檔）→ 排除集合 =
    自己 + `record.relations` 的 related id（**不重查關聯，避免雙查**）→ `findTitleMentions`
  - 放 record-service 而非 relation-service：record-service 已 import relation-service，反向會循環
- **router**（`relation.ts`）：`suggest` query + `checkRateLimit("suggest:<id>", 60/min)`
- **UI**：`relation-suggestions.tsx`（收合 state 初始 = autoExpand、高亮手動切換即清；載入中渲染殼、
  已載入 0 筆 → null；一鍵加入 → invalidate `relation.suggest` + refresh）；
  `relation-picker.tsx` / `relation-delete-button.tsx` 成功後同步 invalidate；
  檢視頁讀 `searchParams.hl === "suggestions"` → `autoExpand` + key 重置 state；
  `create-record-form.tsx` / `record-edit-form.tsx` 跳轉加 `?hl=suggestions`
- **Seed**：`seed_suggest_*` 6 筆；結尾計數改動態（不再 hardcode）

## 安全考量

- 候選查詢**絕不讀 data/schema**（只取標題 + 權限欄位），他人私有不洩漏
- 建議內容 = 被檢視記錄自己的文字（已通過 canRead）與可讀候選標題
- 加入關聯仍走 `relation.create`（服務端兩端 canRead + 重複檢查 + OperationLog）
- Rate limit 60/min/user；`retry: false`（不重試風暴）

## 已知限制

- 中文無分詞：純子字串比對可能誤配（如「小姐」中的「小姐」）；靠 ≥2 字、排序、手動加入兜底
- 單向掃描；候選上限 500 筆；`?hl=` 參數留在 URL（refresh 會再高亮，導航離開即消失）
- 記憶體 rate limiter 重啟即重置（專案既有限制）

## Harness

- 單測新增：`relation-suggest.test.ts`（flattenText/邊界守衛/排序/cap/排除）、
  `record-suggest.test.ts`（權限過濾、保密載檔、已關聯排除、NOT_FOUND）
- 共 127 案全過；`./harness/scripts/check.sh`（lint → typecheck → test → build）全過
