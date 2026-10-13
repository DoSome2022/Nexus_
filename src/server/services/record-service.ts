import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "@/server/db";
import { canRead, type PermissionActor } from "@/server/security/permissions";
import {
  createRecordFile,
  readRecordFile,
  removeRecordFile,
  LocaldataCorruptedFileError,
  LocaldataFileNotFoundError,
  type LocalRecordFile,
} from "@/server/repositories/localdata-repository";
import { logger } from "@/server/lib/logger";
import type { CreateRecordInput } from "@/lib/schemas/record";

/**
 * Record 業務邏輯（TASK-003，依 CLAUDE.backend.md 分層）
 * - create：保密先寫檔 → DB metadata（$transaction 含 OperationLog）→ 失敗刪檔回滾
 * - search：SQL 層 OR 過濾（公開/作者）+ service 層 canRead 兜底
 * - get：canRead 檢查；保密內容從 localdata 檔案載入
 */

export interface RecordListItemDTO {
  id: string;
  title: string;
  isPublic: boolean;
  isConfidential: boolean;
  authorId: string;
  updatedAt: Date;
}

export interface RecordDetailDTO extends RecordListItemDTO {
  schema: unknown;
  data: unknown;
}

function toListItem(r: {
  id: string;
  title: string;
  isPublic: boolean;
  isConfidential: boolean;
  authorId: string;
  updatedAt: Date;
}): RecordListItemDTO {
  return {
    id: r.id,
    title: r.title,
    isPublic: r.isPublic,
    isConfidential: r.isConfidential,
    authorId: r.authorId,
    updatedAt: r.updatedAt,
  };
}

export async function createRecord(
  input: CreateRecordInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  const id = randomUUID();
  const data = JSON.parse(input.dataJson); // schema 已驗證是合法 JSON
  const schema = {}; // 欄位定義功能留後續 Task

  const commonData = {
    id,
    authorId: actor.id,
    title: input.title,
    isPublic: input.isPublic,
    isEditableByOthers: input.isEditableByOthers,
    isConfidential: input.isConfidential,
  };

  if (input.isConfidential) {
    // 保密：先寫檔 → DB metadata（data/schema null）→ DB 失敗刪檔回滾
    const nowIso = new Date().toISOString();
    const file: LocalRecordFile = {
      version: 1,
      id,
      authorId: actor.id,
      schema,
      data,
      changes: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await createRecordFile(file);
    try {
      await getDb().$transaction([
        getDb().record.create({
          data: { ...commonData }, // 省略 schema/data → SQL NULL（null = 內容在 localdata）
        }),
        getDb().operationLog.create({
          data: {
            actorId: actor.id,
            action: "CREATE",
            targetType: "RECORD",
            targetId: id,
            durationMs: Math.round(Date.now() - startedAt),
          },
        }),
      ]);
    } catch (err) {
      await removeRecordFile(id);
      throw err;
    }
  } else {
    await getDb().$transaction([
      getDb().record.create({
        data: { ...commonData, schema, data },
      }),
      getDb().operationLog.create({
        data: {
          actorId: actor.id,
          action: "CREATE",
          targetType: "RECORD",
          targetId: id,
          durationMs: Math.round(Date.now() - startedAt),
        },
      }),
    ]);
  }

  return { id };
}

export async function searchRecords(
  q: string,
  actor: PermissionActor,
  limit: number,
): Promise<RecordListItemDTO[]> {
  const rows = await getDb().record.findMany({
    where: {
      deletedAt: null,
      title: { contains: q, mode: "insensitive" }, // pg_trgm GIN 加速
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
    take: limit,
  });
  // 兜底：SQL 已過濾，此處再跑 canRead 純函式（防禦性，見 CLAUDE.security.md）
  return rows.filter((r) => canRead(r, actor)).map(toListItem);
}

export async function getRecord(id: string, actor: PermissionActor): Promise<RecordDetailDTO> {
  const record = await getDb().record.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
      title: true,
      schema: true,
      data: true,
      isPublic: true,
      isEditableByOthers: true,
      isConfidential: true,
      deletedAt: true,
      updatedAt: true,
    },
  });

  // 不存在/已軟刪除/無權限 → 一律 NOT_FOUND（不洩漏存在性）
  if (!record || record.deletedAt || !canRead(record, actor)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在" });
  }

  let schema: unknown = record.schema;
  let data: unknown = record.data;
  if (record.isConfidential) {
    try {
      const file = await readRecordFile(record.id);
      schema = file.schema;
      data = file.data;
    } catch (err) {
      if (err instanceof LocaldataFileNotFoundError || err instanceof LocaldataCorruptedFileError) {
        logger.error("localdata_read_failed", { recordId: record.id });
        throw new TRPCError({ code: "NOT_FOUND", message: "資料內容無法讀取，請聯絡管理員" });
      }
      throw err;
    }
  }

  return { ...toListItem(record), schema, data };
}
