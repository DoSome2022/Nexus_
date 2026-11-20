/**
 * /admin/db 資料庫總覽頁共用純函式（TASK-011）
 * - 每表筆數解析（URL searchParams）、表設定/欄位白名單、cell 格式化
 * - 純函式、無 server-only 依賴（供 RSC 頁面與 service 共用、單元可測）
 */

export const DB_OVERVIEW_LIMITS = [20, 100, 500] as const;
export type DbOverviewLimit = (typeof DB_OVERVIEW_LIMITS)[number];
export const DEFAULT_DB_OVERVIEW_LIMIT: DbOverviewLimit = 20;

export const DB_OVERVIEW_TABLES = [
  "user",
  "record",
  "recordTemplate",
  "recordRelation",
  "operationLog",
  "changeLog",
  "passwordResetToken",
  "deletionRequest",
  "category",
  "recordCategory",
] as const;
export type DbOverviewTableName = (typeof DB_OVERVIEW_TABLES)[number];

export interface DbOverviewTableConfig {
  key: DbOverviewTableName;
  label: string;
  columns: readonly string[];
}

/** 欄位順序固定 */
export const DB_OVERVIEW_TABLE_CONFIG: readonly DbOverviewTableConfig[] = [
  {
    key: "user",
    label: "使用者",
    columns: ["id", "email", "passwordHash", "name", "role", "createdAt", "updatedAt", "deletedAt"],
  },
  {
    key: "record",
    label: "資料記錄",
    // 需求調整（TASK-011 後續）：資料記錄只顯示 title 與 searchContent
    columns: ["title", "searchContent"],
  },
  {
    key: "recordTemplate",
    label: "表單範本",
    columns: ["id", "name", "description", "fields", "createdById", "createdAt", "updatedAt"],
  },
  {
    key: "recordRelation",
    label: "資料關聯",
    columns: ["id", "fromId", "toId", "label", "createdAt"],
  },
  {
    key: "operationLog",
    label: "操作日誌",
    columns: [
      "id",
      "actorId",
      "action",
      "targetType",
      "targetId",
      "durationMs",
      "ip",
      "userAgent",
      "createdAt",
    ],
  },
  {
    key: "changeLog",
    label: "變更日誌",
    columns: ["id", "targetId", "field", "oldValue", "newValue", "actorId", "createdAt"],
  },
  {
    key: "passwordResetToken",
    label: "密碼重設 Token",
    columns: ["id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt"],
  },
  {
    key: "deletionRequest",
    label: "刪除請求",
    columns: [
      "id",
      "recordId",
      "requestedBy",
      "tokenHash",
      "approvedAt",
      "expiresAt",
      "createdAt",
    ],
  },
  {
    key: "category",
    label: "分類",
    columns: ["id", "name", "parentId", "createdById", "createdAt", "updatedAt"],
  },
  {
    key: "recordCategory",
    label: "資料分類連結",
    columns: ["id", "recordId", "categoryId", "createdAt"],
  },
];

/** searchParams 參數名：limit_<modelKey> */
export function dbOverviewLimitParam(table: DbOverviewTableName): string {
  return `limit_${table}`;
}

/**
 * 解析單一筆數參數：精確字串比對（不可用 parseInt——"100abc"/"1e2" 都會被誤判）。
 * 陣列取第一個（重複參數）；其餘一律回落預設 20。
 */
export function parseDbOverviewLimit(value: unknown): DbOverviewLimit {
  if (Array.isArray(value)) return parseDbOverviewLimit(value[0]);
  if (value === "20") return 20;
  if (value === "100") return 100;
  if (value === "500") return 500;
  return DEFAULT_DB_OVERVIEW_LIMIT;
}

export type DbOverviewLimitParams = Record<string, string | string[] | undefined>;

/** 解析全部 8 表的筆數參數；缺漏/非法一律回落 20 */
export function parseDbOverviewLimits(
  params: DbOverviewLimitParams,
): Record<DbOverviewTableName, DbOverviewLimit> {
  const result = {} as Record<DbOverviewTableName, DbOverviewLimit>;
  for (const table of DB_OVERVIEW_TABLES) {
    result[table] = parseDbOverviewLimit(params[dbOverviewLimitParam(table)]);
  }
  return result;
}

export type DbOverviewCellKind = "text" | "json" | "null" | "error";

export interface DbOverviewCell {
  kind: DbOverviewCellKind;
  text: string;
}

/** DB 值 → 顯示 cell；Json 欄位 pretty-print、null 顯示「—」、不可序列化不拋錯 */
export function formatDbCell(value: unknown): DbOverviewCell {
  if (value === null || value === undefined) return { kind: "null", text: "—" };
  if (value instanceof Date) return { kind: "text", text: value.toISOString() };
  if (typeof value === "object") {
    try {
      return { kind: "json", text: JSON.stringify(value, null, 2) };
    } catch {
      return { kind: "json", text: "[unserializable]" };
    }
  }
  return { kind: "text", text: String(value) };
}
