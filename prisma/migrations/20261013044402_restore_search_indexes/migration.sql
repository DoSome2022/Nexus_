-- CreateIndex
CREATE INDEX "Record_title_trgm_idx" ON "Record" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Record_data_gin_idx" ON "Record" USING GIN ("data" jsonb_path_ops);
