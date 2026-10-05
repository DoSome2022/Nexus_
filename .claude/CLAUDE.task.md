# CLAUDE.task.md — Task 規範

## 每個 Task 的存放位置

`docs/tasks/TASK-<id>-<slug>.md`

例：`docs/tasks/TASK-001-user-login.md`

## Task 模板（複製此格式）

```md
# TASK-<ID>: <簡短標題>

## 模式
- [ ] Team
- [ ] Solo

## 背景 (Why)
為什麼要做？解決什麼問題？

## 範圍 (Scope)
- In scope:
- Out of scope:

## 驗收標準 (Acceptance Criteria)
- [ ] 條件 1
- [ ] 條件 2

## 技術方案 (Approach)
- 涉及檔案：
- DB migration：有/無
- 影響 API：有/無（列出 tRPC procedure）

## 安全考量 (Security)
- 權限檢查點：
- 輸入驗證（Zod）：
- Rate limit：

## Harness
- 單元測試：
- 整合測試：
- E2E：

## 風險與回滾
- 風險：
- 回滾方式：
```

## Claude 執行流程（強制）

1. 讀 CLAUDE.md → 確認模式
2. 讀本 Task md → 確認驗收標準
3. 讀相關程式碼
4. 寫 Plan
5. 實作
6. 自我 Debug
7. 跑 Harness
8. 回報

## Task 命名規範

- TASK-001 起，遞增不重用
- slug 用 kebab-case
- 若 Task 廢棄：檔名加 `.cancelled.md`，不刪除

## Task 狀態

在 Task md 頂部維護：

```
STATUS: [ ] todo  [ ] in-progress  [ ] review  [ ] done
```
