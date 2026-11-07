import "dotenv/config";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import type { InputJsonValue } from "../../src/generated/prisma/internal/prismaNamespace";
import { buildRecordTemplateSnapshot } from "../../src/lib/template-data";
import { buildSearchContent } from "../../src/lib/search-text";
import type { TemplateField } from "../../src/lib/schemas/template";

/**
 * seed 測試資料（TASK-003 / TASK-008）：demo 使用者 + 公開/私有/保密混合資料
 * + 範本（Admin 建立）+ 範本示範資料
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
  // TASK-009 關聯建議示範：帳號的標題/內容提及 甲君 與 某某網
  // 「王」為單字標題對照（不應被建議）；conf 為保密記錄提及對照
  { id: "seed_suggest_person", title: "甲君", visibility: "PUBLIC" as const, data: { role: "工程師" } },
  { id: "seed_suggest_site", title: "某某網", visibility: "PUBLIC" as const, data: { url: "https://example.com" } },
  { id: "seed_suggest_account", title: "甲君的某某網帳號", visibility: "PUBLIC" as const, data: { username: "mr-a", note: "這是甲君在某某網的帳號" } },
  { id: "seed_suggest_report", title: "專案進度報告", visibility: "PUBLIC" as const, data: { status: "進行中" } },
  { id: "seed_suggest_short", title: "王", visibility: "PUBLIC" as const, data: { note: "單字標題，不應被建議" } },
  { id: "seed_suggest_conf", title: "機密：甲君體檢報告", visibility: "CONFIDENTIAL" as const, data: { summary: "甲君的年度體檢" } },
];

/** 示範範本（TASK-008）：全站共用、Admin 建立；六種欄位型別都涵蓋在「會議紀錄」 */
const TEMPLATES = [
  {
    id: "seed_template_meeting",
    name: "會議紀錄",
    description: "例會與專案會議",
    fields: [
      { name: "topic", label: "會議主題", type: "text", required: true },
      { name: "meeting_date", label: "會議日期", type: "date", required: false },
      { name: "attendees", label: "出席人員", type: "list", required: false },
      { name: "notes", label: "討論內容", type: "textarea", required: false },
      { name: "follow_up_done", label: "待辦已完成", type: "boolean", required: false },
    ],
  },
  {
    id: "seed_template_contact",
    name: "聯絡人",
    description: "客戶與廠商聯絡資訊",
    fields: [
      { name: "person", label: "姓名", type: "text", required: true },
      { name: "phone", label: "電話", type: "text", required: false },
      { name: "email", label: "Email", type: "text", required: false },
      { name: "note", label: "備註", type: "textarea", required: false },
    ],
  },
] satisfies Array<{ id: string; name: string; description: string; fields: TemplateField[] }>;

/** 範本示範資料（TASK-008）：資料必須與範本欄位相符（schemaMatchesData） */
const TEMPLATE_RECORDS = [
  {
    id: "seed_template_public_001",
    title: "Q4 產品例會（範本示範）",
    visibility: "PUBLIC" as const,
    templateId: "seed_template_meeting",
    data: {
      topic: "Q4 產品路線圖討論",
      meeting_date: "2026-11-02",
      attendees: ["Alice", "Bob", "Carol"],
      notes: "確認 Q4 三項重點功能排程\n下週四再同步進度",
      follow_up_done: false,
    },
  },
  {
    id: "seed_template_conf_001",
    title: "機密：客戶聯絡簿（範本示範）",
    visibility: "CONFIDENTIAL" as const,
    templateId: "seed_template_contact",
    data: {
      person: "王大明",
      phone: "0912-345-678",
      email: "daming@example.com",
      note: "年度合約洽談窗口",
    },
  },
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
          // 保密：省略 schema/data/searchContent → SQL NULL（null = 內容在 localdata）
          ...(isConfidential
            ? {}
            : { schema: {}, data: r.data, searchContent: buildSearchContent(r.title, r.data) }),
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
    const publicCount = RECORDS.filter((r) => r.visibility === "PUBLIC").length;
    const privateCount = RECORDS.filter((r) => r.visibility === "PRIVATE").length;
    const confidentialCount = RECORDS.filter((r) => r.visibility === "CONFIDENTIAL").length;
    console.log(`測試資料就緒：新增 ${created} 筆（${RECORDS.length} 筆總計）`);
    console.log(`- 公開 ×${publicCount}、私有 ×${privateCount}、保密 ×${confidentialCount}（作者：${demo.email}）`);
    console.log(`- 驗證權限：admin 搜尋應只看得到 ${publicCount} 筆公開；demo 看得到全部 ${RECORDS.length} 筆`);
    console.log(`- 關聯建議示範（TASK-009）：檢視「甲君的某某網帳號」應建議 甲君 / 某某網`);

    // 範本 + 範本示範資料（TASK-008；admin 不存在則跳過）
    if (!admin) {
      console.warn("⚠ admin 不存在，跳過範本與範本示範資料（請先 npm run db:seed）");
    } else {
      let templatesCreated = 0;
      for (const t of TEMPLATES) {
        const exists = await prisma.recordTemplate.findUnique({ where: { id: t.id } });
        if (exists) continue;
        try {
          await prisma.recordTemplate.create({
            data: {
              id: t.id,
              name: t.name,
              description: t.description,
              fields: t.fields as unknown as InputJsonValue,
              createdById: admin.id,
            },
          });
          templatesCreated += 1;
        } catch (err) {
          if ((err as { code?: string }).code === "P2002") {
            console.warn(`⚠ 範本名稱已存在，略過：${t.name}`);
          } else {
            throw err;
          }
        }
      }

      let templateRecordsCreated = 0;
      for (const r of TEMPLATE_RECORDS) {
        const exists = await prisma.record.findUnique({ where: { id: r.id } });
        if (exists) continue;
        const template = TEMPLATES.find((t) => t.id === r.templateId);
        if (!template) {
          console.warn(`⚠ 範本不存在，略過示範資料：${r.id}`);
          continue;
        }
        const snapshot = buildRecordTemplateSnapshot({
          name: template.name,
          fields: template.fields,
        });
        const isConfidential = r.visibility === "CONFIDENTIAL";
        await prisma.record.create({
          data: {
            id: r.id,
            authorId: demo.id,
            title: r.title,
            // 保密：省略 schema/data/searchContent → SQL NULL（null = 內容在 localdata，含 schema snapshot）
            ...(isConfidential
              ? {}
              : {
                  schema: snapshot as unknown as InputJsonValue,
                  data: r.data,
                  searchContent: buildSearchContent(r.title, r.data),
                }),
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
                schema: snapshot,
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
        templateRecordsCreated += 1;
      }
      console.log(
        `範本就緒：新增 ${templatesCreated} 個（${TEMPLATES.length} 個總計），示範資料新增 ${templateRecordsCreated} 筆`,
      );
      console.log(`- 公開示範（會議紀錄）：友善欄位顯示；保密示範（聯絡人）：localdata 檔含 schema`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("seed:test 失敗:", err);
  process.exit(1);
});
