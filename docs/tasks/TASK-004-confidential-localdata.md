STATUS: [ ] todo  [x] in-progress  [ ] review  [ ] done

# TASK-004: 保密資料本機儲存（localdata）

## 模式
- [ ] Team
- [x] Solo

## 背景 (Why)

建立資料時現有選項僅「是否公開 / 是否可被他人編輯」，資料一律寫入 PostgreSQL。
使用者需要第三種選項「**保密**」：內容不進 DB，改存於伺服器專案目錄的 `localdata/` 資料夾（JSON 檔），
但仍可在搜尋列表中搜出。

**語義澄清：保密 ≠ 加密。**「保密」只指儲存位置（檔案系統 vs DB），檔案內容為明文 JSON；
若未來需要 at-rest 加密，另開 Task。

**已與使用者確認的架構決策：**
1. 資料存在**伺服器**檔案系統 `localdata/`（不是瀏覽器 localStorage）
2. **metadata 進 DB、內容（schema + data）在 localdata** —— 標題搜尋可沿用 DB 的 pg_trgm 索引

## 範圍 (Scope)

- In scope:
  - Record 資料模型調整（新增 `isConfidential` + `schema`/`data` 改 nullable）+ migration
  - localdata 儲存層（寫入/讀取/更新/軟刪除；原子寫、路徑安全）
  - 建立表單第三選項「保密」（與公開/可被他人編輯互斥）
  - `canRead` / `canEdit` 加入保密分支
  - 搜尋列表納入保密資料（作者可搜出、他人不可見）
  - 保密資料的 ChangeLog 寫入 localdata 檔案（DB 不存內容）
  - infra：compose bind mount 持久化、`.gitignore` / `.dockerignore`、`LOCALDATA_DIR` env
- Out of scope:
  - 檔案內容加密（at-rest）
  - 保密資料的內容全文搜尋（DB 側 `data` GIN 對保密資料無效；僅標題可搜）
  - 他人建立指向保密資料的關聯（RecordRelation）
  - 登入（TASK-002）、搜尋（TASK-003）本身

## 驗收標準 (Acceptance Criteria)

- [ ] 建立表單有三選項：公開 / 私有 / 保密；選保密時「公開」「可被他人編輯」強制為否
- [ ] 選保密：schema + data 寫入 `localdata/<id>.json`，DB 只存 metadata（data/schema 為 null）
- [ ] 保密資料在搜尋列表中可被**作者**搜出（標題搜尋）
- [ ] **非作者**搜不到保密資料（權限過濾）
- [ ] 讀取保密資料時從檔案載入內容；檔案遺失回報錯誤且不洩漏路徑
- [ ] 編輯保密資料：檔案更新 + ChangeLog 寫入該 record 檔案內
- [ ] 刪除保密資料：軟刪除（deletedAt）+ 檔案移入 `localdata/.trash/`
- [ ] 寫入中斷（DB 失敗）不殘留孤兒檔案（回滾策略）
- [ ] `localdata/` 不入 git、不進 Docker image；容器重啟後資料仍在（bind mount）
- [ ] Harness（lint + typecheck + test + build）全過

## 技術方案 (Approach)

- **資料模型**：
  - Record 新增 `isConfidential Boolean @default(false)`
  - `schema` / `data` 改為 `Json?`（null = 內容在 localdata）
  - 不變動既有 `isPublic` / `isEditableByOthers`；保密資料由服務層強制兩者為 false
  - migration：`<timestamp>_add_confidential_storage`
- **localdata 檔案格式**（路徑由 recordId（cuid）決定，不接受使用者輸入路徑）：
  ```json
  // localdata/<recordId>.json
  {
    "version": 1,
    "id": "<recordId>",
    "authorId": "<userId>",
    "schema": { },
    "data": { },
    "changes": [
      { "field": "...", "oldValue": null, "newValue": null, "actorId": "...", "createdAt": "..." }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
  ```
- **寫入順序（容錯）**：
  1. 寫 `localdata/<id>.json.tmp` → `rename` 覆蓋（原子）
  2. 寫 DB row（metadata；data/schema = null）
  3. DB 失敗 → 刪除剛寫的檔案（DB 是 metadata 的 source of truth）
- **讀取流程**：DB 取 metadata → isConfidential 且 data 為 null → 讀 localdata 檔案；
  檔案遺失 → TRPCError `NOT_FOUND` + 結構化 log（不印內容、不洩漏絕對路徑）
- **審計（兩份 log 底線不變）**：
  - OperationLog：照寫 DB（不含內容）
  - ChangeLog：保密資料的 old/new 不進 DB，寫入該 record 檔案內 `changes` 陣列
- 涉及檔案：
  - `prisma/schema.prisma` + migration
  - `src/server/repositories/localdata-repository.ts`（新）
  - `src/server/security/permissions.ts`（canRead / canEdit 純函式，新）
  - `src/env.ts` + `.env.example`（`LOCALDATA_DIR`，預設 `./localdata`）
  - `.gitignore`、`.dockerignore`、`docker-compose.yml`
- DB migration：有
- 影響 API：有（record create / update / delete / search list procedure，視 TASK-002/003 進度接上）

## 安全考量 (Security)

- 權限檢查點：canRead / canEdit 加保密分支（僅作者）；建立時服務層強制 isPublic=false、isEditableByOthers=false
- Path traversal：檔名由 recordId（cuid）+ `basename()` 白名單，禁止使用者輸入拼路徑
- 覆寫/競態：新檔 `flag: "wx"`；更新走 `.tmp` + `rename` 原子寫
- 輸入驗證（Zod）：data 大小上限 ≤ 1MB；可見性選項限 enum
- Rate limit：寫入 30/min 照舊（TASK 後續實作時一併）
- 內容不外洩：ChangeLog old/new 不寫 DB；logger 不印 data 內容
- 檔案權限：0600（容器使用者 nextjs）

## Harness

- 單元測試：canRead/canEdit 保密分支；路徑安全函式（traversal 被拒）；localdata 檔案格式驗證
- 整合測試：保密 CRUD 全流程（寫檔 → DB row → 讀回 → 更新 → 軟刪除移 `.trash`）；DB 失敗回滾無孤兒檔
- E2E：建立保密資料 → 搜尋列表出現 → 檢視載入內容 → 刪除（soft）→ 檔案進 `.trash`

## 風險與回滾

- 風險：檔案與 DB 不一致（寫入中斷）→ 以 DB 為 metadata source of truth；寫入順序已含回滾
- 風險：檔案遺失導致內容不可讀 → 讀取時明確報錯並 log；localdata 需獨立備份（infra）
- 風險：保密資料的內容全文搜尋不可用（data 不在 DB）→ 列為已知限制，僅標題可搜
- 風險：檔案在伺服器磁碟上，**檔案層級無 per-user 存取控制**（能登入主機者皆可讀）→ 依賴應用層權限；記錄為接受風險
- 回滾方式：migration 為 nullable 向下相容，可回；localdata 檔案獨立於 DB，回滾 DB 不影響檔案
