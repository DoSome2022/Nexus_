# TASK-011: 隱藏資料庫總覽頁（/admin/db）

STATUS: [ ] todo  [ ] in-progress  [ ] review  [x] done

## 模式

- [x] Solo

## 背景 (Why)

管理/除錯時需要一次瀏覽整個 DB 的全部資料（8 張表、所有欄位），
不想每次開 prisma studio 或 psql。頁面刻意隱藏：無任何導覽連結，只能直接輸入 URL。

經使用者確認的設計決策：

- 權限：僅 ADMIN + URL token（`?token=…`，值存 `.env` 的 `ADMIN_DB_TOKEN`）
- 敏感欄位（`User.passwordHash`、`PasswordResetToken.tokenHash`、
  `DeletionRequest.tokenHash`）**完全顯示**，不加遮罩
- 每表可選筆數：每表獨立 `<select>`（20/100/500，預設 20），顯示總筆數
- 需求調整（後續）：**資料記錄表只顯示 `title` 與 `searchContent`**
  （不含其他欄位、tsvector 與保密檔案內容；localdata 不再讀取）

## 範圍 (Scope)

- In scope:
  - `/admin/db?token=…` RSC 頁面（無 client component、無 tRPC procedure）
  - 8 張表欄位白名單顯示 + 總筆數 + 每表筆數選擇器（GET form + searchParams）
  - env 驗證 `ADMIN_DB_TOKEN`（optional；未設定 → 頁面一律 404）
  - 單元測試（token 比較、limit 解析、cell 格式化、service mock）
- Out of scope:
  - record 表顯示 title/searchContent 以外的欄位（含 tsvector、保密檔案內容）
  - 排序/過濾/分頁（cursor）、匯出、跨表關聯導航
  - 在頁面內編輯/刪除資料
  - 一般使用者（USER）可視

## 驗收標準 (Acceptance Criteria)

- [x] 未登入 → redirect /login（proxy）；非 ADMIN → 404
- [x] token 缺失/錯誤/重複參數/`ADMIN_DB_TOKEN` 未設定 → 一律 404
- [x] ADMIN + 正確 token → 200：8 表齊全、總筆數正確、預設各 20 筆
- [x] 每表筆數可獨立調整（20/100/500），其他表維持原值
- [x] 資料記錄表只顯示 title 與 searchContent（需求調整）
- [x] 敏感欄位完全顯示（不遮罩）
- [x] 每次成功載入寫一筆 OperationLog(VIEW, DB_OVERVIEW)
- [x] lint / typecheck / test 全過

## 技術方案 (Approach)

- 涉及檔案：
  - 新增 `src/app/admin/db/page.tsx`（RSC 頁面）
  - 新增 `src/components/db-overview-table.tsx`（單表 Card + Table + select）
  - 新增 `src/server/services/db-overview-service.ts`
  - 新增 `src/server/security/admin-db-token.ts`（SHA-256 + timingSafeEqual）
  - 新增 `src/lib/db-overview.ts`（limit 解析、表設定、cell 格式化）
  - 修改 `src/env.ts`、`.env.example`（`ADMIN_DB_TOKEN` optional、min 32）
  - 新增測試 `harness/unit/{db-overview,admin-db-token,db-overview-service}.test.ts`、
    擴充 `env.test.ts`
- DB migration：無
- 影響 API：無（不新增 tRPC procedure；Server Component 直接呼叫 service，
  依 CLAUDE.frontend.md「Server Component：tRPC server caller 或 service」）
- 每表資料取得：`count()` + `findMany({ select: <固定欄位白名單>, orderBy: createdAt desc, take })`，
  `where` 不設（含軟刪除，符合「整個 DB」）；record 表白名單為 `{ title, searchContent }`

## 安全考量 (Security)

- 權限檢查點：
  - 頁面：`auth()` → role!==ADMIN → `notFound()`；service `assertAdmin` 防禦深度（先於 rate limit）
  - token：單一字串才驗證（陣列 → 404）；`verifyAdminDbToken`（SHA-256 後 timingSafeEqual，
    不可 `===`）；`ADMIN_DB_TOKEN` 未設定 → 404（功能停用不影響啟動）
- 輸入驗證（Zod）：
  - `ADMIN_DB_TOKEN` 於 env Zod（min 32）
  - limit 參數精確字串比對（"20"/"100"/"500"），不可 parseInt（"100abc"/"1e2" 陷阱）
- Rate limit：`checkRateLimit("db-overview:<actorId>", { limit: 10, windowMs: 60_000 })`
  （in-memory，與登入限制同限制）
- 審計：每次成功載入一筆 `OperationLog(VIEW, targetType: DB_OVERVIEW, targetId: all)`
  （含 ip/userAgent/durationMs）；rate-limit 擋下不寫
- 保密資料內容不經本頁讀取（record 表僅 title/searchContent）；token 不進 log
- 快取/索引：`dynamic = "force-dynamic"`；metadata `robots: noindex,nofollow` +
  `referrer: no-referrer`（避免 token 經 Referer 外洩）
- 不設 route 專屬 error.tsx/not-found.tsx：沿用根目錄通用版，避免 404 文案差異
  洩漏頁面存在（對 CLAUDE.frontend.md「每路由必備」的刻意例外，理由如上）
- 頁面刻意顯示 hash/保密內容：需求指定；靠權限/rate limit/審計/無導覽收斂風險

## Harness

- 單元測試：
  - `admin-db-token.test.ts`（7 案）：等值/不等值/長度不等不拋 RangeError/缺失/Unicode
  - `db-overview.test.ts`（14 案）：limit 解析陷阱、8 表映射、cell 格式化（circular 不拋）、
    config invariant（record 只含 title/searchContent）
  - `db-overview-service.test.ts`（7 案）：FORBIDDEN 不觸 DB、rate limit、take 獨立性、
    where 無過濾、record 表 select 白名單、VIEW log 一次
  - `env.test.ts` 擴充 3 案
- 整合測試：無（無 DB schema/API 變更）
- E2E：無（手動驗證見下）

## 風險與回滾

- 風險：
  - token 存於 URL/瀏覽器歷史/反向代理 access log（含 proxy 未登入 redirect 的 callbackUrl）
    → HTTPS、no-referrer、勿分享網址、洩漏後輪替 token
  - 頁面明文顯示 passwordHash/tokenHash → 高敏感介面，僅授權環境使用
  - 500 筆 + 大 JSON 可能產生大頁面 → 預設 20
  - rate limit in-memory：重啟歸零、多實例不共享（與既有限制同限制）
  - 每次載入新增一筆 OperationLog，長期成長
- 回滾方式：無 DB migration/API 變更；刪除 `src/app/admin/db`、service、
  `admin-db-token.ts`、`db-overview.ts`、相關測試與 env key 即完全回滾；
  或只移除 `.env` 的 `ADMIN_DB_TOKEN` → 頁面永久 404（功能停用）
