STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-001: 專案初始化

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

專案目前只有規範文件（CLAUDE.md 與 .claude/），沒有任何程式碼。
需要建立可運行的專案骨架：Next.js 16 + TypeScript strict + tRPC v11 + Prisma 6 +
PostgreSQL 16 + Auth.js v5 + Shadcn UI，以及 Docker 基礎設施，
讓後續 Task（登入、搜尋、CRUD、刪除流程）有穩固的地基。

## 範圍 (Scope)

- In scope:
  - git repo 初始化（已完成，commit `4f4e0e3`）
  - Next.js 16 App Router 專案骨架（TypeScript strict、ESLint、Tailwind、src/ 目錄）
  - 安裝鎖定依賴：tRPC v11（server/client/react-query）、Zod、Prisma 6、Auth.js v5、
    React Hook Form + zodResolver、bcryptjs、shadcn/ui 初始化
  - `prisma/schema.prisma`（依 CLAUDE.data-model.md，補齊 relation 與 index）
  - 初始 migration + pg_trgm extension + GIN index migration
  - `src/env.ts`（Zod 啟動驗證環境變數）+ `.env.example`
  - `src/server/trpc/` 骨架（initTRPC、publicProcedure / protectedProcedure）
  - `/api/health` endpoint
  - Dockerfile（多階段、node:20-alpine、非 root、healthcheck）
  - docker-compose.yml（app / db / npm 三服務、frontend/backend 網路隔離）
  - `harness/scripts/check.sh`（lint + typecheck + test + build）
- Out of scope:
  - 登入 / 註冊功能（後續 Task）
  - 搜尋 / CRUD / 刪除流程（後續 Task）
  - Rate limit 實作（後續 Task）
  - CI / CD 設定（Solo 模式暫不需要）
  - Playwright E2E 安裝（後續 Task）

## 驗收標準 (Acceptance Criteria)

- [x] `npm run lint` 通過
- [x] `npm run typecheck` 通過
- [x] `npm run build` 通過
- [x] `npx prisma validate` 通過
- [x] `npx prisma migrate dev` 成功（初始 migration + pg_trgm/GIN migration）
- [x] `/api/health` 回傳 ok（host dev + Docker 容器均驗證）
- [x] `docker compose config` 驗證通過
- [x] `.env` 未進版控、`.env.example` 欄位完整
- [x] 專案在 Node 22（nvm 預設切換後）可正常 dev / build

## 技術方案 (Approach)

- 涉及檔案：
  - `package.json` / `tsconfig.json` / `next.config.ts` / `eslint.config.mjs`
  - `prisma/schema.prisma` + `prisma/migrations/`
  - `src/env.ts`、`src/server/trpc/trpc.ts`、`src/server/trpc/routers/health.ts`、`src/server/trpc/root.ts`
  - `src/app/api/health/route.ts`
  - `Dockerfile`、`docker-compose.yml`、`.dockerignore`、`.nvmrc`、`.env.example`
  - `harness/scripts/check.sh`
- DB migration：有（`init` + `add_search_indexes`）
- 影響 API：有（新增 health procedure 與 route）

## 安全考量 (Security)

- 權限檢查點：`protectedProcedure` 骨架建立（session 檢查預留，auth 後續 Task 接上）
- 輸入驗證（Zod）：`src/env.ts` 啟動時驗證環境變數；health procedure 用 Zod 驗證
- Rate limit：本 Task 不含 rate limit 實作（後續 Task），不關閉任何現有防護
- Secret：`.env` 不 commit、`.env.example` 只放欄位名稱與範例格式、Dockerfile 不寫 secret

## Harness

- 單元測試：env 驗證邏輯測試（Vitest，若安裝）或 `node -e` 冒煙驗證
- 整合測試：`/api/health` 手動 curl 驗證（含 DB 連線檢查）
- E2E：暫無（後續 Task 安裝 Playwright）

## 風險與回滾

- 風險：Next.js 16 與 Auth.js v5 最新版 API 可能與文件假設有出入（以實際安裝版本為準）
- 風險：Node 18 為系統預設，需切 nvm 到 22（專案放 `.nvmrc` 固定）
- 回滾方式：Solo 模式直接 commit main；若骨架有問題可 `git revert` 對應 commit，
  或整包退回 commit `4f4e0e3` 重來
