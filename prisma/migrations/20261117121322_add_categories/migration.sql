-- AlterTable
-- 註：generated column 的 DROP DEFAULT 為非法（PG：is a generated column），故省略
-- （與 20261102121320_add_search_content 相同處理；searchVector 為 generated column，Prisma 不管理）
-- 註2：Record_data_gin_idx 的 DROP/CREATE 由引擎 drift 偵測產生，一併省略——
--   重播時 migration 8 已建此 index 會撞名；dev DB 的缺索引 drift 已用 psql 補回

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordCategory" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Category_createdById_idx" ON "Category"("createdById");

-- CreateIndex
CREATE INDEX "RecordCategory_categoryId_idx" ON "RecordCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordCategory_recordId_categoryId_key" ON "RecordCategory"("recordId", "categoryId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordCategory" ADD CONSTRAINT "RecordCategory_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordCategory" ADD CONSTRAINT "RecordCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
