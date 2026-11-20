import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { buildSearchContent } from "../../src/lib/search-text";
import { buildCategoryIndex, getCategoryNamePath } from "../../src/lib/category-tree";

/**
 * TASK-010：既有非保密資料補 searchContent（migration 只加欄位，不回填）
 * - 用 $executeRaw 只動 searchContent（不 bump updatedAt、不寫審計）
 * - 冪等：與現值相同即略過；保密資料一律清除（防禦）
 * - TASK-012：併入分類 ancestor namePath（否則重跑會把分類名從索引洗掉）
 * 用法：npm run backfill:search
 */
const BATCH_SIZE = 100;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 未設定（請確認 .env）");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    // TASK-012：一次載入分類 index（小表），批次內查 recordCategory 組 namePath
    const allCategories = await prisma.category.findMany({
      select: { id: true, name: true, parentId: true },
    });
    const categoryIndex = buildCategoryIndex(allCategories);

    let cursor: string | undefined;
    let scanned = 0;
    let updated = 0;

    while (true) {
      const rows = await prisma.record.findMany({
        where: { isConfidential: false, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, title: true, data: true, searchContent: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      scanned += rows.length;

      const links = await prisma.recordCategory.findMany({
        where: { recordId: { in: rows.map((r) => r.id) } },
        select: { recordId: true, categoryId: true },
      });
      const namesByRecord = new Map<string, string[]>();
      for (const link of links) {
        const names = namesByRecord.get(link.recordId) ?? [];
        names.push(...getCategoryNamePath(link.categoryId, categoryIndex));
        namesByRecord.set(link.recordId, names);
      }

      for (const row of rows) {
        cursor = row.id;
        const next =
          buildSearchContent(row.title, row.data, namesByRecord.get(row.id) ?? []) || null;
        if (next === row.searchContent) continue;
        await prisma.$executeRaw`UPDATE "Record" SET "searchContent" = ${next} WHERE "id" = ${row.id}`;
        updated += 1;
      }
      if (rows.length < BATCH_SIZE) break;
    }

    // 防禦：保密資料絕不該有 DB 內容索引文字（CHECK 約束之外的二次把關）
    const leaked = await prisma.$executeRaw`UPDATE "Record" SET "searchContent" = NULL WHERE "isConfidential" = true AND "searchContent" IS NOT NULL`;

    console.log(
      `backfill:search 完成：掃描 ${scanned} 筆非保密、更新 ${updated} 筆；保密防禦清除 ${leaked} 筆`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("backfill:search 失敗:", err);
  process.exit(1);
});
