# Nexus — 企業內部搜尋引擎 + 自由格式資料管理系統

Google 式全文搜尋（模糊/近義詞/全欄位內容）、自由格式資料管理、
資料關聯與關聯建議、表單範本、完整審計日誌、RBAC 權限、軟刪除。

技術棧：Next.js 16 (App Router) · TypeScript strict · tRPC v11 · Zod ·
Prisma 7 · PostgreSQL 16 · Auth.js v5 · Shadcn UI + Tailwind · Docker Compose

---

## 第一次使用（開通帳號）

### 1. 前置需求

- Node.js ≥ 20、npm
- Docker（本專案以 PostgreSQL 16 容器開發；自備 PG 亦可，但需 pg_trgm 擴充與
  `nexus_zh` 全文檢索配置 + `infra/pg-tsearch/` 同義詞字典，建議直接用 compose 的 db）

### 2. 設定環境變數

```bash
cp .env.example .env
```

`.env` 內必須改的：

| 變數 | 說明 |
|---|---|
| `POSTGRES_PASSWORD` | 資料庫密碼（與 `DATABASE_URL` 內的密碼一致） |
| `DATABASE_URL` | 本機開發預設 `postgresql://nexus:<密碼>@localhost:5434/nexus?schema=public` |
| `AUTH_SECRET` | 至少 32 字元，用 `openssl rand -base64 32` 產生；錯誤/太短會在啟動時直接擋下 |
| `APP_URL` / `AUTH_URL` | 本機填 `http://localhost:3000`；部署時改公開 HTTPS 網域 |

`COMPOSE_PROJECT_NAME=nexus` 請保留（目錄名 `Nexus_` 會產生非法 image tag）。

### 3. 啟動資料庫

```bash
docker compose up -d db
```

- 本機連線埠為 **127.0.0.1:5434**（5432 被其他容器佔用，故用 5434）
- compose 已掛載同義詞字典 `infra/pg-tsearch/` 進容器（近義詞搜尋用，勿刪）

### 4. 安裝相依 + 建立 schema

```bash
npm install
npx prisma migrate deploy
```

（正式環境同樣用 `migrate deploy`，**禁止 `db push`**。）

### 5. 開通第一個 admin 帳號

```bash
npm run db:seed
```

- 建立 `admin@nexus.local`（**ADMIN** 權限）
- **未設定密碼時會隨機產生，且只在終端顯示一次** —— 務必立即記下
- 想自訂帳號/密碼：在 `.env` 加入 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 再跑一次
  （帳號已存在時會略過，不會覆寫舊密碼）

### 6. 啟動並登入

```bash
npm run dev
```

- 開 `http://localhost:3000` → 未登入自動導向 `/login`
- 登入失敗超過 **5 次/分鐘/IP** 會被暫時擋下（rate limit）

### 7.（可選）建立 demo 使用者與示範資料

```bash
npm run seed:test
```

- 建立 `demo@nexus.local`（**USER** 權限，預設密碼 `demo123456`，可用 `DEMO_PASSWORD` 覆寫）
- 附示範資料：公開/私有/保密記錄、表單範本、關聯建議（用來驗證權限過濾與搜尋）

---

## 帳號開通現況（重要）

- **沒有自助註冊頁面、沒有使用者管理 UI、沒有改密碼功能**（企業內部設計，帳號由管理員建立）
- 目前開帳號的途徑只有上述兩個 seed 指令（`db:seed` → ADMIN、`seed:test` → demo USER）
- 若要為同事開一般使用者帳號，建議另開 Task 建使用者管理功能
- 所有寫入操作都有 OperationLog + ChangeLog 兩份審計

## 常用指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器（http://localhost:3000） |
| `npm run build` | 正式建置 |
| `npm run lint` / `npm run typecheck` | 程式碼檢查（提交前必跑） |
| `npm run test` | Vitest 單元測試 |
| `npm run db:seed` | 建立 admin 帳號 |
| `npm run seed:test` | demo 帳號 + 示範資料 |
| `npx prisma migrate deploy` | 套用 DB migration（正式亦用此指令） |
| `npm run backfill:search` | 既有資料回填 `searchContent`（migration 後跑一次，冪等） |

## 文件索引

- `CLAUDE.md` — 開發規範入口（必讀順序、Task 流程）
- `docs/tasks/` — 各 Task 規格；`docs/tests/` — 實測報告；`docs/adr/`、`docs/debug/`
- `.claude/CLAUDE.*.md` — 前端/後端/安全/Harness/基礎設施等編碼守則

## 部署（簡短）

```bash
docker compose up -d
```

一次起 `app`（Next.js）+ `db`（PostgreSQL）+ `npm`（Nginx Proxy Manager）。
部署流程為 build → `migrate deploy` → start；NPM 管理台在 `http://<host>:81`
（首次登入 `admin@example.com` / `changeme`，請立即改）。
SSL、安全標頭、`AUTH_URL`/`APP_URL` 改公開 HTTPS 網域、`localdata/` 獨立備份等，
詳見 `.claude/CLAUDE.infra.md` 與 `.claude/CLAUDE.security.md`。
