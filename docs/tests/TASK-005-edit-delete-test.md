# TASK-005 編輯 / 刪除 / 垃圾桶測試報告

- **日期**：2026-10-13
- **範圍**：編輯（ChangeLog 雙份）、刪除申請→確認（token）、垃圾桶、恢復、權限
- **環境**：dev server + Docker db + localdata/（.trash）
- **結論**：**全過，0 app bug**；測試中兩次誤判為 tRPC v11 回應格式解析問題（見踩坑）

## 測試結果

| # | 類別 | 測試 | 結果 |
|---|---|---|---|
| 1 | 編輯 | demo 改自己私有資料 title | ✅ ChangeLog 寫入 old→new（我的年度目標草稿 → v2） |
| 2 | 編輯 | demo 改保密資料 data | ✅ 檔案 data 更新 + `changes` 陣列 append（old→new）；DB data 仍 NULL |
| 3 | 編輯 | admin 編輯他人私有資料 | ✅ 404 NOT_FOUND |
| 4 | 刪除 | 非 Admin 申請刪除 | ✅ 404（不洩漏 Admin 專屬操作） |
| 5 | 刪除 | Admin 申請 → token | ✅ 64 hex 字元；DB 存 sha256、pending、15 分鐘有效 |
| 6 | 刪除 | 錯誤 token 確認 | ✅ BAD_REQUEST「確認連結無效或已過期」 |
| 7 | 刪除 | 正確 token 確認 | ✅ 軟刪除（deletedAt 設置）+ OperationLog DELETE |
| 8 | 搜尋 | 已刪除資料搜尋不到 | ✅ 0 結果（軟刪除過濾） |
| 9 | 垃圾桶 | Admin 看到已刪除資料 | ✅ 列表含目標資料 |
| 10 | 垃圾桶 | 非 Admin listTrash | ✅ 403 FORBIDDEN |
| 11 | 恢復 | Admin restore | ✅ 垃圾桶清空、可再次搜尋 |
| 12 | 檔案 | 保密刪除 → 檔案移 `.trash` | ✅ `localdata/.trash/seed_conf_002.json` |
| 13 | 檔案 | 保密恢復 → 檔案移回 | ✅ 主目錄檔案還原 |
| 14 | 單測 | 66 個（新增 diffRecordFields / 保密回滾 / token 驗證 / 權限） | ✅ 全過 |
| 15 | Harness | lint + typecheck + test + build | ✅ 全過（新增 3 個路由） |

## 踩坑記錄

1. **tRPC v11 query 回應形狀**：`{"result":{"data":[...]}}` —— data 直接是陣列，
   不是 v10 的 `{json: [...]}` 包裝。測試解析器兩次漏掉 fallback 造成「偽空結果」，
   用原始回應比對後確認 app 行為正確。
2. **query 用 GET**：對 query procedure 用 POST 會回 METHOD_NOT_SUPPORTED（預期行為）。

## 已知限制（設計上接受，非 bug）

- Mail 為模擬：確認 URL 顯示給 Admin（SMTP 接上後只換傳遞管道）
- 編輯不可變更「保密」性質（DB↔檔案遷移留後續）
- 垃圾桶內僅可恢復，不可檢視/編輯
- 測試在 seed 資料留下痕跡：`seed_private_001` title 為「…v2」、`seed_conf_001` data 為 Q1 調整 8%（驗證編輯功能的實際產物）
