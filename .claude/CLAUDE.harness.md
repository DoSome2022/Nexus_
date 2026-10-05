# CLAUDE.harness.md — Harness 測試與驗證框架

> Harness = 讓你「快速、可信、可重複」驗證變更的全套工具與流程。
> 任何 Task 完成前，**必須**跑對應 Harness。

## 目錄結構

```
harness/
├── unit/          # Vitest
├── integration/   # tRPC + Prisma（testcontainer）
├── e2e/           # Playwright
├── fixtures/
├── factories/
└── scripts/
    ├── check.sh      # lint + typecheck + test + build
    └── seed-test.sh
```

## 測試金字塔

| 層 | 團隊模式 | 個人模式 |
|---|---|---|
| 單元 (Vitest) | service/util ≥ 80% | 核心邏輯必測 |
| 整合 (tRPC + DB) | 每 procedure 至少 1 案 | 核心 procedure 必測 |
| E2E (Playwright) | 登入/搜尋/CRUD/權限/刪除 | 登入 + 搜尋 + CRUD |

## 必測清單（安全與權限）

- [ ] 未登入無法存取受保護頁面 / procedure
- [ ] `isPublic=false` 的資料，非作者搜尋不到
- [ ] `isEditableByOthers=false` 的資料，非作者無法編輯
- [ ] 非 Admin 無法刪除
- [ ] 刪除需 mail 確認，且為軟刪除
- [ ] 所有輸入經 Zod，非法輸入被拒
- [ ] Rate limit 生效
- [ ] Audit log 有寫入（Operation + Change）
- [ ] 搜尋支援近義詞與全欄位

## 執行

```bash
./harness/scripts/check.sh
```

或分開跑：

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

## CI 要求

- 團隊模式（每個 PR 必過）：
  1. lint
  2. typecheck
  3. test（含 coverage 門檻）
  4. build
  5. prisma migrate diff 一致
- 個人模式：至少 lint、typecheck、build。
