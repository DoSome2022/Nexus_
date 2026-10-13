# TASK-003 搜尋 + 資料建立測試報告

- **日期**：2026-10-13
- **範圍**：搜尋權限過濾、保密建立（檔案+DB 混合）、檢視、互斥驗證、rate limit、頁面渲染
- **環境**：dev server（localhost:3000）+ Docker db + localdata/
- **方法**：curl（tRPC v11 格式）+ psql + 檔案檢查 + 單元測試
- **結論**：**全過，0 bug**；測試中發現 tRPC v11 query 參數格式與 v10 不同（記錄於「踩坑」）

## 測試結果

| # | 類別 | 測試 | 結果 |
|---|---|---|---|
| 1 | 搜尋 | demo 搜「會議」 | ✅ 1 筆公開（公司會議紀錄） |
| 2 | 搜尋 | demo 搜「機密」 | ✅ 2 筆保密（作者可見自己的） |
| 3 | 權限 | admin 搜「會議」 | ✅ 只看到公開 1 筆 |
| 4 | 權限 | admin 搜「機密」 | ✅ 0 筆（他人保密不可見） |
| 5 | 權限 | admin 搜「目標」 | ✅ 0 筆（他人私有不可見） |
| 6 | 檢視 | demo 檢視自己保密資料 | ✅ 內容從 localdata 檔案載入（Q1 調整 5%） |
| 7 | 檢視 | admin 檢視他人保密資料 | ✅ 404 NOT_FOUND、回應無路徑/ID 洩漏 |
| 8 | 建立 | tRPC mutation 建立保密資料 | ✅ 檔案 0600 寫入 localdata/、DB data/schema 為 NULL、isConfidential=true |
| 9 | 審計 | 建立寫 OperationLog | ✅ CREATE + durationMs |
| 10 | 驗證 | 保密+公開互斥 | ✅ Zod BAD_REQUEST（提及保密互斥訊息） |
| 11 | 權限 | 新保密資料 demo 可搜、admin 不可 | ✅ |
| 12 | rate limit | 搜尋 60/min/user（連打 65 次） | ✅ 第 61 次起 429 TOO_MANY_REQUESTS |
| 13 | 頁面 | /search 結果頁 HTML | ✅ 列表 + 保密 Badge 渲染 |
| 14 | 頁面 | /records/[id] 檢視頁 | ✅ 標題 + JSON 內容渲染 |
| 15 | 頁面 | admin 存取他人保密頁面 | ✅ 404 |
| 16 | 單測 | 54 個單元測試（schema/權限兜底/回滾/儲存層） | ✅ 全過 |
| 17 | 清理 | curl 測試資料（Record/OperationLog/檔案） | ✅ 已清除 |

## 踩坑記錄

1. **tRPC v11 query 參數格式變了**：v10 用 `?input={"json":{...}}`，v11 直接 `?input={...}`
   （錯誤徵狀：Zod 收到 `q: undefined` → BAD_REQUEST）。mutation 仍為 POST body。
2. **Prisma 7 nullable Json 不接受 `null`**：要 SQL NULL 就直接**省略欄位**（undefined），
   不要傳 `null`（型別錯誤：`NullableJsonNullValueInput`）。
3. **shadcn Button 無 `asChild`**（@base-ui/react 版本）：用 `buttonVariants()` + Link 組合。
4. **zodResolver + zod `.default()`**：schema 帶 default 時 input 型別為 optional，
   與 `useForm<T>` 的 output 型別衝突；改由 `defaultValues` 提供預設值。

## 重現方式（命令摘要）

```bash
npm run seed:test   # demo 使用者 + 7 筆測試資料（公開×3/私有×2/保密×2）

# tRPC v11 查詢格式（注意 input 直接是參數物件）
curl -b cookies.txt -G http://localhost:3000/api/trpc/record.search \
  --data-urlencode 'input={"q":"機密"}'

# mutation
curl -b cookies.txt -X POST http://localhost:3000/api/trpc/record.create \
  -H "content-type: application/json" \
  -d '{"title":"…","dataJson":"{\"a\":1}","isPublic":false,"isEditableByOthers":false,"isConfidential":true}'
```

## 已知限制（設計上接受，非 bug）

- 中文模糊搜尋：pg_trgm 為字元層級 trigram，中文子串搜尋效果需大資料量實測（近義詞/全文留 TASK-006）
- 內容（data）全文搜尋未做（僅標題）
- in-memory rate limit 重啟歸零（同 TASK-002）
