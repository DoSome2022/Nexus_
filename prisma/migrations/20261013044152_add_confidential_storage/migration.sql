-- DropIndex
DROP INDEX "Record_data_gin_idx";

-- DropIndex
DROP INDEX "Record_title_trgm_idx";

-- AlterTable
ALTER TABLE "Record" ADD COLUMN     "isConfidential" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "schema" DROP NOT NULL,
ALTER COLUMN "data" DROP NOT NULL;
