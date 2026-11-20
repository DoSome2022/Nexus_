import { createHash, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import { Prisma } from "@/generated/prisma/client";
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
import { getCategoryNamePathsByIds, listCategoryRefsForRecords, logRebuildFailure, rebuildRecordSearchContent } from "@/server/services/category-query";
import type { CreateRecordInput, UpdateRecordInput } from "@/lib/schemas/record";
import { templateFieldSchema } from "@/lib/schemas/template";
import {
  buildRecordTemplateSnapshot,
  parseRecordTemplateSnapshot,
  schemaMatchesData,
  type RecordTemplateSnapshot,
} from "@/lib/template-data";
import {
  findTitleMentions,
  type RelationSuggestionDTO,
} from "@/lib/relation-suggest";
import {
  buildDisplayText,
  buildSearchContent,
  countTitleMatches,
  escapeLikePattern,
  getDisplayText,
  makeSnippet,
  matchesAllTerms,
  tokenizeQuery,
} from "@/lib/search-text";

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

/** 分類 ref（TASK-012）：path 為「食物 / 水果 / 橙」格式（含祖先） */
export interface CategoryRefDTO {
  id: string;
  name: string;
  path: string;
}

/** 搜尋結果 DTO（TASK-010）：snippet 為命中片段（withSnippet 時才有，經 canRead 過濾後產生） */
export interface RecordSearchResultDTO extends RecordListItemDTO {
  snippet: string | null;
  /** 分類 refs（TASK-012；withCategories=false 時為 []） */
  categories: CategoryRefDTO[];
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
  /** 分類 refs（TASK-012；withCategories=false 時為 []） */
  categories: CategoryRefDTO[];
  /** 共享任一分類的其他可讀資料（排除自己，上限 20） */
  categorySiblings: RecordListItemDTO[];
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
  const schema = await resolveCreateSchema(input.templateId, data, actor.id);

  const commonData = {
    id,
    authorId: actor.id,
    title: input.title,
    isPublic: input.isPublic,
    isEditableByOthers: input.isEditableByOthers,
    isConfidential: input.isConfidential,
  };

  // TASK-012 後續：建立時的分類連結（去重、驗證存在）
  const categoryIds = [...new Set(input.categoryIds ?? [])];
  let categoryNames: string[] = [];
  if (categoryIds.length > 0) {
    const found = await getDb().category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true },
    });
    if (found.length !== categoryIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "所選分類不存在" });
    }
    categoryNames = (await getCategoryNamePathsByIds(categoryIds)).flat();
  }
  const linkCreates = categoryIds.map((categoryId) =>
    getDb().recordCategory.create({ data: { recordId: id, categoryId } }),
  );

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
        ...linkCreates,
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
    // TASK-010：非保密資料寫入內容索引文字（保密資料不寫 → DB NULL，CHECK 約束把關）；
    // TASK-012 後續：分類 ancestor namePath 併入索引（搜「水果」可命中「橙」的資料）
    const searchContent = buildSearchContent(input.title, data, categoryNames) || null;
    await getDb().$transaction([
      getDb().record.create({
        data: { ...commonData, schema: schema as unknown as InputJsonValue, data, searchContent },
      }),
      ...linkCreates,
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

/**
 * 建立時的 schema 決定（TASK-008）：
 * - 有 templateId → 讀範本、驗證資料相符 → 回 snapshot（範本刪除/損壞 → BAD_REQUEST）
 * - 無 templateId → 空物件（自由 JSON，沿用 TASK-003 行為）
 */
async function resolveCreateSchema(
  templateId: string | undefined,
  data: unknown,
  actorId: string,
): Promise<RecordTemplateSnapshot | Record<string, never>> {
  if (!templateId) return {};

  const template = await getDb().recordTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, fields: true },
  });
  if (!template) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "所選範本不存在" });
  }
  const parsedFields = templateFieldSchema.array().safeParse(template.fields);
  if (!parsedFields.success) {
    logger.error("template_corrupt_fields", { templateId: template.id });
    throw new TRPCError({ code: "BAD_REQUEST", message: "範本欄位定義異常，請聯絡管理員" });
  }
  const snapshot = buildRecordTemplateSnapshot({
    name: template.name,
    fields: parsedFields.data,
  });
  // 防繞：服務端驗證資料符合範本（必填/型別/未知欄位），不信任 client 序列化
  if (!schemaMatchesData(snapshot, data)) {
    logger.warn("record_create_template_mismatch", { templateId: template.id, actorId });
    throw new TRPCError({ code: "BAD_REQUEST", message: "資料內容不符合所選範本（必填欄位或型別不符）" });
  }
  return snapshot;
}

/** searchRecords 的 raw query 回傳列（TASK-010） */
interface SearchRow {
  id: string;
  title: string;
  isPublic: boolean;
  isEditableByOthers: boolean;
  isConfidential: boolean;
  authorId: string;
  updatedAt: Date;
  titleMatches: number;
  rank: number;
  searchContent: string | null;
}

export interface SearchOptions {
  /** 結果附命中片段（結果頁用；下拉建議不需 → 省成本） */
  withSnippet?: boolean;
  /** 結果附分類路徑（結果頁用；熱路徑下拉不需 → 省 2 個查詢，TASK-012） */
  withCategories?: boolean;
}

/** 合併排序用的候選列（DB 非保密 + 保密檔案掃描） */
interface SearchCandidate {
  row: {
    id: string;
    title: string;
    isPublic: boolean;
    isEditableByOthers: boolean;
    isConfidential: boolean;
    authorId: string;
    updatedAt: Date;
  };
  /** 命中標題的詞數（排序訊號：標題命中 > 內容命中） */
  titleMatches: number;
  /** ts_rank（保密檔案無 DB 向量 → 0） */
  rank: number;
  /** snippet 來源：非保密 = searchContent 顯示段；保密 = 檔案 data 顯示段 */
  searchContent: string | null;
}

function compareCandidates(a: SearchCandidate, b: SearchCandidate): number {
  if (b.titleMatches !== a.titleMatches) return b.titleMatches - a.titleMatches;
  if (b.rank !== a.rank) return b.rank - a.rank;
  const byUpdated = b.row.updatedAt.getTime() - a.row.updatedAt.getTime();
  if (byUpdated !== 0) return byUpdated;
  return a.row.id.localeCompare(b.row.id);
}

/**
 * 全欄位搜尋（TASK-010）：
 * - 查詢切詞（空白、去重、上限 10）、每詞 AND（Google 式：越多關鍵字越精確）
 * - 非保密：SQL 每詞（title ILIKE OR searchContent ILIKE OR 同義詞向量）；ILIKE 用 ESCAPE 防萬用字注入
 * - 保密：作者自己的列讀 localdata 檔案做 JS 比對（內容不進 DB，TASK-004 底線）
 * - 排序：命中標題詞數 → ts_rank → updatedAt；canRead 兜底
 */
export async function searchRecords(
  q: string,
  actor: PermissionActor,
  limit: number,
  options: SearchOptions = {},
): Promise<RecordSearchResultDTO[]> {
  const terms = tokenizeQuery(q);
  if (terms.length === 0) return [];

  const withSnippet = options.withSnippet === true;
  const withCategories = options.withCategories === true;
  const likeOf = (term: string) => `%${escapeLikePattern(term)}%`;

  // Prisma.sql / Prisma.join 只組固定片段；term/pattern 一律參數化
  const termConditions = terms.map(
    (term) => Prisma.sql`(
      "title" ILIKE ${likeOf(term)} ESCAPE '\\'
      OR "searchContent" ILIKE ${likeOf(term)} ESCAPE '\\'
      OR "searchVector" @@ plainto_tsquery('nexus_zh', ${term})
    )`,
  );
  const titleMatchesExpr = Prisma.join(
    terms.map(
      (term) => Prisma.sql`(CASE WHEN "title" ILIKE ${likeOf(term)} ESCAPE '\\' THEN 1 ELSE 0 END)`,
    ),
    " + ",
  );
  const contentSelect = withSnippet ? Prisma.sql`"searchContent"` : Prisma.sql`NULL::text`;

  const query = Prisma.sql`
    SELECT "id", "title", "isPublic", "isEditableByOthers", "isConfidential",
           "authorId", "updatedAt",
           (${titleMatchesExpr}) AS "titleMatches",
           ts_rank("searchVector", plainto_tsquery('nexus_zh', ${q}))::float8 AS "rank",
           ${contentSelect} AS "searchContent"
    FROM "Record"
    WHERE "deletedAt" IS NULL
      AND "isConfidential" = false
      AND ("isPublic" = true OR "authorId" = ${actor.id})
      AND (${Prisma.join(termConditions, " AND ")})
    ORDER BY "titleMatches" DESC, "rank" DESC, "updatedAt" DESC
    LIMIT ${limit}
  `;
  const rows = await getDb().$queryRaw<SearchRow[]>(query);

  // 保密資料：內容在 localdata（不進 DB），作者自己的列讀檔做同套 extractor 比對
  const ownConfidential = await getDb().record.findMany({
    where: { deletedAt: null, authorId: actor.id, isConfidential: true },
    select: {
      id: true,
      title: true,
      isPublic: true,
      isEditableByOthers: true,
      isConfidential: true,
      authorId: true,
      updatedAt: true,
    },
  });
  const confidentialCandidates = (
    await Promise.all(
      ownConfidential.map(async (row): Promise<SearchCandidate | null> => {
        if (!canRead(row, actor)) return null;
        try {
          const file = await readRecordFile(row.id);
          const indexText = buildSearchContent(row.title, file.data);
          if (!matchesAllTerms(row.title, indexText, terms)) return null;
          return {
            row,
            titleMatches: countTitleMatches(terms, row.title),
            rank: 0,
            searchContent: withSnippet ? buildDisplayText(file.data) : null,
          };
        } catch (err) {
          // 檔案遺失/損毀：跳過該筆，不中斷整個搜尋（不印內容/路徑）
          logger.error("search_localdata_read_failed", {
            recordId: row.id,
            error: err instanceof Error ? err.name : "unknown",
          });
          return null;
        }
      }),
    )
  ).filter((c): c is SearchCandidate => c !== null);

  // 兜底：SQL 已過濾，此處再跑 canRead 純函式（防禦性，見 CLAUDE.security.md）
  const dbCandidates: SearchCandidate[] = rows
    .filter((r) => canRead(r, actor))
    .map((r) => ({
      row: r,
      titleMatches: r.titleMatches,
      rank: r.rank,
      searchContent: withSnippet ? getDisplayText(r.searchContent) : null,
    }));

  // 合併（SQL 已排除保密，Map 去重為防禦）→ 排序 → slice → 最後才做 snippet / 分類 enrich
  const merged = new Map<string, SearchCandidate>();
  for (const c of [...dbCandidates, ...confidentialCandidates]) {
    if (!merged.has(c.row.id)) merged.set(c.row.id, c);
  }
  const sorted = [...merged.values()].sort(compareCandidates).slice(0, limit);
  const refsByRecord = withCategories
    ? await listCategoryRefsForRecords(sorted.map((c) => c.row.id))
    : null;
  return sorted.map((c) => ({
    ...toListItem(c.row),
    snippet: withSnippet && c.searchContent ? makeSnippet(c.searchContent, terms) : null,
    categories: (refsByRecord?.get(c.row.id) ?? []).map((r) => ({ id: r.id, name: r.name, path: r.path })),
  }));
}

export interface GetRecordOptions {
  /** 附分類 refs 與同分類資料（TASK-012；suggestRelations 等內部呼叫可關閉省查詢） */
  withCategories?: boolean;
}

export async function getRecord(
  id: string,
  actor: PermissionActor,
  options: GetRecordOptions = {},
): Promise<RecordDetailDTO> {
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

  // TASK-012：分類 refs（含祖先 path）與同分類可讀資料
  const withCategories = options.withCategories !== false;
  let categories: CategoryRefDTO[] = [];
  let categorySiblings: RecordListItemDTO[] = [];
  if (withCategories) {
    const refs = (await listCategoryRefsForRecords([record.id])).get(record.id) ?? [];
    categories = refs.map((r) => ({ id: r.id, name: r.name, path: r.path }));
    const categoryIds = refs.map((r) => r.id);
    if (categoryIds.length > 0) {
      const rows = await getDb().record.findMany({
        where: {
          id: { not: record.id },
          deletedAt: null,
          categories: { some: { categoryId: { in: categoryIds } } },
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
        take: 20,
      });
      categorySiblings = rows.filter((r) => canRead(r, actor)).map(toListItem);
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
    categories,
    categorySiblings,
  };
}

/** 候選標題查詢（TASK-009）：只取權限欄位與標題，絕不讀 data/schema（防洩漏與無謂 IO） */
const TITLE_CANDIDATE_SELECT = {
  id: true,
  title: true,
  authorId: true,
  isPublic: true,
  isEditableByOthers: true,
  isConfidential: true,
} as const;

/** 可讀記錄的標題清單（SQL 先過公開/作者，canRead 兜底；上限 500 筆） */
async function listReadableTitles(actor: PermissionActor): Promise<RelationSuggestionDTO[]> {
  const rows = await getDb().record.findMany({
    where: {
      deletedAt: null,
      OR: [{ isPublic: true }, { authorId: actor.id }],
    },
    select: TITLE_CANDIDATE_SELECT,
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows
    .filter((r) => canRead(r, actor))
    .map((r) => ({ id: r.id, title: r.title, isConfidential: r.isConfidential }));
}

/**
 * 關聯建議（TASK-009）：掃描記錄標題 + data 中提及的其他可讀記錄標題
 * - 被檢視記錄不可讀 → getRecord 拋 NOT_FOUND（不洩漏存在性）
 * - 排除自己與已關聯（雙向，直接重用 getRecord DTO 內的 relations，不多查一次）
 * - 只建議、不自動建立（加入走 relation.create）
 */
export async function suggestRelations(
  id: string,
  actor: PermissionActor,
): Promise<RelationSuggestionDTO[]> {
  // 建議不需分類資訊（省 2 個查詢；TASK-012）
  const record = await getRecord(id, actor, { withCategories: false });
  const excludeIds = new Set([id, ...record.relations.map((r) => r.related.id)]);
  const candidates = await listReadableTitles(actor);
  return findTitleMentions(record.title, record.data, candidates, excludeIds);
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

/**
 * TASK-008 防繞：原本與範本 snapshot 相符的紀錄，新資料也必須相符
 * （表單模式 UI 恒序列化相符資料；此處擋直接打 API 把友善表單紀錄改壞）
 * 原本已不相符的紀錄不擋（避免卡死 legacy/被改過的資料）
 */
function assertDataStillMatchesSchema(
  schema: unknown,
  oldData: unknown,
  newData: unknown,
): void {
  const snapshot = parseRecordTemplateSnapshot(schema);
  if (!snapshot) return;
  if (!schemaMatchesData(snapshot, oldData)) return;
  if (!schemaMatchesData(snapshot, newData)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "資料內容不符合原範本格式（必填欄位或型別不符）" });
  }
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
      schema: true,
      data: true,
      searchContent: true,
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

  // TASK-012 後續：編輯表單「取代整組」分類連結（去重；與現況相同則不動作）
  // 連結 ops 於 transaction 呼叫處內聯展開（保持 PrismaPromise 型別推斷）
  let categoryReplace: { newIds: string[] } | null = null;
  let nextCategoryNames: string[] | null = null;
  if (input.categoryIds !== undefined) {
    const newIds = [...new Set(input.categoryIds)];
    const existing = await getDb().recordCategory.findMany({
      where: { recordId: record.id },
      select: { categoryId: true },
    });
    const oldIds = existing.map((l) => l.categoryId).sort();
    const changed = JSON.stringify(oldIds) !== JSON.stringify([...newIds].sort());
    if (changed) {
      if (newIds.length > 0) {
        const found = await getDb().category.findMany({
          where: { id: { in: newIds } },
          select: { id: true },
        });
        if (found.length !== newIds.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "所選分類不存在" });
        }
        nextCategoryNames = (await getCategoryNamePathsByIds(newIds)).flat();
      }
      categoryReplace = { newIds };
    }
  }
  const categoryLogCreate = (targetId: string) =>
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "UPDATE",
        targetType: "RECORD_CATEGORY",
        targetId,
        durationMs: durationMs(),
      },
    });

  if (record.isConfidential) {
    // 舊值以檔案內容為準（DB data 為 NULL）
    const oldFile = await readRecordFile(record.id);
    if (input.dataJson !== undefined) {
      assertDataStillMatchesSchema(oldFile.schema, oldFile.data, JSON.parse(input.dataJson));
    }
    const diffs = diffRecordFields(
      { ...record, data: oldFile.data as JsonLike },
      input,
    );
    if (diffs.length === 0 && !categoryReplace) return { id: record.id };

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
    if (diffs.length > 0) {
      await updateRecordFile(newFile);
    }
    try {
      await getDb().$transaction([
        ...(diffs.length > 0
          ? [getDb().record.update({ where: { id: record.id }, data: updates })]
          : []),
        ...(categoryReplace
          ? [
              getDb().recordCategory.deleteMany({ where: { recordId: record.id } }),
              ...categoryReplace.newIds.map((categoryId) =>
                getDb().recordCategory.create({ data: { recordId: record.id, categoryId } }),
              ),
            ]
          : []),
        getDb().operationLog.create({
          data: {
            actorId: actor.id,
            action: "UPDATE",
            targetType: "RECORD",
            targetId: record.id,
            durationMs: durationMs(),
          },
        }),
        ...(categoryReplace ? [categoryLogCreate(record.id)] : []),
      ]);
    } catch (err) {
      // 回滾：檔案寫回舊內容（不殘留半新狀態）
      if (diffs.length > 0) {
        await updateRecordFile(oldFile);
      }
      throw err;
    }
    return { id: record.id };
  }

  // 非保密：DB 單一 transaction（update + ChangeLog 每欄位 + OperationLog）
  if (input.dataJson !== undefined) {
    assertDataStillMatchesSchema(record.schema, record.data, JSON.parse(input.dataJson));
  }
  // TASK-010：標題/資料變更時重建內容索引文字（title 日期衍生詞也在 searchContent 內）；
  // legacy NULL 一併補值（derived 欄位不寫 ChangeLog）
  // TASK-012：重建時併入目前分類的 namePath，避免編輯把分類名從索引洗掉；
  //   分類整組取代時用新集合的 namePath
  const nextData = input.dataJson !== undefined ? JSON.parse(input.dataJson) : record.data;
  const rebuildSearch =
    input.title !== undefined ||
    input.dataJson !== undefined ||
    record.searchContent === null ||
    categoryReplace !== null;
  const nextSearchContent = rebuildSearch
    ? (buildSearchContent(
        input.title ?? record.title,
        nextData,
        categoryReplace
          ? (nextCategoryNames ?? [])
          : await listCategoryRefsForRecords([record.id]).then(
              (refs) => (refs.get(record.id) ?? []).flatMap((r) => r.namePath),
            ),
      ) || null)
    : record.searchContent;
  const searchContentChanged = nextSearchContent !== record.searchContent;
  const diffs = diffRecordFields({ ...record, data: record.data as JsonLike }, input);
  if (diffs.length === 0 && !searchContentChanged && !categoryReplace) return { id: record.id };
  await getDb().$transaction([
    getDb().record.update({
      where: { id: record.id },
      data: {
        ...updates,
        ...(input.dataJson !== undefined ? { data: JSON.parse(input.dataJson) } : {}),
        ...(searchContentChanged ? { searchContent: nextSearchContent } : {}),
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
    ...(categoryReplace
      ? [
          getDb().recordCategory.deleteMany({ where: { recordId: record.id } }),
          ...categoryReplace.newIds.map((categoryId) =>
            getDb().recordCategory.create({ data: { recordId: record.id, categoryId } }),
          ),
        ]
      : []),
    getDb().operationLog.create({
      data: {
        actorId: actor.id,
        action: "UPDATE",
        targetType: "RECORD",
        targetId: record.id,
        durationMs: durationMs(),
      },
    }),
    ...(categoryReplace ? [categoryLogCreate(record.id)] : []),
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
  } else {
    // TASK-012：非保密資料 restore 後重建 searchContent（垃圾桶期間分類可能已改名/移動）
    try {
      await rebuildRecordSearchContent([id]);
    } catch (err) {
      logRebuildFailure(`restore record ${id}`, err);
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
