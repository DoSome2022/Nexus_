import "dotenv/config";
import { getDb } from "../../src/server/db";
import { createCategory } from "../../src/server/services/category-service";
import { createRecord } from "../../src/server/services/record-service";
import type { PermissionActor } from "../../src/server/security/permissions";

/**
 * popo_nextjs 帳號入庫（2026-11-20）
 * - 分類樹：新建「popo_nextjs」→ 子分類「帳號」
 * - 每筆一 Record：title = 名稱（撞名時補建立時間）、
 *   data = { username, name, role, created_at }
 * - 走 service 層：保留 OperationLog + searchContent 索引（username/名稱/role 皆可搜）
 * - 冪等：分類依 (name, parentId)、資料依本批分類下的 title 候選判斷，已存在則略過
 * 用法：nvm use 22 && npx tsx harness/scripts/seed-popo-nextjs.ts
 */
const ADMIN_EMAIL = "admin@admin.com";
const PARENT_NAME = "popo_nextjs";
const CHILD_NAME = "帳號";

interface PopoAccount {
  username: string;
  name: string;
  role: string;
  createdAt: string;
}

/** popo_nextjs 帳號清單（Username / 名稱 / Role / 建立時間） */
const ACCOUNTS: PopoAccount[] = [
  { username: "admin", name: "系統管理員", role: "ADMIN", createdAt: "2026-09-16" },
  { username: "staff", name: "清潔員工", role: "STAFF", createdAt: "2026-09-16" },
];

async function main() {
  const db = getDb();
  const admin = await db.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, role: true },
  });
  if (!admin) throw new Error(`admin 不存在：${ADMIN_EMAIL}（請先 npm run db:seed）`);
  const actor: PermissionActor = { id: admin.id, role: admin.role };

  // 分類樹（冪等）：popo_nextjs → 帳號
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

  let created = 0;
  let skipped = 0;
  for (const acc of ACCOUNTS) {
    const candidates = [acc.name, `${acc.name} (${acc.createdAt})`];

    // 冪等：本批分類下已有任一候選 title → 已入庫，略過
    const seeded = await db.record.findFirst({
      where: {
        authorId: actor.id,
        deletedAt: null,
        OR: candidates.map((t) => ({ title: t })),
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
    for (const candidate of candidates) {
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
        dataJson: JSON.stringify({
          username: acc.username,
          name: acc.name,
          role: acc.role,
          created_at: acc.createdAt,
        }),
        isPublic: true,
        isEditableByOthers: false,
        isConfidential: false,
        categoryIds: [childId],
      },
      actor,
    );
    created += 1;
    console.log(`✓ ${title} — ${acc.username} (${acc.role})`);
  }
  console.log(`完成：新增 ${created} 筆、略過 ${skipped} 筆（共 ${ACCOUNTS.length} 筆）`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
