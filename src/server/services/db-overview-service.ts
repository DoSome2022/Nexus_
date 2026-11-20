import { TRPCError } from "@trpc/server";
import { getDb } from "@/server/db";
import { logOperation } from "@/server/audit/operation-log";
import { checkRateLimit } from "@/server/security/rate-limit";
import type { PermissionActor } from "@/server/security/permissions";
import {
  DB_OVERVIEW_TABLE_CONFIG,
  formatDbCell,
  type DbOverviewCell,
  type DbOverviewLimit,
  type DbOverviewTableName,
} from "@/lib/db-overview";

/**
 * /admin/db 資料庫總覽業務邏輯（TASK-011 / TASK-012）
 * - 僅 ADMIN（頁面層已擋，此為防禦深度）；rate limit 10/min/user
 * - 10 張表全欄位顯示（含軟刪除、敏感欄位，刻意不遮罩——需求指定）
 * - record 表依需求只顯示 title 與 searchContent（不含保密檔案內容/tsvector）
 * - 每次成功載入寫一筆 OperationLog(VIEW, DB_OVERVIEW)
 */

export interface DbOverviewTableData {
  key: DbOverviewTableName;
  label: string;
  columns: readonly string[];
  total: number;
  limit: DbOverviewLimit;
  rows: readonly (readonly DbOverviewCell[])[];
}

export interface DbOverviewResult {
  tables: readonly DbOverviewTableData[];
  loadedAt: string;
  durationMs: number;
}

export interface DbOverviewRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const DB_OVERVIEW_TARGET_TYPE = "DB_OVERVIEW";

function assertAdmin(actor: PermissionActor): void {
  if (actor.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 Admin 可檢視資料庫" });
  }
}

/** 依欄位白名單把 DB row 轉成顯示 cell 列 */
function toCells(columns: readonly string[], row: Record<string, unknown>): DbOverviewCell[] {
  return columns.map((col) => formatDbCell(row[col]));
}

type RowLoader = {
  count: () => Promise<number>;
  findMany: () => Promise<Record<string, unknown>[]>;
};

/** 每表載入器：count + findMany（欄位白名單 select、createdAt desc、take 於 findMany 內設定） */
async function plainLoader(
  model: RowLoader,
  columns: readonly string[],
): Promise<{ total: number; rows: DbOverviewCell[][] }> {
  const [total, rows] = await Promise.all([
    model.count(),
    model.findMany().then((rows) => rows.map((row) => toCells(columns, row))),
  ]);
  return { total, rows };
}

export async function getDbOverview(input: {
  actor: PermissionActor;
  limits: Record<DbOverviewTableName, DbOverviewLimit>;
  request?: DbOverviewRequestMeta;
}): Promise<DbOverviewResult> {
  const { actor, limits, request } = input;
  assertAdmin(actor);
  if (!checkRateLimit(`db-overview:${actor.id}`, { limit: 10, windowMs: 60_000 })) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "資料庫總覽請求過於頻繁" });
  }
  const startedAt = Date.now();
  const db = getDb();

  const loaders: Record<DbOverviewTableName, () => Promise<{ total: number; rows: DbOverviewCell[][] }>> = {
    user: () =>
      plainLoader(
        {
          count: () => db.user.count(),
          findMany: () =>
            db.user.findMany({
              select: {
                id: true,
                email: true,
                passwordHash: true,
                name: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.user,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "user")?.columns ?? [],
      ),
    record: () =>
      plainLoader(
        {
          count: () => db.record.count(),
          findMany: () =>
            db.record.findMany({
              select: { title: true, searchContent: true },
              orderBy: { createdAt: "desc" },
              take: limits.record,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "record")?.columns ?? [],
      ),
    recordTemplate: () =>
      plainLoader(
        {
          count: () => db.recordTemplate.count(),
          findMany: () =>
            db.recordTemplate.findMany({
              select: {
                id: true,
                name: true,
                description: true,
                fields: true,
                createdById: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.recordTemplate,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "recordTemplate")?.columns ?? [],
      ),
    recordRelation: () =>
      plainLoader(
        {
          count: () => db.recordRelation.count(),
          findMany: () =>
            db.recordRelation.findMany({
              select: { id: true, fromId: true, toId: true, label: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: limits.recordRelation,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "recordRelation")?.columns ?? [],
      ),
    operationLog: () =>
      plainLoader(
        {
          count: () => db.operationLog.count(),
          findMany: () =>
            db.operationLog.findMany({
              select: {
                id: true,
                actorId: true,
                action: true,
                targetType: true,
                targetId: true,
                durationMs: true,
                ip: true,
                userAgent: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.operationLog,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "operationLog")?.columns ?? [],
      ),
    changeLog: () =>
      plainLoader(
        {
          count: () => db.changeLog.count(),
          findMany: () =>
            db.changeLog.findMany({
              select: {
                id: true,
                targetId: true,
                field: true,
                oldValue: true,
                newValue: true,
                actorId: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.changeLog,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "changeLog")?.columns ?? [],
      ),
    passwordResetToken: () =>
      plainLoader(
        {
          count: () => db.passwordResetToken.count(),
          findMany: () =>
            db.passwordResetToken.findMany({
              select: {
                id: true,
                userId: true,
                tokenHash: true,
                expiresAt: true,
                usedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.passwordResetToken,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "passwordResetToken")?.columns ?? [],
      ),
    deletionRequest: () =>
      plainLoader(
        {
          count: () => db.deletionRequest.count(),
          findMany: () =>
            db.deletionRequest.findMany({
              select: {
                id: true,
                recordId: true,
                requestedBy: true,
                tokenHash: true,
                approvedAt: true,
                expiresAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.deletionRequest,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "deletionRequest")?.columns ?? [],
      ),
    category: () =>
      plainLoader(
        {
          count: () => db.category.count(),
          findMany: () =>
            db.category.findMany({
              select: {
                id: true,
                name: true,
                parentId: true,
                createdById: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: limits.category,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "category")?.columns ?? [],
      ),
    recordCategory: () =>
      plainLoader(
        {
          count: () => db.recordCategory.count(),
          findMany: () =>
            db.recordCategory.findMany({
              select: { id: true, recordId: true, categoryId: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: limits.recordCategory,
            }),
        },
        DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "recordCategory")?.columns ?? [],
      ),
  };

  const tables = await Promise.all(
    DB_OVERVIEW_TABLE_CONFIG.map(async (config) => {
      const { total, rows } = await loaders[config.key]();
      return { key: config.key, label: config.label, columns: config.columns, total, limit: limits[config.key], rows };
    }),
  );

  const durationMs = Math.round(Date.now() - startedAt);
  await logOperation({
    actorId: actor.id,
    action: "VIEW",
    targetType: DB_OVERVIEW_TARGET_TYPE,
    targetId: "all",
    durationMs,
    ip: request?.ip ?? null,
    userAgent: request?.userAgent ?? null,
  });

  return { tables, loadedAt: new Date().toISOString(), durationMs };
}
