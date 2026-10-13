# TASK-002 登入測試報告

- **日期**：2026-10-13
- **範圍**：proxy 防護、登入成敗、role 傳播、rate limit、審計、登出、cookie 竄改
- **環境**：dev server（localhost:3000，Node 22）+ Docker db（postgres:16-alpine）
- **方法**：curl 實測 + psql 驗證 + dev log 檢查
- **結論**：**20 項全過，0 bug**

## 測試結果

| # | 類別 | 測試 | 結果 |
|---|---|---|---|
| 1 | proxy | 未登入 `GET /` | ✅ 307 → /login |
| 2 | proxy | 未登入 `GET /nonexistent` | ✅ 307 → /login?callbackUrl=/nonexistent（callbackUrl 回傳正確） |
| 3 | proxy | `/login`、`/api/health`、`/api/auth/csrf`、`/api/auth/providers` | ✅ 全 200 不被擋 |
| 4 | 登入 | 正確密碼 | ✅ session 含 id/email/role: ADMIN，7 天過期 |
| 5 | cookie | HttpOnly | ✅（dev http 無 Secure 屬正常） |
| 6 | 登入 | 錯誤密碼 | ✅ 統一 302，無 session |
| 7 | 登入 | 不存在帳號 | ✅ 與錯誤密碼完全相同回應（不洩漏帳號存在性） |
| 8 | 輸入 | 非法 email 格式 | ✅ 拒絕 |
| 9 | CSRF | 無 csrfToken 的 POST | ✅ 拒絕且不建立 session cookie |
| 10 | 權限 | USER role 帳號登入 | ✅ session role: USER |
| 11 | 權限 | 已軟刪除（deletedAt）帳號 | ✅ 拒絕、session 為 null |
| 12 | rate limit | 第 6 次嘗試（5/min/IP） | ✅ dev log 出現 `login_rate_limited` 被拒 |
| 13 | 登出 | POST /api/auth/signout | ✅ session null + cookie 清除 |
| 14 | proxy | 登出後再存取 `/` | ✅ 307 → /login |
| 15 | proxy | 竄改的 session cookie | ✅ 視為未登入 → 307 |
| 16 | proxy | 已登入存取 /login | ✅ 307 → / |
| 17 | UI | 登入頁 HTML | ✅ email/password/submit 齊全 |
| 18 | 審計 | OperationLog | ✅ 僅成功登入寫 DB（LOGIN + ip + durationMs）；失敗只進結構化 log |
| 19 | 安全 | open redirect | ✅ `callbackUrl.startsWith("/") && !startsWith("//")` |
| 20 | 清理 | 臨時測試資料 | ✅ USER/已刪除帳號及其 OperationLog 已清除 |

## 測試發現（非 bug，已補文件）

1. **Rate limit 信任 `x-forwarded-for`**：直接連 app 可偽造 header 繞過限流。
   目前 app 容器無 public ports（僅經 NPM 可達，NPM 預設覆寫此 header）→ 實際無風險。
   已補 `CLAUDE.security.md`：「NPM 必須覆寫 x-forwarded-for」。
2. **`AUTH_URL` 部署提醒**：`.env.example` 已註明部署時改為公開 HTTPS 網域（cookie 才會帶 Secure）。

## 重現方式（命令摘要）

```bash
# 未登入 redirect
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/

# 登入流程（CSRF → POST credentials → session）
CSRF=$(curl -s -c /tmp/nexus.txt http://localhost:3000/api/auth/csrf | jq -r .csrfToken)
curl -s -b /tmp/nexus.txt -c /tmp/nexus.txt -X POST \
  http://localhost:3000/api/auth/callback/credentials \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=admin@nexus.local" \
  --data-urlencode "password=<密碼>"
curl -s -b /tmp/nexus.txt http://localhost:3000/api/auth/session

# rate limit：連續 6 次登入，dev log 應出現 login_rate_limited

# 臨時 USER / 已刪除帳號（測完記得 DELETE 清理）
docker compose exec -T db psql -U nexus -d nexus -c \
  "INSERT INTO \"User\" (id, email, \"passwordHash\", role, \"createdAt\", \"updatedAt\") VALUES ('tst_user_001', 'tester@nexus.local', '<bcrypt hash>', 'USER', now(), now());"
```

## 已知限制（設計上接受，非 bug）

- dev 走 http：session cookie 無 Secure flag；生產 NPM HTTPS 下 Auth.js 自動加
- in-memory rate limit：重啟歸零、多實例不共享（見 TASK-002 風險）
- JWT session：登出僅清 cookie，無法伺服器端即時撤銷（見 TASK-002 風險）
