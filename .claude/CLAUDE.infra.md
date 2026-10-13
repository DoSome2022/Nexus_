# CLAUDE.infra.md — 基礎設施與部署

## 架構
[Internet]
↓ HTTPS
[Nginx Proxy Manager] ← SSL, 安全標頭, rate limit, WS
↓ HTTP (internal)
[Next.js 16 container]
↓
[PostgreSQL container] ← volume 持久化

## docker-compose 服務

- `app`：Next.js（bind mount `./localdata:/app/localdata` 持久化保密資料）
- `db`：PostgreSQL 16
- `npm`：Nginx Proxy Manager

## 網路隔離

- `frontend` network：npm ↔ app
- `backend` network：app ↔ db
- **db 只在 backend**

## Dockerfile 規範

- 多階段建置
- base：`node:20-alpine`
- 非 root 使用者
- `.dockerignore` 排除 `node_modules`、`.env`、`.git`
- healthcheck 必備

## 環境變數

- `.env` 不進映像
- compose 用 `env_file`
- 啟動時 `src/env.ts`（Zod）驗證
- `LOCALDATA_DIR`：localdata 目錄（預設 `./localdata`，對應 app 容器 bind mount `/app/localdata`）

## Migration

- 開發：`prisma migrate dev`
- 正式：`prisma migrate deploy`（**禁止 `db push`**）
- 部署流程：build → migrate deploy → start

## Nginx Proxy Manager 設定

- SSL：Let's Encrypt
- WebSocket：開啟（tRPC subscription 若用）
- 安全標頭：見 `CLAUDE.security.md`
- rate limit：於 NPM 層再加一層

## 健康檢查

- `/api/health`：檢查 app
- `pg_isready`：檢查 db
- NPM 檢查 upstream

## localdata 備份（TASK-004）

- localdata 檔案不隨 DB backup，需獨立備份（rsync / tar 定期排程）
- `.gitignore`、`.dockerignore` 排除 `localdata/`
- 目錄由 app 啟動時自動建立（fresh clone 不需手動 mkdir）

## 禁止

- ❌ 在 Dockerfile 寫 secret
- ❌ 用 root 跑 app
- ❌ 正式用 `db push`
- ❌ 把 db 暴露到 public network