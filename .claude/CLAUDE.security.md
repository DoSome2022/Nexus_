# CLAUDE.security.md — 網路安全守則

## OWASP Top 10 對策

| 風險 | 對策 |
|---|---|
| Injection | Prisma 參數化、禁動態 SQL |
| Broken Auth | bcrypt/argon2、rate limit、session 失效 |
| Sensitive Data | HTTPS、secret 不進 client、DTO 白名單 |
| XXE | 不用 XML parser |
| Broken Access Control | 每個 procedure 檢查 canRead/canEdit/canDelete |
| Misconfig | 安全標頭、關閉 debug、最小映像 |
| XSS | React 自動 escape、禁 `dangerouslySetInnerHTML`（除 sanitize） |
| Insecure Deserialization | 只信 Zod 驗證後的資料 |
| Known Vulns | `npm audit`、定期更新 |
| Insufficient Logging | OperationLog + ChangeLog |

## Auth 專屬規則

- 密碼：bcrypt cost ≥ 12 或 argon2id
- 忘記密碼 token：一次性、≤ 15 分鐘、存 hash
- Session：登出即失效用 DB session
- CSRF：Auth.js 內建 + tRPC POST
- 登入失敗：不洩漏「帳號不存在 vs 密碼錯」

## 權限模型（核心）

每筆資料：

- `isPublic=false` → 只有作者可搜尋
- `isEditableByOthers=false` → 只有作者可編輯
- 刪除：只有 ADMIN + Mail 確認 + 軟刪除
- 垃圾桶：只有 ADMIN 可見

實作：`canRead` / `canEdit` / `canDelete` 純函式，**每個 tRPC procedure 必呼叫**。

## 輸入驗證

- **所有** input 走 Zod
- 檔案上傳（若有）：限類型、限大小、掃毒
- URL 欄位：驗證 scheme

## 檔案儲存（localdata）安全（TASK-004）

- Path traversal：檔名由 recordId（cuid）+ `basename()` 白名單，禁止使用者輸入拼路徑
- 覆寫/競態：新檔 `flag: "wx"`；更新走 `.tmp` + `rename` 原子寫
- 內容洩漏：ChangeLog old/new 不寫 DB；logger 不印 data 內容
- 大小：Zod 上限（≤ 1MB）防資源耗盡
- 檔案權限：0600（容器使用者 nextjs）
- localdata 不入 git、不進 Docker image
- 明文風險：保密 ≠ 加密；如需 at-rest 加密另開 Task

## Rate Limit

- 登入：5/min/IP
- 搜尋：60/min/user
- 寫入：30/min/user
- 忘記密碼：3/hour/email

## Secret 管理

- 只從 `process.env`
- `src/env.ts` 用 Zod 啟動時驗證
- `.env` 不 commit
- `.env.example` 同步欄位

## 安全標頭（Nginx Proxy Manager）

- HSTS
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy
- CSP（依實際資源調）

## 禁止

- ❌ 關閉 CSRF
- ❌ 關閉 rate limit
- ❌ hardcode secret
- ❌ 回傳 password/token
- ❌ 用 `dangerouslySetInnerHTML` 未 sanitize
- ❌ 關閉 TypeScript strict
