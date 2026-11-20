import "dotenv/config";
import { getDb } from "../../src/server/db";
import { createCategory } from "../../src/server/services/category-service";
import { createRecord } from "../../src/server/services/record-service";
import type { PermissionActor } from "../../src/server/security/permissions";

/**
 * vicent_TO_DO_SYS 帳號入庫（2026-11-20）
 * - 13 筆帳號（多數無 email）
 * - 分類樹：新建「vicent_TO_DO_SYS」→ 子分類「帳號」
 * - 每筆一 Record：title = 名稱；與既有資料撞名時依序補 email / 建立時間區分
 * - data = { email: string | null, name, created_at }
 * - 走 service 層：保留 OperationLog + searchContent 索引
 * - 冪等：分類依 (name, parentId)、資料依 (title, authorId) 判斷，已存在則略過
 * 用法：nvm use 22 && npx tsx harness/scripts/seed-vicent-todosys.ts
 */
const ADMIN_EMAIL = "admin@admin.com";
const PARENT_NAME = "vicent_TO_DO_SYS";
const CHILD_NAME = "帳號";

interface TodoSysAccount {
  email: string | null;
  name: string;
  createdAt: string;
}

/** vicent_TO_DO_SYS 帳號清單（Email / 名稱 / 建立時間） */
const ACCOUNTS: TodoSysAccount[] = [
  { email: "admin@admin.com", name: "admin", createdAt: "2026-06-29" },
  { email: null, name: "Sales", createdAt: "2026-06-30" },
  { email: null, name: "PM", createdAt: "2026-07-02" },
  { email: null, name: "Ah Fung", createdAt: "2026-07-03" },
  { email: null, name: "Chloe", createdAt: "2026-07-03" },
  { email: null, name: "Jason", createdAt: "2026-07-03" },
  { email: null, name: "Chris", createdAt: "2026-07-03" },
  { email: null, name: "Sam", createdAt: "2026-07-03" },
  { email: null, name: "pingping", createdAt: "2026-07-23" },
  { email: null, name: "Kat", createdAt: "2026-07-23" },
  { email: null, name: "Jayden", createdAt: "2026-07-23" },
  { email: null, name: "kanny mak", createdAt: "2026-08-31" },
  { email: null, name: "jenny hong", createdAt: "2026-08-31" },
];

async function main() {
  const db = getDb();
  const admin = await db.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, role: true },
  });
  if (!admin) throw new Error(`admin 不存在：${ADMIN_EMAIL}（請先 npm run db:seed）`);
  const actor: PermissionActor = { id: admin.id, role: admin.role };

  // 分類樹（冪等）：vicent_TO_DO_SYS → 帳號
  const parentExists = await db.category.findFirst({
    where: { name: PARENT_NAME, parentId: null },
    select: { id: true },
  });
  const parentId = parentExists?.id ?? (await createCategory({ name: PARENT_NAME }, actor)).id;

  const childExists = await db.category.findFirst({
    where: { name: CHILD_NAME, parentId },
    select: { id: true },
  });
  const childId = childExists?.id ?? (await createCategory({ name: CHILD_NAME, parentId }, actor)).id;
  console.log(`分類就緒：${PARENT_NAME} (${parentId}) → ${CHILD_NAME} (${childId})`);

  /** title 候選清單（撞名時依序補 email / 建立時間） */
  function titleCandidates(acc: TodoSysAccount): string[] {
    return [
      acc.name,
      ...(acc.email ? [`${acc.name} (${acc.email})`] : []),
      ...(acc.email ? [`${acc.name} (${acc.email} ${acc.createdAt})`] : [`${acc.name} (${acc.createdAt})`]),
    ];
  }

  let created = 0;
  let skipped = 0;
  for (const acc of ACCOUNTS) {
    // 冪等：本批分類下已有任一候選 title → 已入庫，略過
    const seeded = await db.record.findFirst({
      where: {
        authorId: actor.id,
        deletedAt: null,
        OR: titleCandidates(acc).map((t) => ({ title: t })),
        categories: { some: { categoryId: childId } },
      },
      select: { id: true },
    });
    if (seeded) {
      skipped += 1;
      continue;
    }

    // 挑第一個未被（其他批）佔用的候選
    let title = "";
    for (const candidate of titleCandidates(acc)) {
      const taken = await db.record.findFirst({
        where: { title: candidate, authorId: actor.id, deletedAt: null },
        select: { id: true },
      });
      if (!taken) {
        title = candidate;
        break;
      }
    }
    if (!title) throw new Error(`找不到可用 title：${acc.name}（候選全數被佔用）`);

    await createRecord(
      {
        title,
        dataJson: JSON.stringify({ email: acc.email, name: acc.name, created_at: acc.createdAt }),
        isPublic: true,
        isEditableByOthers: false,
        isConfidential: false,
        categoryIds: [childId],
      },
      actor,
    );
    created += 1;
    console.log(`✓ ${title} — ${acc.email ?? "(冇 email)"}`);
  }
  console.log(`完成：新增 ${created} 筆、略過 ${skipped} 筆（共 ${ACCOUNTS.length} 筆）`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
