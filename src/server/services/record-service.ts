import { createHash, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import { getDb } from "@/server/db";
import {
  canDelete,
  canEdit,
  canRead,
  type PermissionActor,
} from "@/server/security/permissions";
import {
  createRecordFile,
  moveToTrash,
  readRecordFile,
  removeRecordFile,
  restoreFromTrash,
  updateRecordFile,
  LocaldataCorruptedFileError,
  LocaldataFileNotFoundError,
  type LocalRecordFile,
} from "@/server/repositories/localdata-repository";
import { logger } from "@/server/lib/logger";
import { listRelationsForRecord, type RelationDTO } from "@/server/services/relation-service";
import type { CreateRecordInput, UpdateRecordInput } from "@/lib/schemas/record";

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
  isEditableByOthers: boolean;
  /** 依 actor 計算（TASK-005），UI 渲染按鈕用 */
  canEdit: boolean;
  canDelete: boolean;
  /** 資料關聯（TASK-007；另一端不可讀者已過濾） */
  relations: RelationDTO[];
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

/** searchRecords 的 raw query 回傳列（TASK-006） */
interface SearchRow {
  id: string;
  title: string;
  isPublic: boolean;
  isEditableByOthers: boolean;
  isConfidential: boolean;
  authorId: string;
  updatedAt: Date;
}

export async function searchRecords(
  q: string,
  actor: PermissionActor,
  limit: number,
): Promise<RecordListItemDTO[]> {
  // TASK-006：ILIKE（pg_trgm 模糊）OR tsquery（nexus_zh 近義詞）
  // 排序：直接相符優先 → ts_rank 相關度 → updatedAt
  // 全部參數化（$1 q、$2 actorId、$3 limit）；config 名 nexus_zh 為常數非輸入
  const like = `%${q}%`;
  const rows = await getDb().$queryRaw<SearchRow[]>`
    SELECT id, title, "isPublic", "isEditableByOthers", "isConfidential", "authorId", "updatedAt"
    FROM "Record"
    WHERE "deletedAt" IS NULL
      AND ("title" ILIKE ${like}
           OR "searchVector" @@ plainto_tsquery('nexus_zh', ${q}))
      AND ("isPublic" = true OR "authorId" = ${actor.id})
    ORDER BY ("title" ILIKE ${like}) DESC,
             ts_rank("searchVector", plainto_tsquery('nexus_zh', ${q})) DESC,
             "updatedAt" DESC
    LIMIT ${limit}
  `;
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

  return {
    ...toListItem(record),
    schema,
    data,
    isEditableByOthers: record.isEditableByOthers,
    canEdit: canEdit(record, actor),
    canDelete: canDelete(record, actor),
    relations: await listRelationsForRecord(record.id, actor),
  };
}

/** JSON 安全型別（ChangeLog old/new 值） */
export type JsonLike =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonLike }
  | JsonLike[];

export interface RecordFieldDiff {
  field: string;
  oldValue: JsonLike;
  newValue: JsonLike;
}

/** 純函式：計算編輯的欄位變化（無變化回空陣列；data 以 JSON 語義比較） */
export function diffRecordFields(
  old: { title: string; data: JsonLike; isPublic: boolean; isEditableByOthers: boolean },
  input: UpdateRecordInput,
): RecordFieldDiff[] {
  const diffs: RecordFieldDiff[] = [];
  if (input.title !== undefined && input.title !== old.title) {
    diffs.push({ field: "title", oldValue: old.title, newValue: input.title });
  }
  if (input.dataJson !== undefined) {
    const newData = JSON.parse(input.dataJson) as JsonLike;
    if (JSON.stringify(newData) !== JSON.stringify(old.data)) {
      diffs.push({ field: "data", oldValue: old.data, newValue: newData });
    }
  }
  if (input.isPublic !== undefined && input.isPublic !== old.isPublic) {
    diffs.push({ field: "isPublic", oldValue: old.isPublic, newValue: input.isPublic });
  }
  if (
    input.isEditableByOthers !== undefined &&
    input.isEditableByOthers !== old.isEditableByOthers
  ) {
    diffs.push({
      field: "isEditableByOthers",
      oldValue: old.isEditableByOthers,
      newValue: input.isEditableByOthers,
    });
  }
  return diffs;
}

/** 編輯（TASK-005）：canEdit 檢查；保密資料 ChangeLog 寫檔案、DB 失敗檔案回滾 */
export async function updateRecord(
  input: UpdateRecordInput,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  const record = await getDb().record.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      authorId: true,
      title: true,
      data: true,
      isPublic: true,
      isEditableByOthers: true,
      isConfidential: true,
      deletedAt: true,
    },
  });
  if (!record || record.deletedAt || !canEdit(record, actor)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在或無權編輯" });
  }

  // 保密資料的儲存位置/可見性不可變更（TASK-005 限制）
  if (record.isConfidential && (input.isPublic !== undefined || input.isEditableByOthers !== undefined)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "保密資料不可變更可見性" });
  }

  const now = new Date();
  const updates = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
    ...(input.isEditableByOthers !== undefined
      ? { isEditableByOthers: input.isEditableByOthers }
      : {}),
  };
  const durationMs = () => Math.round(Date.now() - startedAt);

  if (record.isConfidential) {
    // 舊值以檔案內容為準（DB data 為 NULL）
    const oldFile = await readRecordFile(record.id);
    const diffs = diffRecordFields(
      { ...record, data: oldFile.data as JsonLike },
      input,
    );
    if (diffs.length === 0) return { id: record.id };

    const changes = diffs.map((d) => ({
      field: d.field,
      oldValue: d.oldValue,
      newValue: d.newValue,
      actorId: actor.id,
      createdAt: now.toISOString(),
    }));
    const newFile: LocalRecordFile = {
      ...oldFile,
      data: input.dataJson !== undefined ? (JSON.parse(input.dataJson) as unknown) : oldFile.data,
      changes: [...oldFile.changes, ...changes],
      updatedAt: now.toISOString(),
    };
    await updateRecordFile(newFile);
    try {
      await getDb().$transaction([
        getDb().record.update({ where: { id: record.id }, data: updates }),
        getDb().operationLog.create({
          data: {
            actorId: actor.id,
            action: "UPDATE",
            targetType: "RECORD",
            targetId: record.id,
            durationMs: durationMs(),
          },
        }),
      ]);
    } catch (err) {
      // 回滾：檔案寫回舊內容（不殘留半新狀態）
      await updateRecordFile(oldFile);
      throw err;
    }
    return { id: record.id };
  }

  // 非保密：DB 單一 transaction（update + ChangeLog 每欄位 + OperationLog）
  const diffs = diffRecordFields({ ...record, data: record.data as JsonLike }, input);
  if (diffs.length === 0) return { id: record.id };
  await getDb().$transaction([
    getDb().record.update({
      where: { id: record.id },
      data: {
        ...updates,
        ...(input.dataJson !== undefined ? { data: JSON.parse(input.dataJson) } : {}),
      },
    }),
    ...diffs.map((d) =>
      getDb().changeLog.create({
        data: {
          targetId: record.id,
          field: d.field,
          // diff 值為 JSON 安全型別（dataJson schema 已保證非頂層 null）
          oldValue: d.oldValue as unknown as InputJsonValue,
          newValue: d.newValue as unknown as InputJsonValue,
          actorId: actor.id,
        },
      }),
    ),
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "UPDATE",
        targetType: "RECORD",
        targetId: record.id,
        durationMs: durationMs(),
      },
    }),
  ]);
  return { id: record.id };
}

/** 刪除申請（TASK-005）：僅 ADMIN；token 一次性、15 分鐘、只存 sha256 */
export async function requestDelete(
  id: string,
  actor: PermissionActor,
): Promise<{ token: string }> {
  const startedAt = Date.now();
  const record = await getDb().record.findUnique({
    where: { id },
    select: { id: true, authorId: true, isPublic: true, isEditableByOthers: true, isConfidential: true, deletedAt: true },
  });
  if (!record || record.deletedAt || !canDelete(record, actor)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在或無權刪除" });
  }

  const token = randomBytes(32).toString("hex");
  await getDb().deletionRequest.create({
    data: {
      recordId: id,
      requestedBy: actor.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  await logOperationWithDuration(actor, "DELETE_REQUEST", id, startedAt);
  return { token };
}

/** 刪除確認（TASK-005）：token 驗證 → 軟刪除 + （保密）檔案移 .trash */
export async function confirmDelete(
  id: string,
  token: string,
  actor: PermissionActor,
): Promise<{ id: string }> {
  const startedAt = Date.now();
  if (actor.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 Admin 可確認刪除" });
  }
  const request = await getDb().deletionRequest.findFirst({
    where: { recordId: id, approvedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (!request || request.tokenHash !== tokenHash) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "確認連結無效或已過期" });
  }
  const record = await getDb().record.findUnique({
    where: { id },
    select: { id: true, isConfidential: true, deletedAt: true },
  });
  if (!record || record.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在或已在垃圾桶" });
  }

  // 先 DB（核准 + 軟刪除 + OperationLog）→ 後檔案
  await getDb().$transaction([
    getDb().deletionRequest.update({ where: { id: request.id }, data: { approvedAt: new Date() } }),
    getDb().record.update({ where: { id }, data: { deletedAt: new Date() } }),
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "DELETE",
        targetType: "RECORD",
        targetId: id,
        durationMs: Math.round(Date.now() - startedAt),
      },
    }),
  ]);
  if (record.isConfidential) {
    try {
      await moveToTrash(id);
    } catch (err) {
      if (err instanceof LocaldataFileNotFoundError) {
        logger.error("localdata_trash_missing", { recordId: id });
      } else {
        throw err;
      }
    }
  }
  return { id };
}

/** 垃圾桶列表（TASK-005）：僅 ADMIN */
export async function listTrash(actor: PermissionActor): Promise<RecordListItemDTO[]> {
  if (actor.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 Admin 可存取垃圾桶" });
  }
  const rows = await getDb().record.findMany({
    where: { deletedAt: { not: null } },
    select: {
      id: true,
      title: true,
      isPublic: true,
      isConfidential: true,
      authorId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map(toListItem);
}

/** 恢復（TASK-005）：僅 ADMIN；清 deletedAt + （保密）檔案移回主目錄 */
export async function restoreRecord(
  id: string,
  actor: PermissionActor,
): Promise<{ id: string }> {
  if (actor.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 Admin 可恢復資料" });
  }
  const record = await getDb().record.findUnique({
    where: { id },
    select: { id: true, isConfidential: true, deletedAt: true },
  });
  if (!record || !record.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在或不在垃圾桶" });
  }

  await getDb().$transaction([
    getDb().record.update({ where: { id }, data: { deletedAt: null } }),
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "RESTORE",
        targetType: "RECORD",
        targetId: id,
        durationMs: 0,
      },
    }),
  ]);
  if (record.isConfidential) {
    try {
      await restoreFromTrash(id);
    } catch (err) {
      if (err instanceof LocaldataFileNotFoundError) {
        logger.error("localdata_restore_missing", { recordId: id });
      } else {
        throw err;
      }
    }
  }
  return { id };
}

async function logOperationWithDuration(
  actor: PermissionActor,
  action: "DELETE_REQUEST" | "RESTORE" | "DELETE" | "UPDATE",
  targetId: string,
  startedAt: number,
): Promise<void> {
  await getDb().operationLog.create({
    data: {
      actorId: actor.id,
      action,
      targetType: "RECORD",
      targetId,
      durationMs: Math.round(Date.now() - startedAt),
    },
  });
}
