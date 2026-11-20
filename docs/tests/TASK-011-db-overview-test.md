# TASK-011 實測報告：/admin/db 資料庫總覽

日期：2026-11-17
範圍：權限矩陣、資料正確性、limit 參數、localdata 容錯、rate limit、審計、建置

> 後續調整（同日）：需求改為**資料記錄表只顯示 title 與 searchContent**，
> 已移除 searchVector raw query、localdata 讀取與相關測試（下方第 11/12/14 項為調整前記錄）。

## 測試環境

- dev server：http://localhost:3005（port 3000 被 hangs-app 容器佔用，AUTH_URL/APP_URL 覆寫為 3005）
- 測試帳號：`admin-test@nexus.local`（臨時 ADMIN，測後已連同其 12 筆 OperationLog 刪除）
- token：`.env` 的 `ADMIN_DB_TOKEN`（hex 64 字元）

## 結果

| # | 項目 | 結果 |
|---|---|---|
| 1 | 未登入 → /admin/db?token=… | ✅ 307 → /login?callbackUrl=… |
| 2 | USER（demo） | ✅ 404 |
| 3 | ADMIN 無 token | ✅ 404 |
| 4 | ADMIN 錯 token | ✅ 404 |
| 5 | ADMIN 重複 token 參數（陣列） | ✅ 404 |
| 6 | ADMIN 正確 token | ✅ 200（389KB） |
| 7 | 8 表 label 齊全 | ✅ |
| 8 | robots noindex,nofollow + referrer no-referrer meta | ✅ |
| 9 | passwordHash 完全顯示（4 使用者 4 顆 bcrypt hash） | ✅ |
| 10 | 各表總筆數與 DB count 一致（4/20/1/0/49/2/0/3；OperationLog 頁面數值 = 載入前 count，自己的 VIEW 在載入後才寫入） | ✅ |
| 11 | 保密 localdata 內容（seed_conf_001 的 data + changes 歷史） | ✅ |
| 12 | searchVector（tsvector::text，如 `'-02':4`） | ✅ |
| 13 | limit_operationLog=100 → 顯示全部 49 筆 | ✅ |
| 14 | 保密檔案暫改名 → 該列顯示「localdata 讀取失敗（LocaldataFileNotFoundError）」，8 表照常渲染；測後復原 | ✅ |
| 15 | rate limit：連打 12 次 → 前 8 正常、後 4 顯示「請求過於頻繁」 | ✅ |
| 16 | 審計：OperationLog 出現 11 筆 VIEW/DB_OVERVIEW/all（每次成功載入一筆） | ✅ |
| 17 | `/` 與 `/search` 頁面無 /admin/db 連結 | ✅ |
| 18 | lint / typecheck / test（201 案）/ build | ✅ 全過 |

## 踩坑記錄

- **base64 token 不能用**：`openssl rand -base64 48` 產生的 token 含 `+`/`/`，
  URL query 中 `+` 會被 URLSearchParams 解碼成空白 → token 永遠對不上（404）。
  改用 `openssl rand -hex 32`（64 字元、URL 安全），已寫入 .env.example 註解。
- 驗證頁面文字時注意 RSC 會在文字節點間插入 `<!-- -->`，且 HTML 內嵌 flight payload
  會重複出現同一字串（grep 次數需 ÷2 或先剝離 `<script>`）。

## 已知限制（設計上接受，非 bug）

- token 會出現在 URL / 瀏覽器歷史 / 反向代理 access log（含 proxy 未登入 redirect 的 callbackUrl）
- rate limit in-memory：重啟歸零、多實例不共享
- 每次載入新增一筆 OperationLog VIEW，長期成長
- 500 筆 + 大 JSON 可能產生大頁面（預設 20）
