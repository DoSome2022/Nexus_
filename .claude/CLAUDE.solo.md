# CLAUDE.solo.md — 個人模式規則

MODE: SOLO

## 原則

快速迭代、**不過度工程**、但保留未來協作可能。

## Git 規範

- 可直接 commit `main`，但建議小顆粒提交
- Commit：Conventional Commits（仍建議遵守）
- 可省略 PR，但每次提交前**必須**通過 `lint` + `typecheck`

## 不可省略（安全底線）

即使個人專案，以下**一律不可省**：

- ✅ Zod schema（型別安全）
- ✅ Prisma migration（不可用 `db push` 上正式）
- ✅ Auth 檢查（不可因趕工跳過）
- ✅ Audit Log（Operation + Change 兩份）
- ✅ Rate limit（登入/搜尋/寫入）
- ✅ 輸入驗證
- ✅ 權限檢查（isPublic / isEditableByOthers / role）

## 建議

- 從第一天寫 ADR（若未來擴為團隊）
- Harness 可精簡，但核心流程必測：
  - 登入
  - 搜尋（含權限過濾）
  - CRUD
  - 刪除（軟刪除 + 權限）
  - 權限（isPublic / isEditable / role）

## 禁止

- ❌ hardcode secret
- ❌ commit `.env`
- ❌ 關閉 CSRF / rate limit
- ❌ 用 `any` 逃避型別
- ❌ 跳過 migration 直接改 DB

## 若未來要擴為團隊

- 補 `.github/PULL_REQUEST_TEMPLATE.md`
- 補 `CODEOWNERS`
- 補 CI（見 `.claude/CLAUDE.harness.md`）
- 把本檔切換為 `.claude/CLAUDE.team.md`