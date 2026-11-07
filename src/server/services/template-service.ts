import { TRPCError } from "@trpc/server";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import { getDb } from "@/server/db";
import { logger } from "@/server/lib/logger";
import { logOperation } from "@/server/audit/operation-log";
import type { PermissionActor } from "@/server/security/permissions";
import {
  templateFieldSchema,
  type TemplateField,
  type TemplateInput,
  type TemplateUpdateInput,
} from "@/lib/schemas/template";

/**
 * 表單範本業務邏輯（TASK-008）
 * - 全站共用：list 所有登入者可用；create/update/delete 僅 ADMIN
 * - Record.schema 只存建立時的 snapshot，範本改動/刪除不影響既有紀錄
 * - 每次 CRUD 寫 OperationLog（targetType: RECORD_TEMPLATE）
 */

export interface TemplateDTO {
  id: string;
  name: string;
  description: string | null;
  fields: TemplateField[];
  createdAt: Date;
  updatedAt: Date;
}

const TEMPLATE_TARGET_TYPE = "RECORD_TEMPLATE";

function assertAdmin(actor: PermissionActor): void {
  if (actor.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 Admin 可管理範本" });
  }
}

/** 解析 DB Json fields → TemplateField[]；損壞回 null（寫入前都經 zod，此為防禦） */
function parseFields(fields: unknown): TemplateField[] | null {
  const parsed = templateFieldSchema.array().safeParse(fields);
  return parsed.success ? parsed.data : null;
}

export async function listTemplates(actor: PermissionActor): Promise<TemplateDTO[]> {
  void actor; // 任何登入者皆可列出（router 已擋未登入）
  const rows = await getDb().recordTemplate.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      fields: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const result: TemplateDTO[] = [];
  for (const row of rows) {
    const fields = parseFields(row.fields);
    if (!fields) {
      logger.error("template_corrupt_fields", { templateId: row.id });
      continue; // 損壞列跳過不中斷整個列表
    }
    result.push({ ...row, fields });
  }
  return result;
}

export async function createTemplate(
  input: TemplateInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  assertAdmin(actor);
  const startedAt = Date.now();

  const duplicate = await getDb().recordTemplate.findFirst({
    where: { name: input.name },
    select: { id: true },
  });
  if (duplicate) {
    throw new TRPCError({ code: "CONFLICT", message: "範本名稱已存在" });
  }

  const row = await getDb().recordTemplate.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      fields: input.fields as unknown as InputJsonValue, // zod 已驗證
      createdById: actor.id,
    },
  });
  await logOperation({
    actorId: actor.id,
    action: "CREATE",
    targetType: TEMPLATE_TARGET_TYPE,
    targetId: row.id,
    durationMs: Math.round(Date.now() - startedAt),
  });
  return { id: row.id };
}

export async function updateTemplate(
  input: TemplateUpdateInput,
  actor: PermissionActor,
  templateId: string,
): Promise<{ id: string }> {
  assertAdmin(actor);
  const startedAt = Date.now();

  const existing = await getDb().recordTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "範本不存在" });
  }
  const duplicate = await getDb().recordTemplate.findFirst({
    where: { name: input.name, id: { not: templateId } },
    select: { id: true },
  });
  if (duplicate) {
    throw new TRPCError({ code: "CONFLICT", message: "範本名稱已存在" });
  }

  await getDb().recordTemplate.update({
    where: { id: templateId },
    data: {
      name: input.name,
      description: input.description ?? null,
      fields: input.fields as unknown as InputJsonValue,
    },
  });
  await logOperation({
    actorId: actor.id,
    action: "UPDATE",
    targetType: TEMPLATE_TARGET_TYPE,
    targetId: templateId,
    durationMs: Math.round(Date.now() - startedAt),
  });
  return { id: templateId };
}

export async function deleteTemplate(
  templateId: string,
  actor: PermissionActor,
): Promise<{ id: string }> {
  assertAdmin(actor);
  const startedAt = Date.now();

  const existing = await getDb().recordTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "範本不存在" });
  }

  // 硬刪除：既有紀錄的 schema 為 snapshot，不受影響
  await getDb().recordTemplate.delete({ where: { id: templateId } });
  await logOperation({
    actorId: actor.id,
    action: "DELETE",
    targetType: TEMPLATE_TARGET_TYPE,
    targetId: templateId,
    durationMs: Math.round(Date.now() - startedAt),
  });
  return { id: templateId };
}
