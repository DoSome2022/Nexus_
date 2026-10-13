import "dotenv/config";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

/**
 * seed 測試資料（TASK-003）：demo 使用者 + 公開/私有/保密混合資料
 * 用法：npm run seed:test
 * 固定 id（seed_ 前綴）→ 冪等，可重複執行（已存在則略過）
 * 保密資料寫入 localdata/（路徑與 app 一致：LOCALDATA_DIR 或 ./localdata）
 */
const DEMO_EMAIL = "demo@nexus.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo123456";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@nexus.local";

const RECORDS = [
  { id: "seed_public_001", title: "公司會議紀錄 2026-Q4", visibility: "PUBLIC" as const, data: { summary: "第四季策略會議重點" } },
  { id: "seed_public_002", title: "員工手冊", visibility: "PUBLIC" as const, data: { sections: ["休假", "差旅", "福利"] } },
  { id: "seed_public_003", title: "內部培訓資料", visibility: "PUBLIC" as const, data: { courses: ["資安基礎", "Git 工作流"] } },
  { id: "seed_private_001", title: "我的年度目標草稿", visibility: "PRIVATE" as const, data: { draft: true, goals: ["完成 Nexus 專案"] } },
  { id: "seed_private_002", title: "個人面談筆記", visibility: "PRIVATE" as const, data: { note: "1:1 重點整理" } },
  { id: "seed_conf_001", title: "機密：薪資結構調整方案", visibility: "CONFIDENTIAL" as const, data: { plan: "Q1 調整 5%" } },
  { id: "seed_conf_002", title: "機密：合作廠商報價", visibility: "CONFIDENTIAL" as const, data: { vendor: "Acme", quote: 98000 } },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 未設定（請確認 .env）");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    // demo 使用者（不存在才建立）
    const demo = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: {
        email: DEMO_EMAIL,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
        name: "示範使用者",
        role: "USER",
      },
    });
    console.log(`demo 使用者就緒：${demo.email}（密碼 ${process.env.DEMO_PASSWORD ? "來自 env" : DEMO_PASSWORD}）`);

    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (!admin) console.warn(`⚠ admin（${ADMIN_EMAIL}）不存在，權限過濾測試需要它（請先 npm run db:seed）`);

    // 資料（冪等：存在即略過）
    const localdataDir = process.env.LOCALDATA_DIR ?? path.join(process.cwd(), "localdata");
    await fs.mkdir(localdataDir, { recursive: true });

    let created = 0;
    for (const r of RECORDS) {
      const exists = await prisma.record.findUnique({ where: { id: r.id } });
      if (exists) continue;

      const isConfidential = r.visibility === "CONFIDENTIAL";
      await prisma.record.create({
        data: {
          id: r.id,
          authorId: demo.id,
          title: r.title,
          // 保密：省略 schema/data → SQL NULL（null = 內容在 localdata）
          ...(isConfidential ? {} : { schema: {}, data: r.data }),
          isPublic: r.visibility === "PUBLIC",
          isEditableByOthers: false,
          isConfidential,
        },
      });
      if (isConfidential) {
        await fs.writeFile(
          path.join(localdataDir, `${r.id}.json`),
          JSON.stringify(
            {
              version: 1,
              id: r.id,
              authorId: demo.id,
              schema: {},
              data: r.data,
              changes: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      }
      created += 1;
    }
    console.log(`測試資料就緒：新增 ${created} 筆（${RECORDS.length} 筆總計）`);
    console.log(`- 公開 ×3、私有 ×2、保密 ×2（作者：${demo.email}）`);
    console.log(`- 驗證權限：admin 搜尋應只看得到 3 筆公開；demo 看得到全部 7 筆`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("seed:test 失敗:", err);
  process.exit(1);
});
