import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "@/server/db";
import type { PermissionActor } from "@/server/security/permissions";
import { canEdit, canManageCategory, canRead } from "@/server/security/permissions";
import type { CategoryCreateInput, CategoryLinkInput, CategoryUpdateInput } from "@/lib/schemas/category";
import { findAncestors, getDescendantIds, wouldCreateCycle } from "@/lib/category-tree";
import { loadCategoryIndex, logRebuildFailure, rebuildSearchContentForCategorySubtree, rebuildRecordSearchContent } from "@/server/services/category-query";

/**
 * 資料分類業務邏輯（TASK-012）
 * - 分類全站可見（登入即可讀）；create/update/delete 為作者制（作者或 ADMIN）
 * - per-parent 名稱重複由 service 檢查（無 DB unique：Prisma 不支援 NULLS NOT DISTINCT）
 * - 移動節點檢查 cycle；rename/move 後重建子樹連結資料的 searchContent
 * - link/unlink 需 record 的 canEdit（或 ADMIN，垃圾桶僅 ADMIN）；每筆上限 20
 * - 每次寫入記 OperationLog（CATEGORY / RECORD_CATEGORY）
 */

export interface CategoryDTO {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CategoryBrowseDTO {
  category: CategoryDTO;
  ancestors: CategoryDTO[];
  children: CategoryDTO[];
  records: Array<{
    id: string;
    title: string;
    isPublic: boolean;
    isConfidential: boolean;
    authorId: string;
    updatedAt: Date;
  }>;
  canManage: boolean;
  /** 掛在此分類的連結數（含垃圾桶；刪除分類時會一併自動解除） */
  linkCount: number;
  /** 子樹分類數（含自己；複製確認對話框用） */
  subtreeCategoryCount: number;
  /** 子樹內全部連結數（含垃圾桶；複製確認對話框用） */
  subtreeLinkCount: number;
}

const CATEGORY_TARGET_TYPE = "CATEGORY";
const RECORD_CATEGORY_TARGET_TYPE = "RECORD_CATEGORY";
const MAX_CATEGORIES_PER_RECORD = 20;

/** OperationLog 寫入（照 relation-service 的直接 create 模式） */
async function logCategoryOperation(
  actor: PermissionActor,
  action: "CREATE" | "UPDATE" | "DELETE",
  targetType: string,
  targetId: string,
  startedAt: number,
): Promise<void> {
  await getDb().operationLog.create({
    data: {
      actorId: actor.id,
      action,
      targetType,
      targetId,
      durationMs: Math.round(Date.now() - startedAt),
      ip: null,
      userAgent: null,
    },
  });
}

export async function listCategories(): Promise<CategoryDTO[]> {
  return getDb().category.findMany({
    select: { id: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  });
}

export async function browseCategory(
  id: string,
  actor: PermissionActor,
): Promise<CategoryBrowseDTO> {
  const category = await getDb().category.findUnique({
    where: { id },
    select: { id: true, name: true, parentId: true, createdById: true },
  });
  if (!category) throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });

  const index = await loadCategoryIndex();
  const ancestors = findAncestors(id, index).map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
  const children = await getDb().category.findMany({
    where: { parentId: id },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  });

  // 只列「直接掛此分類」的可讀資料（SQL 先過權限 + canRead 兜底）
  const rows = await getDb().record.findMany({
    where: {
      deletedAt: null,
      categories: { some: { categoryId: id } },
      OR: [{ isPublic: true }, { authorId: actor.id }],
    },
    select: {
      id: true,
      title: true,
      isPublic: true,
      isEditableByOthers: true,
      isConfidential: true,
      authorId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const records = rows
    .filter((r) => canRead(r, actor))
    .map((r) => ({
      id: r.id,
      title: r.title,
      isPublic: r.isPublic,
      isConfidential: r.isConfidential,
      authorId: r.authorId,
      updatedAt: r.updatedAt,
    }));

  // 含垃圾桶內軟刪除資料的連結（刪除分類時會一併解除）
  const linkCount = await getDb().recordCategory.count({ where: { categoryId: id } });
  // 子樹統計（複製確認對話框用）
  const subtreeIds = getDescendantIds(id, index);
  const subtreeLinkCount = await getDb().recordCategory.count({
    where: { categoryId: { in: subtreeIds } },
  });

  return {
    category: { id: category.id, name: category.name, parentId: category.parentId },
    ancestors,
    children,
    records,
    canManage: canManageCategory(category, actor),
    linkCount,
    subtreeCategoryCount: subtreeIds.length,
    subtreeLinkCount,
  };
}

/** per-parent 名稱重複檢查（null parent 是 IS NULL，undefined 是忽略——不可混用） */
async function findDuplicateName(
  name: string,
  parentId: string | null | undefined,
  excludeId?: string,
): Promise<boolean> {
  const existing = await getDb().category.findFirst({
    where: {
      name,
      parentId: parentId ?? null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function createCategory(
  input: CategoryCreateInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  if (input.parentId) {
    const parent = await getDb().category.findUnique({
      where: { id: input.parentId },
      select: { id: true },
    });
    if (!parent) throw new TRPCError({ code: "BAD_REQUEST", message: "上層分類不存在" });
  }
  if (await findDuplicateName(input.name, input.parentId)) {
    throw new TRPCError({ code: "CONFLICT", message: "同層已有相同名稱的分類" });
  }

  const created = await getDb().category.create({
    data: {
      name: input.name,
      parentId: input.parentId ?? null,
      createdById: actor.id,
    },
  });
  await logCategoryOperation(actor, "CREATE", CATEGORY_TARGET_TYPE, created.id, startedAt);
  return { id: created.id };
}

export async function updateCategory(
  input: CategoryUpdateInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  const existing = await getDb().category.findUnique({
    where: { id: input.id },
    select: { id: true, name: true, parentId: true, createdById: true },
  });
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });
  if (!canManageCategory(existing, actor)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者或 Admin 可管理此分類" });
  }

  const effectiveName = input.name ?? existing.name;
  // undefined = 不變更；null = 移到根
  const effectiveParentId = input.parentId !== undefined ? input.parentId : existing.parentId;

  if (input.parentId !== undefined && input.parentId !== null) {
    const parent = await getDb().category.findUnique({
      where: { id: input.parentId },
      select: { id: true },
    });
    if (!parent) throw new TRPCError({ code: "BAD_REQUEST", message: "上層分類不存在" });
  }
  if (input.parentId !== undefined && wouldCreateCycle(input.id, effectiveParentId, await loadCategoryIndex())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不可移至自己的子分類下" });
  }
  if (
    effectiveName !== existing.name ||
    (input.parentId !== undefined && input.parentId !== existing.parentId)
  ) {
    if (await findDuplicateName(effectiveName, effectiveParentId, input.id)) {
      throw new TRPCError({ code: "CONFLICT", message: "同層已有相同名稱的分類" });
    }
  }

  const updated = await getDb().category.update({
    where: { id: input.id },
    data: { name: effectiveName, parentId: effectiveParentId },
  });

  // 名稱或路徑改變 → 重建子樹連結資料的 searchContent（索引失敗不阻斷分類更新）
  const pathChanged = effectiveName !== existing.name || effectiveParentId !== existing.parentId;
  if (pathChanged) {
    try {
      await rebuildSearchContentForCategorySubtree(input.id);
    } catch (err) {
      logRebuildFailure(`rename/move category ${input.id}`, err);
    }
  }
  await logCategoryOperation(actor, "UPDATE", CATEGORY_TARGET_TYPE, updated.id, startedAt);
  return { id: updated.id };
}

/**
 * 刪除分類（需求調整）：自動解除全部連結（含垃圾桶）後刪除，不再阻擋。
 * 仍阻擋：有子分類（請先處理子分類）。
 * 解除後重建受影響 records 的 searchContent（移除已刪分類名）。
 */
export async function deleteCategory(
  id: string,
  actor: PermissionActor,
): Promise<{ id: string; unlinked: number }> {
  const startedAt = Date.now();
  const existing = await getDb().category.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  });
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });
  if (!canManageCategory(existing, actor)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者或 Admin 可管理此分類" });
  }

  const childCount = await getDb().category.count({ where: { parentId: id } });
  if (childCount > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "請先處理子分類再刪除" });
  }

  // 收集受影響的 records（含垃圾桶）→ 刪除連結 + 分類 → 重建其 searchContent
  const links = await getDb().recordCategory.findMany({
    where: { categoryId: id },
    select: { recordId: true },
  });
  const affectedRecordIds = [...new Set(links.map((l) => l.recordId))];

  try {
    await getDb().$transaction([
      getDb().recordCategory.deleteMany({ where: { categoryId: id } }),
      getDb().category.delete({ where: { id } }),
      getDb().operationLog.create({
        data: {
          actorId: actor.id,
          action: "DELETE",
          targetType: CATEGORY_TARGET_TYPE,
          targetId: id,
          durationMs: Math.round(Date.now() - startedAt),
          ip: null,
          userAgent: null,
        },
      }),
    ]);
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });
    }
    throw err;
  }

  if (affectedRecordIds.length > 0) {
    try {
      await rebuildRecordSearchContent(affectedRecordIds);
    } catch (err) {
      logRebuildFailure(`delete category ${id}`, err);
    }
  }
  return { id, unlinked: links.length };
}

/**
 * 複製分類（TASK-013）：連同子分類樹一起複製，掛在子樹內的資料連結也帶到對應新分類
 * - 人人可複製（不需作者權限）；複製者成為新樹全部節點的建立者
 * - 新根名稱自動「(副本)」後綴，同層衝突遞增「(副本2)」…；子分類名保持原名
 * - 連結全數複製（含垃圾桶、不限 record 權限——複製是分類側操作；確認對話框明示）
 * - 資料本身不複製；受影響 records 的 searchContent 重建
 */
export async function duplicateCategory(
  id: string,
  actor: PermissionActor,
): Promise<{ id: string; name: string; copiedCategories: number; copiedLinks: number }> {
  const startedAt = Date.now();
  const original = await getDb().category.findUnique({
    where: { id },
    select: { id: true, name: true, parentId: true },
  });
  if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });

  const index = await loadCategoryIndex();
  const subtreeIds = getDescendantIds(id, index);
  const subtree = await getDb().category.findMany({
    where: { id: { in: subtreeIds } },
    select: { id: true, name: true, parentId: true },
  });
  if (subtree.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });

  // 新 id 預先產生：子節點 parentId 需指向新 id
  const idMap = new Map<string, string>(subtree.map((c) => [c.id, randomUUID()]));

  // 依深度排序（距原根越近越先）：findMany 回傳順序不保證父先於子，
  // transaction 依序執行時子分類先建會撞 Category_parentId_fkey
  const depthOf = new Map<string, number>();
  for (const c of subtree) {
    let depth = 0;
    let cursor: string | null = c.id;
    while (cursor !== original.id) {
      if (!cursor) break; // parent 鏈斷裂（資料異常）防護
      depth += 1;
      cursor = index.get(cursor)?.parentId ?? null;
    }
    depthOf.set(c.id, depth);
  }
  const ordered = [...subtree].sort(
    (a, b) => (depthOf.get(a.id) ?? 0) - (depthOf.get(b.id) ?? 0),
  );

  // 根名稱避讓（與原分類同層）
  let rootName = `${original.name}(副本)`;
  for (let n = 2; n <= 100 && (await findDuplicateName(rootName, original.parentId)); n++) {
    rootName = `${original.name}(副本${n})`;
  }

  // 建立新分類（子分類名不變；createdById 一律為複製者）
  const creates = ordered.map((c) =>
    getDb().category.create({
      data: {
        id: idMap.get(c.id)!,
        name: c.id === original.id ? rootName : c.name,
        parentId: c.parentId ? (idMap.get(c.parentId) ?? c.parentId) : c.parentId,
        createdById: actor.id,
      },
    }),
  );

  // 複製子樹內全部連結（對應到新分類 id；同一 record 多連結各自複製）
  const links = await getDb().recordCategory.findMany({
    where: { categoryId: { in: subtreeIds } },
    select: { recordId: true, categoryId: true },
  });
  const linkCreates = links.flatMap((l) => {
    const newCategoryId = idMap.get(l.categoryId);
    return newCategoryId
      ? [getDb().recordCategory.create({ data: { recordId: l.recordId, categoryId: newCategoryId } })]
      : [];
  });

  const rootId = idMap.get(original.id)!;
  await getDb().$transaction([
    ...creates,
    ...linkCreates,
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "CREATE",
        targetType: CATEGORY_TARGET_TYPE,
        targetId: rootId,
        durationMs: Math.round(Date.now() - startedAt),
        ip: null,
        userAgent: null,
      },
    }),
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "CREATE",
        targetType: RECORD_CATEGORY_TARGET_TYPE,
        targetId: rootId,
        durationMs: Math.round(Date.now() - startedAt),
        ip: null,
        userAgent: null,
      },
    }),
  ]);

  if (links.length > 0) {
    const affectedRecordIds = [...new Set(links.map((l) => l.recordId))];
    try {
      await rebuildRecordSearchContent(affectedRecordIds);
    } catch (err) {
      logRebuildFailure(`duplicate category ${id}`, err);
    }
  }
  return { id: rootId, name: rootName, copiedCategories: subtree.length, copiedLinks: links.length };
}

/** 檢查 record 可否被 actor 進行分類操作：可讀 + （可編輯或 ADMIN）；垃圾桶僅 ADMIN */
async function assertRecordCategoryAllowed(
  recordId: string,
  actor: PermissionActor,
): Promise<void> {
  const record = await getDb().record.findUnique({
    where: { id: recordId },
    select: { id: true, authorId: true, isPublic: true, isEditableByOthers: true, isConfidential: true, deletedAt: true },
  });
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在" });
  const allowed = !record.deletedAt
    ? actor.role === "ADMIN" || canEdit(record, actor)
    : actor.role === "ADMIN";
  if (!allowed) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在或無權變更分類" });
  }
}

export async function linkRecordCategory(
  input: CategoryLinkInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  await assertRecordCategoryAllowed(input.recordId, actor);

  const category = await getDb().category.findUnique({
    where: { id: input.categoryId },
    select: { id: true },
  });
  if (!category) throw new TRPCError({ code: "NOT_FOUND", message: "分類不存在" });

  const linkCount = await getDb().recordCategory.count({ where: { recordId: input.recordId } });
  if (linkCount >= MAX_CATEGORIES_PER_RECORD) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `每筆資料最多 ${MAX_CATEGORIES_PER_RECORD} 個分類` });
  }
  const existing = await getDb().recordCategory.findFirst({
    where: { recordId: input.recordId, categoryId: input.categoryId },
    select: { id: true },
  });
  if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "此分類已連結" });

  let created;
  try {
    created = await getDb().recordCategory.create({
      data: { recordId: input.recordId, categoryId: input.categoryId },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "此分類已連結" });
    }
    throw err;
  }

  try {
    await rebuildRecordSearchContent([input.recordId]);
  } catch (err) {
    logRebuildFailure(`link record ${input.recordId}`, err);
  }
  await logCategoryOperation(actor, "CREATE", RECORD_CATEGORY_TARGET_TYPE, created.id, startedAt);
  return { id: created.id };
}

export async function unlinkRecordCategory(
  input: CategoryLinkInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  await assertRecordCategoryAllowed(input.recordId, actor);

  const link = await getDb().recordCategory.findFirst({
    where: { recordId: input.recordId, categoryId: input.categoryId },
    select: { id: true },
  });
  if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "此分類未連結" });

  await getDb().recordCategory.delete({ where: { id: link.id } });
  try {
    await rebuildRecordSearchContent([input.recordId]);
  } catch (err) {
    logRebuildFailure(`unlink record ${input.recordId}`, err);
  }
  await logCategoryOperation(actor, "DELETE", RECORD_CATEGORY_TARGET_TYPE, link.id, startedAt);
  return { id: link.id };
}
