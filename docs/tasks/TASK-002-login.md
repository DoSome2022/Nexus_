STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

# TASK-002: 登入（Auth.js v5 + Credentials）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

Auth.js v5（next-auth 5.0.0-beta.32）已安裝但未接線；tRPC context 的 session 目前是 `null` TODO。
所有功能（搜尋/CRUD/權限/審計）都以「已登入使用者」為前提，登入是後續所有 Task 的前置。
企業內部系統：**不開放註冊**，帳號由 seed script 建立。

## 範圍 (Scope)

- In scope:
  - Auth.js v5 Credentials 登入（email + password，bcrypt cost 12）
  - **JWT session 策略**（含 id / email / role；maxAge 7 天）
  - `proxy.ts` 路由保護（未登入 → /login）+ tRPC `protectedProcedure` 接上真實 session（雙層防護）
  - `/login` 頁面（React Hook Form + Zod + Shadcn）+ 登出按鈕
  - 首頁改為已登入顯示（email / role + 登出；搜尋 UI 留 TASK-003）
  - 登入 rate limit：5/min/IP（in-memory 滑動視窗）
  - 登入成功寫 OperationLog（action: LOGIN）
  - seed script 建立 admin 帳號（tsx + `prisma7.config.ts` `migrations.seed`）
- Out of scope:
  - 註冊頁面（企業內部不開放，seed 建立帳號）
  - 忘記密碼（PasswordResetToken 表已建，流程留後續 Task）
  - OAuth / 第三方登入
  - Playwright E2E（建議隨 TASK-003 搜尋一起安裝，一次驗證登入+搜尋流程）

## 驗收標準 (Acceptance Criteria)

- [x] 未登入存取受保護頁面 → redirect `/login?callbackUrl=...`
- [x] 登入成功 → 回首頁，顯示 email / role，可登出
- [x] 密碼錯誤與帳號不存在顯示**相同**錯誤訊息（不洩漏帳號存在性）
- [x] 登入失敗後 `session` 不建立；登出後 cookie 清除、再存取受保護頁面被 redirect
- [x] 登入 rate limit 5/min/IP 生效（第 6 次起被拒）
- [x] `protectedProcedure`：無 session 回 UNAUTHORIZED、有 session 可通過（health.check 保持 public）
- [x] seed 建立 admin（bcrypt cost 12，密碼不 hardcode、從 env 或隨機產生並顯示一次）
- [x] 登入成功寫 OperationLog（actor、ip、userAgent、durationMs）
- [x] Harness（lint + typecheck + test + build）全過；新增單測（rate limit、login schema）

## 技術方案 (Approach)

- **Session 策略：JWT**（deviation 記錄）：credentials provider 官方搭配 JWT；登出即清 cookie、7 天過期。
  不用 DB session（需 @auth/prisma-adapter + Session/Account 表 ×3）。若未來要伺服器端即時撤銷再切換。
  已同步更新 CLAUDE.backend.md / CLAUDE.security.md 的 session 規則。
- **Next 16 慣例（已查 node_modules/next/dist/docs）**：`middleware.ts` 已廢棄 → 用 **`src/proxy.ts`**
  （`export function proxy()`，Node runtime）；Auth.js v5 用 `auth` wrapper 包 proxy 函式。
  proxy 只做 redirect 防護；**每個 procedure 仍必須走 `protectedProcedure`**（proxy 不能取代 procedure 層驗證）。
- **tRPC context**：route handler 內 `await auth()` 後把 session 傳入 `createTRPCContext`
  （避免 next/headers 的 request-store 在非 Request 上下文中失效）。
- **登入流程**：`src/lib/schemas/login.ts`（前後端共用 Zod：email + password min 8 / max 72，bcrypt 限制 72 bytes）
  → `signIn("credentials", { redirect: false })` → 成功 `router.push(callbackUrl || "/")`；
  失敗顯示統一訊息「帳號或密碼錯誤」。
- **Rate limit**：`src/server/security/rate-limit.ts` 純函式/類別（可注入 clock 供測試），
  in-memory Map（IP → 滑動視窗）。限制：單實例有效、重啟歸零（Solo 可接受，多實例需 Redis/DB，記錄於風險）。
- **審計**：登入成功 → OperationLog（action: LOGIN, targetType: USER, targetId: userId, durationMs, ip, userAgent）。
  登入失敗不寫 OperationLog（OperationLog.actorId 必填，失敗無 actor）→ 寫結構化 logger。
- 涉及檔案：
  - `src/server/auth/index.ts`（新，Auth.js 設定：credentials + JWT + callbacks）
  - `src/app/api/auth/[...nextauth]/route.ts`（新，handlers）
  - `src/proxy.ts`（新，auth wrapper 路由保護）
  - `src/app/login/page.tsx`（新）+ `src/components/login-form.tsx`（新，client）
  - `src/components/logout-button.tsx`（新，client）
  - `src/lib/schemas/login.ts`（新）
  - `src/server/security/rate-limit.ts`（新）
  - `src/server/trpc/trpc.ts`（session 接上 auth()）、`src/app/api/trpc/[trpc]/route.ts`（傳 session 進 context）
  - `src/app/page.tsx`（樣板 → 已登入首頁）
  - `prisma/seed.ts`（新）、`prisma7.config.ts`（加 migrations.seed）、`package.json`（devDep tsx）
- DB migration：無（User 表 TASK-001 已建）
- 影響 API：有（protectedProcedure 從空殼變成真實檢查；health.check 不變）

## 安全考量 (Security)

- 權限檢查點：proxy（redirect）+ protectedProcedure（UNAUTHORIZED）雙層；procedure 層不可省
- 輸入驗證（Zod）：email 格式、密碼長度 8–72；錯誤訊息不區分「帳號不存在 / 密碼錯」
- Rate limit：登入 5/min/IP（in-memory 滑動視窗）
- 密碼：bcrypt cost 12（bcryptjs）；登入比對用 `bcrypt.compare`（防 timing attack 的常數時間比較）
- Secret：AUTH_SECRET 已由 env.ts 驗證（≥ 32 chars）；session cookie 正式環境 httpsOnly（AUTH_URL https）
- 審計：登入成功寫 OperationLog；失敗寫結構化 logger（不含密碼）

## Harness

- 單元測試：rate-limit 滑動視窗（時間注入）；login schema（合法/非法 email、密碼長度邊界）
- 整合測試（curl）：未登入 GET / → 302 /login；health 不需登入；登入 POST 成功建立 session cookie
- E2E：延後（隨 TASK-003 安裝 Playwright，登入 + 搜尋一起測）

## 風險與回滾

- 風險：next-auth 5 beta API 與文件有出入 → 以實際版本為準，實作時先讀 node_modules/next-auth 的 .d.ts
- 風險：JWT session 無法伺服器端即時撤銷（登出只清 cookie，被偷 token 過期前仍有效）→ 內部工具 + 7 天過期，接受；未來可切 DB session
- 風險：in-memory rate limit 重啟歸零、多實例不共享 → Solo 單實例可接受
- 風險：proxy.ts 是 Next 16 新慣例，matcher 寫錯可能擋到靜態資源 → matcher 排除 `_next/static`、`_next/image`、`api/auth`、`api/health`、`login`
- 回滾方式：TASK-002 不碰 DB schema；出問題 `git revert` 對應 commit 即回到骨架狀態
