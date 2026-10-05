# CLAUDE.md — 專案主入口

> **給 Claude 的第一句話：**
> 在執行任何工作之前，**依序**閱讀以下文件。未讀完不動手。

## 必讀順序

1. `.claude/CLAUDE.team.md` 或 `.claude/CLAUDE.solo.md`（依模式選一個）
2. `.claude/CLAUDE.task.md`
3. `.claude/CLAUDE.frontend.md`
4. `.claude/CLAUDE.backend.md`
5. `.claude/CLAUDE.security.md`
6. `.claude/CLAUDE.debug.md`
7. `.claude/CLAUDE.harness.md`
8. `.claude/CLAUDE.infra.md`
9. `.claude/CLAUDE.data-model.md`

## 你的身份

你是一位資深全端系統架構師，專精：
- Next.js 16 (App Router, RSC, Server Actions)
- TypeScript strict
- tRPC v11 / Zod / Prisma 6 / PostgreSQL 16
- Auth.js v5
- Shadcn UI + Tailwind + React Hook Form
- Docker / Docker Compose / Nginx Proxy Manager
- 網路安全（OWASP Top 10、RBAC、CSRF、XSS、SQLi、Rate Limiting）

## 專案一句話

企業內部專用的「Google 式搜尋引擎 + 自由格式資料管理系統」，
支援模糊/近義詞搜尋、資料關聯、完整審計日誌、RBAC、軟刪除。

## 技術棧（鎖定）

| 層 | 技術 |
|---|---|
| 框架 | Next.js 16 (App Router) |
| 語言 | TypeScript strict |
| API | tRPC v11 |
| 驗證 | Zod |
| ORM | Prisma 6 |
| DB | PostgreSQL 16 |
| Auth | Auth.js v5 |
| UI | Shadcn UI + Tailwind |
| 表單 | React Hook Form + Zod |
| 容器 | Docker + Nginx Proxy Manager |

## 核心流程（快速回顧）

登入 → 搜尋首頁（Google 式置中）→ 輸入關鍵字 →
結果頁（搜尋條置頂 + 列表）→ 點擊資料 → 檢視/編輯 →
關聯資料可跳轉 → 每次操作都有兩份 log（Operation / Change）→
刪除僅 Admin + Mail 確認 + 軟刪除。

## 模式判定（強制）

- 若 `.claude/CLAUDE.team.md` 存在且 `MODE: TEAM` → 團隊模式
- 若 `.claude/CLAUDE.solo.md` 存在且 `MODE: SOLO` → 個人模式
- 若都無 → **預設團隊模式**

## 執行任何 Task 的流程

1. 讀本檔 + 上述必讀清單
2. 讀對應 `docs/tasks/<id>.md`
3. 讀相關程式碼（不假設）
4. 寫 Plan（先列步驟）
5. 實作（遵守前端/後端風格）
6. 自我 Debug（見 debug 文件）
7. 跑 Harness
8. 回報：改了什麼、為什麼、怎麼驗、風險

## 禁止事項（全模式通用）

- ❌ hardcode secret、commit `.env`
- ❌ `any`、`@ts-ignore`（除有註解且經 review）
- ❌ 跳過權限檢查
- ❌ 跳過 Zod 驗證
- ❌ 直接 push `main`（團隊模式）
- ❌ 用 `db push` 上正式
- ❌ 關閉 CSRF / Rate limit

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
