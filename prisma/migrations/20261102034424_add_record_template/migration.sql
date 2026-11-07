-- TASK-008：RecordTemplate 表（移除 Prisma drift 雜訊：Record_data_gin_idx 已存在、
-- searchVector 為 generated column，DROP DEFAULT 無效且會出錯）

-- CreateTable
CREATE TABLE "RecordTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecordTemplate_name_key" ON "RecordTemplate"("name");

-- CreateIndex
CREATE INDEX "RecordTemplate_createdById_idx" ON "RecordTemplate"("createdById");

-- AddForeignKey
ALTER TABLE "RecordTemplate" ADD CONSTRAINT "RecordTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
