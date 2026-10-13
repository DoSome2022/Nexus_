import { TRPCError } from "@trpc/server";
import { getDb } from "@/server/db";
import {
  canEdit,
  canRead,
  type PermissionActor,
} from "@/server/security/permissions";
import type { RelationCreateInput } from "@/lib/schemas/relation";

/**
 * 資料關聯業務邏輯（TASK-007）
 * - 建立：兩端都可讀（canRead）才可建立（他人保密資料不可關聯，不洩漏存在性）
 * - 刪除：任一端的 canEdit 或 Admin
 * - 顯示：另一端不可讀的關聯被過濾（getRecord 呼叫）
 */

export interface RelationDTO {
  id: string;
  direction: "out" | "in";
  label: string | null;
  related: {
    id: string;
    title: string;
    isPublic: boolean;
    isConfidential: boolean;
  };
}

const RELATION_PERMS_SELECT = {
  id: true,
  authorId: true,
  isPublic: true,
  isEditableByOthers: true,
  isConfidential: true,
  deletedAt: true,
} as const;

export async function createRelation(
  input: RelationCreateInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  if (input.fromId === input.toId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不可關聯到自己" });
  }

  const records = await getDb().record.findMany({
    where: { id: { in: [input.fromId, input.toId] }, deletedAt: null },
    select: RELATION_PERMS_SELECT,
  });
  const from = records.find((r) => r.id === input.fromId);
  const to = records.find((r) => r.id === input.toId);
  // 任一端不存在或不可讀 → 統一 NOT_FOUND（不洩漏哪一端）
  if (!from || !to || !canRead(from, actor) || !canRead(to, actor)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在或無權建立關聯" });
  }

  const existing = await getDb().recordRelation.findFirst({
    where: { fromId: input.fromId, toId: input.toId },
    select: { id: true },
  });
  if (existing) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "關聯已存在" });
  }

  const created = await getDb().recordRelation.create({
    data: {
      fromId: input.fromId,
      toId: input.toId,
      label: input.label ?? null,
    },
    select: { id: true },
  });
  await getDb().operationLog.create({
    data: {
      actorId: actor.id,
      action: "CREATE",
      targetType: "RECORD_RELATION",
      targetId: created.id,
      durationMs: Math.round(Date.now() - startedAt),
    },
  });
  return { id: created.id };
}

export async function deleteRelation(
  id: string,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  const relation = await getDb().recordRelation.findUnique({
    where: { id },
    include: {
      from: { select: RELATION_PERMS_SELECT },
      to: { select: RELATION_PERMS_SELECT },
    },
  });
  if (!relation) {
    throw new TRPCError({ code: "NOT_FOUND", message: "關聯不存在" });
  }

  const allowed =
    actor.role === "ADMIN" ||
    (!relation.from.deletedAt && canEdit(relation.from, actor)) ||
    (!relation.to.deletedAt && canEdit(relation.to, actor));
  if (!allowed) {
    throw new TRPCError({ code: "NOT_FOUND", message: "關聯不存在或無權刪除" });
  }

  await getDb().recordRelation.delete({ where: { id } });
  await getDb().operationLog.create({
    data: {
      actorId: actor.id,
      action: "DELETE",
      targetType: "RECORD_RELATION",
      targetId: id,
      durationMs: Math.round(Date.now() - startedAt),
    },
  });
  return { id };
}

/** 檢視頁用：該資料的雙向關聯，過濾另一端不可讀（防洩漏存在性） */
export async function listRelationsForRecord(
  recordId: string,
  actor: PermissionActor,
): Promise<RelationDTO[]> {
  const [froms, tos] = await Promise.all([
    getDb().recordRelation.findMany({
      where: { fromId: recordId },
      include: {
        to: { select: { id: true, title: true, authorId: true, isPublic: true, isEditableByOthers: true, isConfidential: true, deletedAt: true } },
      },
    }),
    getDb().recordRelation.findMany({
      where: { toId: recordId },
      include: {
        from: { select: { id: true, title: true, authorId: true, isPublic: true, isEditableByOthers: true, isConfidential: true, deletedAt: true } },
      },
    }),
  ]);

  const out = froms
    .filter((r) => !r.to.deletedAt && canRead(r.to, actor))
    .map((r) => ({
      id: r.id,
      direction: "out" as const,
      label: r.label,
      related: {
        id: r.to.id,
        title: r.to.title,
        isPublic: r.to.isPublic,
        isConfidential: r.to.isConfidential,
      },
    }));
  const inn = tos
    .filter((r) => !r.from.deletedAt && canRead(r.from, actor))
    .map((r) => ({
      id: r.id,
      direction: "in" as const,
      label: r.label,
      related: {
        id: r.from.id,
        title: r.from.title,
        isPublic: r.from.isPublic,
        isConfidential: r.from.isConfidential,
      },
    }));

  return [...out, ...inn];
}
