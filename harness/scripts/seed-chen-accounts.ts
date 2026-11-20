import "dotenv/config";
import { getDb } from "../../src/server/db";
import { createCategory } from "../../src/server/services/category-service";
import { createRecord } from "../../src/server/services/record-service";
import type { PermissionActor } from "../../src/server/security/permissions";

/**
 * 陳總交功課用_nextjs 帳號清單入庫（2026-11-20）
 * - 分類樹：新建「陳總交功課用_nextjs」→ 子分類「帳號」，18 筆全掛上
 * - 每筆一 Record：title = 名稱（同名時補 email 區分）、data = { email, name }
 * - 走 service 層（createRecord/createCategory）：保留 OperationLog、
 *   searchContent 索引（email/名稱/分類名皆可搜）
 * - 冪等：分類依 (name, parentId)、資料依 (title, authorId) 判斷，已存在則略過
 * 用法：nvm use 22 && npx tsx harness/scripts/seed-chen-accounts.ts
 */
const ADMIN_EMAIL = "admin@admin.com";
const PARENT_NAME = "陳總交功課用_nextjs";
const CHILD_NAME = "帳號";

const ACCOUNTS = [
  { email: "admin@admin.com", name: "admin" },
  { email: "koo@koo.com", name: "koo" },
  { email: "koo@staff.com", name: "koo" },
  { email: "takcheongadmin@gmail.com", name: "admin" },
  { email: "hongkong@trimco.com", name: "Trimco Group (Hong Kong) Company Limited" },
  { email: "zibai@company.com.cn", name: "ZIBAI" },
  { email: "enquiry@elementspp.com", name: "Elements Printing and Packaging Limited" },
  { email: "183294485129@163.com", name: "中山市鑫耐螺丝模具厂" },
  { email: "Beautylabelstaff1@gmail.com", name: "staff1" },
  { email: "Beautylabelstaff2@gmail.com", name: "staff2" },
  { email: "Beautylabelstaff3@gmail.com", name: "staff3" },
  { email: "cheukyen@126.com", name: "卓恩輔料" },
  { email: "tvpreport1@gmail.com", name: "Ting Ting Ting Chan" },
  { email: "12341421@1234124124.com", name: "創圍電視" },
  { email: "huangwei@126.com", name: "huangwei" },
  { email: "info@SmithGuilai.com", name: "史密斯貴來" },
  { email: "info@carhome.com", name: "郭英男" },
  { email: "info@allone.com", name: "黃齊" },
] as const;

async function main() {
  const db = getDb();
  const admin = await db.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, role: true },
  });
  if (!admin) throw new Error(`admin 不存在：${ADMIN_EMAIL}（請先 npm run db:seed）`);
  const actor: PermissionActor = { id: admin.id, role: admin.role };

  // 分類樹（冪等）：陳總交功課用_nextjs → 帳號
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

  // 資料（冪等）：同名 title 第二次起補 email 區分
  const seenNames = new Set<string>();
  let created = 0;
  let skipped = 0;
  for (const acc of ACCOUNTS) {
    const title = seenNames.has(acc.name) ? `${acc.name} (${acc.email})` : acc.name;
    seenNames.add(acc.name);

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
        dataJson: JSON.stringify({ email: acc.email, name: acc.name }),
        isPublic: true,
        isEditableByOthers: false,
        isConfidential: false,
        categoryIds: [childId],
      },
      actor,
    );
    created += 1;
    console.log(`✓ ${title} — ${acc.email}`);
  }
  console.log(`完成：新增 ${created} 筆、略過 ${skipped} 筆（共 ${ACCOUNTS.length} 筆）`);
  console.log("驗證：/categories 應見「陳總交功課用_nextjs → 帳號」；搜 email 或「陳總交功課用_nextjs」應命中");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
