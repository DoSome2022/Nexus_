# CLAUDE.data-model.md — 資料模型與 Prisma Schema

## 核心實體

- User（含 role: ADMIN | USER）
- Record（自由格式資料）
- RecordTemplate（表單範本，TASK-008）
- RecordRelation（資料關聯）
- OperationLog（操作記錄）
- ChangeLog（修改記錄）
- PasswordResetToken（忘記密碼）
- DeletionRequest（刪除確認）

## Prisma Schema 骨架

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  role          Role      @default(USER)
  createdAt     DateTime  @default(now())
  deletedAt     DateTime?
  records       Record[]
  operationLogs OperationLog[]
  changeLogs    ChangeLog[]
}

enum Role { ADMIN USER }

model Record {
  id                 String    @id @default(cuid())
  authorId           String
  author             User      @relation(fields: [authorId], references: [id])
  title              String
  schema             Json?     // 欄位定義（保密資料為 null，內容在 localdata/）
  data               Json?     // 實際內容（保密資料為 null，內容在 localdata/）
  isPublic           Boolean   @default(false)
  isEditableByOthers Boolean   @default(false)
  isConfidential     Boolean   @default(false) // 保密：內容存 localdata/，不進 DB
  deletedAt          DateTime? // 軟刪除
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  relationsFrom      RecordRelation[] @relation("from")
  relationsTo        RecordRelation[] @relation("to")

  @@index([authorId])
  @@index([deletedAt])
}

model RecordTemplate {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  fields      Json     // 欄位定義陣列，zod 驗證（src/lib/schemas/template.ts）
  createdById String
  createdBy   User     @relation(fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([createdById])
}

model RecordRelation {
  id         String   @id @default(cuid())
  fromId     String
  toId       String
  from       Record   @relation("from", fields: [fromId], references: [id])
  to         Record   @relation("to",   fields: [toId],   references: [id])
  label      String?
  createdAt  DateTime @default(now())
}

model OperationLog {
  id         String   @id @default(cuid())
  actorId    String
  actor      User     @relation(fields: [actorId], references: [id])
  action     String   // CREATE / UPDATE / DELETE / VIEW
  targetType String
  targetId   String
  durationMs Int
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  @@index([targetId])
  @@index([actorId])
}

model ChangeLog {
  id        String   @id @default(cuid())
  targetId  String
  field     String
  oldValue  Json?
  newValue  Json?
  actorId   String
  actor     User     @relation(fields: [actorId], references: [id])
  createdAt DateTime @default(now())
  @@index([targetId])
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
}

model DeletionRequest {
  id          String    @id @default(cuid())
  recordId    String
  requestedBy String
  tokenHash   String    @unique
  approvedAt  DateTime?
  expiresAt   DateTime
  createdAt   DateTime  @default(now())
}
```

## 搜尋設計

- 啟用 pg_trgm extension；`title`、`searchContent` 建 trgm GIN（ILIKE 用）；`data` 的
  jsonb_path_ops GIN **不參與子字串搜尋**（僅 containment 語義，schema 納管防 drift 誤刪）
- 查詢語意（TASK-010）：空白切詞、去重、上限 10、**每詞 AND**（越多關鍵字越精確）；
  排序 = 命中標題詞數 → ts_rank → updatedAt
- `Record.searchContent`（TASK-010）：非保密資料的內容索引文字，service 在 create/update
  時以 `buildSearchContent`（src/lib/search-text.ts）計算——佈局 `<data 扁平文字>` + U+001F +
  `<日期衍生詞（data + title）>`（日期 `Y-M-D`/`Y/M/D`/`Y年M月D日` 展開 `M月`、`M月D日` 等，
  故打「11月」可命中 `2026-11-02`）；title 變更也要重建（title 日期詞在此欄內）
- 近義詞（TASK-006）：`searchVector` generated column =
  `to_tsvector('nexus_zh', title || ' ' || coalesce(searchContent,''))` + thesaurus 字典
  （infra/pg-tsearch 進容器）；ILIKE 是中文主力、向量是次要（中文無分詞、thesaurus 會展開整詞）
- 保密資料（data 為 null）：**內容永不進 DB**（service 不寫 + CHECK `Record_confidential_no_search_content`）；
  內容搜尋於查詢時讀**作者自己**的 localdata 檔案做同套 extractor 字面比對（不做同義詞）、合併排序；
  檔案損毀 → 跳過該筆 + 結構化 log
- 查詢安全：ILIKE pattern 經 `escapeLikePattern` + SQL `ESCAPE '\'`（`%`/`_` 為字面）
- 回填：migration 後跑 `npm run backfill:search`（$executeRaw 不動 updatedAt、冪等）
- 中文情境：trigram 為字元層級，中文模糊效果需實測（TASK-003 驗證）

## 表單範本（TASK-008）

- 範本全站共用、Admin 管理；`Record.schema` 存**建立當下的 snapshot**（`{ v: 1, templateName, fields }`）
- snapshot 規則：範本之後的編輯/刪除**不影響**既有紀錄；檢視/編輯只讀 snapshot、不 join 範本表
- 欄位型別：text / textarea / number / boolean / list（逗號分隔）/ date（`YYYY-MM-DD` 字串）；上限 20 欄、欄位名唯一
- 保密資料的 snapshot 隨內容存 localdata 檔案（DB 列 schema/data 仍 NULL）
- 資料與 snapshot 的相符檢查：`schemaMatchesData`（欄位集合 + 型別 + required；boolean 的 required 無意義）

## 權限查詢（一律走 service）

`canRead(record, user)`：
- 是作者 → true
- isPublic=true → true
- isConfidential=true → 僅作者（服務層強制 isPublic=false，非作者一律 false）
- 否則 false

`canEdit(record, user)`：
- 是作者 → true
- isEditableByOthers=true → true
- 否則 false

`canDelete(record, user)`：
- user.role === 'ADMIN' → 需 Mail 確認
- 否則 false

## 審計規則

- 每一筆 Record 的操作：寫 OperationLog（誰、做了什麼、何時、耗時）
- 每一筆 Record 的修改：寫 ChangeLog（每個欄位 old → new）
- 兩份都要寫，缺一不可

## 保密資料（localdata 混合儲存，TASK-004）

Record 新增第三種可見性選項「保密」（決策：metadata 進 DB、內容在 localdata）：

- `isConfidential = true` ⇒ `schema` / `data` 為 `null`，內容存於 `localdata/<recordId>.json`
- 檔名由 recordId（cuid）決定，不接受使用者輸入路徑
- 服務層強制：保密資料 `isPublic = false`、`isEditableByOthers = false`
- 讀取：DB 取 metadata → isConfidential 且 data 為 null → 讀 localdata 檔案
- ChangeLog：保密資料的 old/new 不進 DB，寫入該 record 檔案內 `changes` 陣列（兩份 log 底線不變，位置不同）
- 軟刪除：檔案移入 `localdata/.trash/`
- 檔案格式與寫入順序：見 `docs/tasks/TASK-004-confidential-localdata.md`

## Migration 規範

- 命名：`<timestamp>_<snake_case_desc>`
- 每次 migration 需在 Task 中說明
- 正式：`migrate deploy`
