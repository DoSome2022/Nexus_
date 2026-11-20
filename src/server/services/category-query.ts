import { getDb } from "@/server/db";
import { logger } from "@/server/lib/logger";
import { buildSearchContent } from "@/lib/search-text";
import {
  buildCategoryIndex,
  buildCategoryPath,
  getCategoryNamePath,
  getDescendantIds,
  type FlatCategory,
} from "@/lib/category-tree";

/**
 * 分類查詢與 searchContent 索引維護（TASK-012）
 * 獨立於 category-service / record-service，避免循環依賴；也方便測試 mock。
 * 分類是全站小表：path 一律「全表 flat 查詢 + 記憶體計算」，無 N+1、無 recursive CTE。
 */

export interface CategoryRefWithNames {
  id: string;
  name: string;
  path: string;
  /** root → 自身名稱序列（供 searchContent 重建） */
  namePath: string[];
}

/** 載入全部分類（flat） */
export async function loadCategoryIndex(): Promise<Map<string, FlatCategory>> {
  const rows = await getDb().category.findMany({
    select: { id: true, name: true, parentId: true },
  });
  return buildCategoryIndex(rows);
}

/** 依分類 id 取 ancestor namePath（root→self；供 create/update 寫 searchContent） */
export async function getCategoryNamePathsByIds(ids: readonly string[]): Promise<string[][]> {
  if (ids.length === 0) return [];
  const index = await loadCategoryIndex();
  return ids.map((id) => getCategoryNamePath(id, index));
}

/**
 * 批次取得 records 的分類 refs（含 path）：
 * 2 個 flat query（recordCategory + category 全表）；recordIds 空 → 不查 DB 回空 Map
 */
export async function listCategoryRefsForRecords(
  recordIds: readonly string[],
): Promise<Map<string, CategoryRefWithNames[]>> {
  const result = new Map<string, CategoryRefWithNames[]>();
  if (recordIds.length === 0) return result;

  const links = await getDb().recordCategory.findMany({
    where: { recordId: { in: [...recordIds] } },
    select: { recordId: true, categoryId: true },
  });
  const index = await loadCategoryIndex();

  for (const link of links) {
    const refs = result.get(link.recordId) ?? [];
    result.set(link.recordId, refs);
    const cat = index.get(link.categoryId);
    if (!cat) continue; // 連結指向不存在分類：跳過（該 record 仍保留 entry）
    refs.push({
      id: cat.id,
      name: cat.name,
      path: buildCategoryPath(cat.id, index),
      namePath: getCategoryNamePath(cat.id, index),
    });
  }
  return result;
}

/**
 * 重建指定 records 的 searchContent（併入分類 namePath）。
 * 只處理「未刪除且非保密」的 Record（保密 searchContent 恆 NULL，既有 CHECK 約束）；
 * 用 $executeRaw 只改 searchContent，不 bump updatedAt（與 backfill 腳本一致）。
 * 回傳實際更新筆數。
 */
export async function rebuildRecordSearchContent(recordIds: readonly string[]): Promise<number> {
  if (recordIds.length === 0) return 0;
  const refsByRecord = await listCategoryRefsForRecords(recordIds);
  const rows = await getDb().record.findMany({
    where: { id: { in: [...recordIds] }, deletedAt: null, isConfidential: false },
    select: { id: true, title: true, data: true },
  });

  let updated = 0;
  for (const row of rows) {
    const categoryNames = (refsByRecord.get(row.id) ?? []).flatMap((r) => r.namePath);
    const next =
      buildSearchContent(row.title, row.data, categoryNames) || null;
    if (next === null) continue;
    const n = await getDb().$executeRaw`UPDATE "Record" SET "searchContent" = ${next} WHERE "id" = ${row.id}`;
    updated += n;
  }
  return updated;
}

/** 分類 rename/move 後：重建「此節點 + 所有子孫」連結到的非保密資料的 searchContent */
export async function rebuildSearchContentForCategorySubtree(
  categoryId: string,
): Promise<number> {
  const index = await loadCategoryIndex();
  const subtreeIds = getDescendantIds(categoryId, index);
  const links = await getDb().recordCategory.findMany({
    where: { categoryId: { in: subtreeIds } },
    select: { recordId: true },
  });
  const recordIds = [...new Set(links.map((l) => l.recordId))];
  return rebuildRecordSearchContent(recordIds);
}

/** 分類索引重建失敗不阻斷主流程（索引是 derived data）的統一包裝 */
export function logRebuildFailure(context: string, err: unknown): void {
  logger.error("category_search_content_rebuild_failed", {
    context,
    error: err instanceof Error ? err.name : "unknown",
  });
}
