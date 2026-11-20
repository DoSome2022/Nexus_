# TASK-012 實測報告：資料分類樹

日期：2026-11-17（2026-11-18 更新）
範圍：分類樹/瀏覽/麵包屑、搜尋整合、檢視頁整合、權限矩陣、約束矩陣、審計、回歸

> 後續調整（2026-11-18）：**刪除分類改為自動解綁**——不再因有連結（含垃圾桶）阻擋；
> 刪除時一併解除全部連結並重建受影響資料的 searchContent（browse 回傳 linkCount 供確認對話框顯示）。
> 下方第 7 項「有連結刪除 → BAD_REQUEST」已不適用；有子分類仍阻擋。
>
> **複製分類（TASK-013）**：見下方「複製分類實測」一節。
>
> **建立/編輯表單選分類（後續調整）**：見下方「表單分類實測」一節。

## 測試環境

- dev server：http://localhost:3005（port 3000 被 hangs-app 容器佔用）
- 帳號：demo@nexus.local（USER，種子資料作者）+ 臨時 admin-test（測後已連同 5 筆 log 刪除）
- 種子：seed:test 的分類樹（食物 > 水果 > 橙/蘋果/香蕉；食物 > 菜/肉/魚）＋ 3 筆分類示範資料

## 結果

| # | 項目 | 結果 |
|---|---|---|
| 1 | /categories 全樹縮排（8 分類節點） | ✅ |
| 2 | /categories/seed_cat_fruit：麵包屑 + 子分類（橙/蘋果/香蕉）+ 底下資料（水果庫存清單） | ✅ |
| 3 | 搜「水果」→ 命中「水果庫存清單」（path 食物/水果）與「橙的營養價值」（path 食物/水果/橙）；搜「食物」命中 3 筆 | ✅ |
| 4 | 檢視頁分類 chip 連結 + 同分類資料（機密：食物供應商報價 → 兄弟：機密：合作廠商報價；未共享分類者無區塊） | ✅ |
| 5 | admin 瀏覽 /categories/seed_cat_food：demo 的私有/保密資料全部隱藏（SQL 先過 + canRead 兜底） | ✅ |
| 6 | 權限矩陣：demo 改/刪 admin 的分類 → FORBIDDEN；admin 可 CRUD | ✅ |
| 7 | 約束矩陣：有子分類刪除 → BAD_REQUEST「請先處理子分類」；有連結（含垃圾桶）刪除 → BAD_REQUEST；cycle（食物移到橙下）→ BAD_REQUEST；同層重名 → CONFLICT | ✅ |
| 8 | 審計：CATEGORY CREATE/UPDATE/DELETE 各一筆 OperationLog | ✅ |
| 9 | /admin/db 回歸：10 張表（含 分類、資料分類連結） | ✅ |
| 10 | 單元測試 261 案、lint、typecheck、build、migrate status | ✅ 全過 |
| 11 | seed:test 冪等（連跑兩次第二次 0 新增） | ✅ |

## 複製分類實測（TASK-013，2026-11-18）

| # | 項目 | 結果 |
|---|---|---|
| 1 | 建臨時樹（測試根 → 測試子 → 測試葉A/B）+ 掛 2 筆資料 | ✅ |
| 2 | 複製測試根 → 「測試根(副本)」：copiedCategories=4、copiedLinks=2 | ✅ |
| 3 | 再複製 → 名稱避讓「測試根(副本2)」 | ✅ |
| 4 | browse 副本：parent 正確、children=[測試子]、subtreeCategoryCount=4、subtreeLinkCount=2、canManage | ✅ |
| 5 | 搜「測試根(副本)」→ 兩筆資料命中，路徑同時顯示原樹與兩個副本樹（searchContent 重建生效） | ✅ |
| 6 | 非作者可複製（USER 複製，不 FORBIDDEN）；OperationLog 兩筆（CATEGORY/RECORD_CATEGORY） | ✅ |
| 7 | 清理：臨時樹與連結全刪、backfill 修正索引、零殘留 | ✅ |

註：種子分類樹（食物/水果/橙…）已由使用者實際使用中刪除（自動解綁功能生效），
實測改用臨時樹進行。

## 表單分類實測（後續調整，2026-11-18）

| # | 項目 | 結果 |
|---|---|---|
| 1 | demo 建臨時分類 | ✅ |
| 2 | record.create 帶 categoryIds → 檢視頁 chip 出現、searchContent 含分類名 | ✅ |
| 3 | record.update categoryIds=[] → 連結清空、searchContent 移除分類名 | ✅ |
| 4 | 審計：RECORD CREATE + RECORD UPDATE + RECORD_CATEGORY UPDATE 各一筆 | ✅ |
| 5 | 清理：資料/分類/相關 log 全刪，零殘留 | ✅ |

## 踩坑記錄

- **tRPC batch POST 的 body 也是 raw input**：本專案 transformer 為 identity，
  不只 GET 的 `?input=`，POST `?batch=1` 的 entry 也要 `{"0": <input>}`，
  不能包 `{"json": ...}` 外殼（包了會 Zod undefined）。
- migration 引擎對 `searchVector`（tsvector generated column）每次都會生成非法的
  `ALTER COLUMN ... DROP DEFAULT` → 手動省略（與 migration 8 相同處理，已註明於檔內）；
  引擎 drift 偵測另生成了 Record_data_gin_idx 的 DROP/CREATE → 一併省略，
  dev DB 缺索引的 drift 用 psql 補回（重播時 migration 8 已建此索引會撞名）。

## 已知限制（設計上接受，非 bug）

- 保密資料無法用「分類名」搜尋（searchContent 恆 NULL 的既有底線；保密資料自身內容仍可由作者搜尋）
- Browse 頁只列直接掛載的資料，子分類另列（不合併子孫）
- per-parent 重名靠 service 檢查（無 DB unique：Prisma 不支援 NULLS NOT DISTINCT），併發下理論上可能重複（Solo 接受）
- 分類名全站可見（人人可建的設計決策）
