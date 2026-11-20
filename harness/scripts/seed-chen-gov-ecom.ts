import "dotenv/config";
import { getDb } from "../../src/server/db";
import { createCategory } from "../../src/server/services/category-service";
import { createRecord } from "../../src/server/services/record-service";
import type { PermissionActor } from "../../src/server/security/permissions";

/**
 * 陳總交功課用_政府_電商_Django 帳號入庫（2026-11-20）
 * - warehouse_ecommerce_db（Django 倉儲電商系統），Django 帳號結構
 *   （accounts_user / accounts_staff / accounts_customer）
 * - 分類樹：新建「陳總交功課用_政府_電商_Django」→ 子分類「帳號」
 * - 每筆一 Record：title = username（與既有同 title 撞名時補 email）、
 *   data = { table, username, email, staff, superuser, last_login, created_at }
 * - 走 service 層：保留 OperationLog + searchContent 索引
 * - 冪等：分類依 (name, parentId)、資料依 (title, authorId) 判斷，已存在則略過
 * 用法：nvm use 22 && npx tsx harness/scripts/seed-chen-gov-ecom.ts
 */
const ADMIN_EMAIL = "admin@admin.com";
const PARENT_NAME = "陳總交功課用_政府_電商_Django";
const CHILD_NAME = "帳號";

interface DjangoAccount {
  table: "accounts_user" | "accounts_staff" | "accounts_customer";
  username: string;
  email: string;
  staff: boolean;
  superuser: boolean;
  lastLogin: string;
  createdAt: string;
}

/** warehouse_ecommerce_db 帳號清單（每批貼上後加到這裡；冪等可重跑） */
const ACCOUNTS: DjangoAccount[] = [
  {
    table: "accounts_user",
    username: "admin",
    email: "admin@admin.com",
    staff: true,
    superuser: true,
    lastLogin: "2026-08-22",
    createdAt: "2026-04-10",
  },
];

async function main() {
  const db = getDb();
  const admin = await db.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, role: true },
  });
  if (!admin) throw new Error(`admin 不存在：${ADMIN_EMAIL}（請先 npm run db:seed）`);
  const actor: PermissionActor = { id: admin.id, role: admin.role };

  // 分類樹（冪等）：陳總交功課用_政府_電商_Django → 帳號
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

  // 資料（冪等）：title 與既有（含上一批 nextjs）同 title 撞名時補 email 區分
  let created = 0;
  let skipped = 0;
  for (const acc of ACCOUNTS) {
    const bare = await db.record.findFirst({
      where: { title: acc.username, authorId: actor.id, deletedAt: null },
      select: { id: true },
    });
    const title = bare ? `${acc.username} (${acc.email})` : acc.username;

    const exists = await db.record.findFirst({
      where: { title, authorId: actor.id, deletedAt: null },
      select: { id: true },
    });
    if (exists) {
      skipped += 1;
      continue;
    }

    await createRecord(
      {
        title,
        dataJson: JSON.stringify({
          table: acc.table,
          username: acc.username,
          email: acc.email,
          staff: acc.staff,
          superuser: acc.superuser,
          last_login: acc.lastLogin,
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
    console.log(`✓ ${title} — ${acc.email} (${acc.table})`);
  }
  console.log(`完成：新增 ${created} 筆、略過 ${skipped} 筆（共 ${ACCOUNTS.length} 筆）`);
  console.log("accounts_staff / accounts_customer 貼上後加到 ACCOUNTS 再重跑即可（冪等）");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
