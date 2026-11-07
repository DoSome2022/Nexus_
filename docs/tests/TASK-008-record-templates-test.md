# TASK-008 實測報告：表單範本系統

日期：2026-11-02
帳密：`測試AC.md`（admin `admin@admin.com / 12345678`、demo `demo@nexus.local / demo123456`）

## 單元測試（vitest）

```
Test Files  12 passed (12)
     Tests  112 passed (112)
```

新增 38 案：

| 檔案 | 涵蓋 |
|---|---|
| `template-schema.test.ts` | 欄位名 regex（中文/數字開頭/連字號被拒）、required default、0 欄/超 20 欄被拒、重複欄位名被拒、型別 enum |
| `template-data.test.ts` | snapshot roundtrip、無效 schema → null、schemaMatchesData（型別/required/未知欄位/頂層陣列）、serialize（number 轉型、中英逗號分割、boolean 恒寫入、空選填省略）、toTemplateFormValues（回填/非物件資料全空）、buildRecordFormSchema 兩模式（JSON 驗證、必填/數字/日期） |
| `template-service.test.ts` | 非 admin FORBIDDEN、名稱重複 CONFLICT、不存在 NOT_FOUND、CRUD 各寫 OperationLog（RECORD_TEMPLATE） |

`./harness/scripts/check.sh`（lint → typecheck → test → build）✅ 全過。

## API 實測（curl，Auth.js credentials 登入取 session）

| # | 操作 | 預期 | 結果 |
|---|---|---|---|
| 1 | admin `template.list` | 200，含 seed 2 範本 | ✅ |
| 2 | demo `template.create` | 403 FORBIDDEN「只有 Admin 可管理範本」 | ✅ |
| 3 | demo 開 `/templates` 頁 | 404 | ✅ |
| 4 | demo `record.create` 帶範本 + 相符資料 | 200 | ✅ |
| 5 | 同上但**缺必填欄位** | 400「資料內容不符合所選範本」 | ✅ |
| 6 | 同上但**含未知欄位** | 400 | ✅ |
| 7 | 同上但**範本不存在** | 400「所選範本不存在」 | ✅ |
| 8 | `record.update` 對相符紀錄塞未知欄位 | 400「不符合原範本格式」 | ✅ |
| 9 | `record.update` 合法變更 | 200；ChangeLog 僅 data 一筆、schema 不變 | ✅ |
| 10 | 保密 + 範本 create | DB schema/data NULL；localdata 檔含 schema snapshot | ✅ |
| 11 | admin `template.create` → `update` → `delete` | 全 200；OperationLog CREATE/UPDATE/DELETE × RECORD_TEMPLATE | ✅ |
| 12 | 重複範本名稱 | 409 CONFLICT | ✅ |

## 頁面實測（curl RSC payload 檢查）

| # | 頁面 | 預期 | 結果 |
|---|---|---|---|
| 13 | 檢視頁（範本相符公開資料） | 「表單：會議紀錄」+ 欄位標籤 + 缺值 `—` + chips | ✅ |
| 14 | 檢視頁（保密範本資料，作者） | 「表單：聯絡人」+ 姓名/電話/Email/備註（多行保留換行） | ✅ |
| 15 | 檢視頁（舊資料 schema `{}`） | raw JSON、無提示 | ✅ |
| 16 | 編輯頁（範本相符） | 「使用表單：會議紀錄」+ 值回填（含日期/list） | ✅ |
| 17 | psql 塞未知 key 後檢視/編輯 | 檢視提示「資料格式與範本不相符」+ raw JSON；編輯提示「改以 JSON 編輯」 | ✅ |
| 18 | 移除未知 key 後 | 回退為友善顯示 | ✅ |

## 環境備註

- dev server 需在 `prisma generate` 後重啟（舊 client 無 `recordTemplate`，template.list 會 500）
- 遷移 `20261102034424_add_record_template` 已手動移除 drift 雜訊（既有 GIN index 重建、searchVector DROP DEFAULT），`migrate status` = up to date、Record 所有索引完好

## 未實測（依賴瀏覽器互動）

- `/templates/new` 範本欄位編輯器的實際點擊操作（useFieldArray 增刪列）——型別/單測已覆蓋邏輯，UI 建議瀏覽器手動過一次
- AlertDialog 刪除範本的對話框互動
