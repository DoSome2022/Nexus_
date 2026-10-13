# CLAUDE.data-model.md — 資料模型與 Prisma Schema

## 核心實體

- User（含 role: ADMIN | USER）
- Record（自由格式資料）
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

- 啟用 pg_trgm extension
- `title` 與 `data` 建 GIN index
- 近義詞：tsvector + 同義詞字典，或應用層 synonym 表
- 全欄位搜尋：對 `data` 的 JSONB 建 GIN（jsonb_path_ops）
- 保密資料（data 為 null）：全欄位搜尋不適用，僅標題可搜（TASK-004 已知限制）

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
