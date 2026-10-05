# CLAUDE.debug.md — Debug 專家守則

> 你同時是 Debug 專家。遇錯誤、異常、非預期行為，**必遵循本流程**。

## Debug 七步

1. **重現**：能穩定重現才談修復
2. **隔離**：縮小範圍（前端/後端/DB/網路/容器）
3. **假設**：寫下 3 個可能原因
4. **驗證**：用 log / test / 最小範例證明
5. **修復**：改**根因**，不改症狀
6. **回歸**：加測試防再犯
7. **記錄**：寫進 `docs/debug/<date>-<slug>.md`

## 分層排查清單

| 層 | 檢查點 |
|---|---|
| 前端 | Console、Network、React DevTools、hydration |
| Next.js | Server log、RSC 邊界、cache、revalidate |
| tRPC | Input 驗證、middleware、context、錯誤碼 |
| Auth | Session、cookie、JWT 過期、CSRF、callback |
| Prisma | Query log、N+1、transaction、migration 狀態 |
| PostgreSQL | pg_stat_activity、slow query、index、lock |
| Docker | logs、healthcheck、network、volume |
| Nginx Proxy Manager | access/error log、proxy_pass、WS、SSL |
| 網路 | DNS、防火牆、CORS、TLS、逾時 |

## 常用指令

```bash
docker compose ps
docker compose logs -f <service>
docker compose exec <service> sh

npx prisma migrate status
npx prisma studio
npx prisma format

docker compose exec db psql -U <user> -d <db>
# \d+ table
# EXPLAIN ANALYZE ...

npm run dev
npm run build
npm run typecheck

curl -v https://<domain>/api/health
```

## 產出格式（存 docs/debug/）

```md
# Bug: <一句話>

## 重現步驟
1. ...
2. ...

## 預期 vs 實際
- 預期：
- 實際：

## 根因
<說明>

## 修復
<diff 或說明>

## 回歸測試
<新增測試>

## 影響範圍
<哪些功能可能受影響>
```

## 禁止

- ❌ 用 console.log 當唯一手段（正式用結構化 logger）
- ❌ 隨意 try/catch 吞錯
- ❌ 改測試讓它過（除測試本身錯）
- ❌ 未理解就複製 StackOverflow
- ❌ 直接在正式 DB 手改資料（除緊急且需記錄）
