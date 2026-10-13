# TASK-007 資料關聯測試報告

- **日期**：2026-10-13
- **範圍**：關聯建立（權限/自關聯/重複）、雙向顯示、過濾、刪除權限、審計
- **環境**：dev server + Docker db（seed 資料）
- **結論**：**全過，0 bug**；測試後關聯表已清空

## 測試結果

| # | 類別 | 測試 | 結果 |
|---|---|---|---|
| 1 | 建立 | demo 關聯「公開 → 自己私有」（label 參考） | ✅ 建立成功 |
| 2 | 驗證 | 自關聯（fromId = toId） | ✅ BAD_REQUEST「不可關聯到自己」 |
| 3 | 驗證 | 重複關聯 | ✅ BAD_REQUEST「關聯已存在」 |
| 4 | 權限 | admin 關聯 demo 的保密資料 | ✅ NOT_FOUND 統一訊息（不洩漏存在性） |
| 5 | 顯示 | demo 檢視 from 端 | ✅ `out: 我的年度目標草稿 v2（參考）` |
| 6 | 顯示 | demo 檢視 to 端 | ✅ `in: 公司會議紀錄 2026-Q4`（雙向） |
| 7 | 過濾 | admin 檢視含「指向 demo 私有」的關聯 | ✅ 0 筆（另一端不可讀被隱藏） |
| 8 | 刪除 | demo（本端作者）刪除 | ✅ 成功 |
| 9 | 審計 | OperationLog | ✅ RECORD_RELATION CREATE + DELETE 各一筆 |
| 10 | 單測 | 74 個（relation-service 8 案新增） | ✅ 全過 |
| 11 | Harness | lint + typecheck + test + build | ✅ 全過 |
| 12 | 清理 | 測試關聯 + 審計資料 | ✅ 已清空 |

## 重現方式（命令摘要）

```bash
# 建立關聯
curl -b cookies.txt -X POST http://localhost:3000/api/trpc/relation.create \
  -H "content-type: application/json" \
  -d '{"fromId":"seed_public_001","toId":"seed_private_001","label":"參考"}'

# 檢視（record.get 回傳含 relations，另一端不可讀者已過濾）
curl -b cookies.txt -G http://localhost:3000/api/trpc/record.get \
  --data-urlencode 'input={"id":"seed_public_001"}'
```

## 已知限制（設計上接受）

- 關聯單向帶 label（反向需另建立）
- 無 creatorId 欄位：刪除權限以「任一端 canEdit 或 Admin」判定（未來要顯示建立者再補 migration）
- UI 刪除按鈕顯示條件為「本端 canEdit 或 Admin」（若使用者是「另一端」作者但非本端可編輯，需在另一端頁面刪除）
