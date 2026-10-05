# CLAUDE.backend.md — 後端專業編碼風格

## 原則

分層、單一職責、**輸入永不信任**、**輸出永不外洩**。

## 分層架構

```
src/server/
├── trpc/
│   ├── trpc.ts      # context, middleware, procedures
│   ├── routers/     # 依 domain 分檔
│   └── root.ts      # appRouter
├── services/        # 業務邏輯
├── repositories/    # Prisma 存取封裝
├── auth/            # Auth.js 設定、RBAC
├── audit/           # OperationLog / ChangeLog
├── security/        # rate limit, sanitize, crypto
└── lib/             # 共用工具
```

## 每個 tRPC procedure 必須

1. Zod 驗證 `input`
2. 檢查 session（`protectedProcedure`）
3. 檢查權限（`canRead` / `canEdit` / `canDelete`）
4. 呼叫 service（不把業務邏輯寫在 router）
5. 回傳**已篩選 DTO**（不直接丟 Prisma model）

## Prisma 規範

- 一律 `select` / `include`，禁止預設全欄位
- 交易用 `prisma.$transaction`
- 軟刪除：`deletedAt: DateTime?`，查詢預設過濾
- 搜尋：啟用 `pg_trgm`，對 `title` 與 `data` 建 GIN index
- Migration 命名：`<timestamp>_<snake_case_desc>`
- **正式環境用 `migrate deploy`，禁止 `db push`**

## Auth.js v5

- Session：JWT 或 DB session（登出即失效需求 → DB）
- 密碼：bcrypt（cost ≥ 12）或 argon2
- 忘記密碼：token 一次性、≤ 15 分鐘、存 hash
- RBAC：`role: 'ADMIN' | 'USER'`，middleware 檢查

## Audit Log（每個資料兩份）

1. `OperationLog`：`actorId, action, targetType, targetId, timestamp, durationMs, ip, userAgent`
2. `ChangeLog`：`targetId, field, oldValue, newValue, actorId, timestamp`

**寫入時機：**
- 建立 / 修改 / 刪除 / 檢視（VIEW 可選）
- 每次寫入都要記 `durationMs`

## 權限模型（核心）

每筆 `Record`：

- `isPublic: false` → **只有作者能搜尋到**
- `isEditableByOthers: false` → **只有作者能修改**
- 刪除：**只有 ADMIN**，且需 Mail 確認 → 軟刪除
- 垃圾桶：只有 ADMIN 可見

實作時 `canRead(record, user)` / `canEdit(record, user)` 抽成純函式，統一呼叫。

## 安全底線

- 所有輸入 Zod
- 所有查詢走 Prisma（防 SQLi）
- 所有輸出經 DTO 白名單
- Rate limit：登入 5/min、搜尋 60/min、寫入 30/min
- CSRF：Auth.js 內建 + tRPC 用 POST
- Secrets 只從 `process.env`，用 `src/env.ts`（Zod）驗證

## 錯誤處理

- 用 tRPC `TRPCError`，帶正確 `code`
- 不把 stack / SQL / 路徑回傳 client
- 內部用結構化 logger

## 禁止

- ❌ 在 router 寫業務邏輯
- ❌ `prisma.model.findMany()` 不 select
- ❌ 回傳 `password` / `token` 給 client
- ❌ `eval` / `Function` / 動態 SQL
- ❌ 關閉 TypeScript strict
