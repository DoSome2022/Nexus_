# TASK-009 實測報告：自動偵測關聯建議

日期：2026-11-02
帳密：`測試AC.md`（demo `demo@nexus.local / demo123456`、admin `admin@admin.com / 12345678`）

## 單元測試（vitest）

```
Test Files  14 passed (14)
     Tests  127 passed (127)
```

新增 15 案：

| 檔案 | 涵蓋 |
|---|---|
| `relation-suggest.test.ts` | flattenText（巢狀/清單/空白）、containsTitle（中文 substring、ASCII 邊界 `IT`≠`WHITE`/`Net`≠`Network`）、findTitleMentions（標題+data 掃描、長標題優先、排除集合、單字標題不建議、無提及、cap 10、保密標記） |
| `record-suggest.test.ts` | NOT_FOUND、他人私有候選不洩漏、保密記錄經檔案載入、已關聯（雙向）排除、無提及空陣列 |

`./harness/scripts/check.sh`（lint → typecheck → test → build）✅ 全過。

## API 實測（curl）

| # | 操作 | 預期 | 結果 |
|---|---|---|---|
| 1 | `relation.suggest` on 甲君的某某網帳號 | `[某某網, 甲君]`（3 字優先） | ✅ |
| 2 | on 甲君 | `[]` | ✅ |
| 3 | on 專案進度報告（無提及） | `[]` | ✅ |
| 4 | 未登入 | UNAUTHORIZED | ✅ |
| 5 | on 保密記錄（作者 demo） | `[甲君]`（檔案內容載入後掃描） | ✅ |
| 6 | 建立關聯後重查 | 甲君消失（某某網仍在） | ✅ |
| 7 | 反向查甲君 | `[]`（單向掃描） | ✅ |
| 8 | OperationLog | CREATE / RECORD_RELATION | ✅ |
| 9 | 刪除關聯後重查 | 甲君重現 | ✅ |
| 10 | 第 61 次呼叫 | TOO_MANY_REQUESTS（429） | ✅ |

## 頁面 SSR 實測（curl）

| # | 頁面 | 預期 | 結果 |
|---|---|---|---|
| 11 | 帳號檢視頁 | 「可能相關的資料」+ `aria-expanded="false"` | ✅ |
| 12 | `?hl=suggestions` | `aria-expanded="true"` + `ring-amber-300` 高亮 | ✅ |
| 13 | 無候選記錄 | 殼先出（載入後消失） | ✅（載入中渲染殼為刻意設計） |

## 未實測（依賴瀏覽器互動）

- 建立/編輯後跳轉 `?hl=suggestions` 的實際點擊流程（跳轉 URL 已由元件程式碼確保）
- 一鍵「加入」按鈕點擊（mutation 走既有 relation.create，API 已實測）
- 高亮在手動收合後消失（state 邏輯：toggle 時 setHighlighted(false)）
- 建議清單在加入/手動增刪後的即時同步（invalidate 呼叫已進 code，瀏覽器驗證）

## 環境備註

- 本次無 schema 變更，不需遷移；dev server hot-reload 即生效
- 清理：實測建立的關聯已刪除（`relation.delete`），種子資料保留為示範
