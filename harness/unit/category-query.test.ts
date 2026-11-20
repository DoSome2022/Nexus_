import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * category-query 單元測試（TASK-012）
 * - listCategoryRefsForRecords：2 個 flat query、path 正確、空 ids 不查 DB
 * - rebuildRecordSearchContent：$executeRaw 更新、保密/垃圾桶跳過、不 bump updatedAt
 */
const mocks = vi.hoisted(() => ({
  categoryFindMany: vi.fn(),
  recordCategoryFindMany: vi.fn(),
  recordFindMany: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    category: { findMany: mocks.categoryFindMany },
    recordCategory: { findMany: mocks.recordCategoryFindMany },
    record: { findMany: mocks.recordFindMany },
    $executeRaw: mocks.executeRaw,
  }),
}));

import {
  listCategoryRefsForRecords,
  rebuildRecordSearchContent,
  rebuildSearchContentForCategorySubtree,
} from "@/server/services/category-query";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.categoryFindMany.mockResolvedValue([
    { id: "food", name: "食物", parentId: null },
    { id: "fruit", name: "水果", parentId: "food" },
    { id: "orange", name: "橙", parentId: "fruit" },
  ]);
  mocks.recordCategoryFindMany.mockResolvedValue([]);
  mocks.recordFindMany.mockResolvedValue([]);
  mocks.executeRaw.mockResolvedValue(1);
});

describe("listCategoryRefsForRecords", () => {
  it("空 ids 不查 DB 回空 Map", async () => {
    const refs = await listCategoryRefsForRecords([]);
    expect(refs.size).toBe(0);
    expect(mocks.recordCategoryFindMany).not.toHaveBeenCalled();
    expect(mocks.categoryFindMany).not.toHaveBeenCalled();
  });

  it("多分類 path 正確（root→self）", async () => {
    mocks.recordCategoryFindMany.mockResolvedValue([
      { recordId: "r1", categoryId: "orange" },
      { recordId: "r1", categoryId: "food" },
      { recordId: "r2", categoryId: "fruit" },
    ]);
    const refs = await listCategoryRefsForRecords(["r1", "r2"]);
    expect(refs.get("r1")).toEqual([
      { id: "orange", name: "橙", path: "食物 / 水果 / 橙", namePath: ["食物", "水果", "橙"] },
      { id: "food", name: "食物", path: "食物", namePath: ["食物"] },
    ]);
    expect(refs.get("r2")).toEqual([
      { id: "fruit", name: "水果", path: "食物 / 水果", namePath: ["食物", "水果"] },
    ]);
  });

  it("連結指向不存在分類 → 跳過", async () => {
    mocks.recordCategoryFindMany.mockResolvedValue([{ recordId: "r1", categoryId: "ghost" }]);
    const refs = await listCategoryRefsForRecords(["r1"]);
    expect(refs.get("r1")).toEqual([]);
  });
});

describe("rebuildRecordSearchContent", () => {
  it("只更新非保密未刪除 Record；分類 namePath 併入；$executeRaw 不 bump updatedAt", async () => {
    mocks.recordCategoryFindMany.mockResolvedValue([{ recordId: "r1", categoryId: "fruit" }]);
    mocks.recordFindMany.mockResolvedValue([
      { id: "r1", title: "橙的營養", data: { note: "維他命" } },
    ]);
    const n = await rebuildRecordSearchContent(["r1", "r2"]);
    expect(n).toBe(1);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    // $executeRaw 為 template tag：第一個參數就是 strings 陣列本身
    const strings = mocks.executeRaw.mock.calls[0]?.[0] as string[];
    expect(strings.join(" ")).toContain('UPDATE "Record" SET "searchContent"');
    // 無 record.update 呼叫（不 bump updatedAt）——mock 只有 $executeRaw 可驗證此行為
  });

  it("空 ids 不查 DB 回 0", async () => {
    expect(await rebuildRecordSearchContent([])).toBe(0);
    expect(mocks.recordFindMany).not.toHaveBeenCalled();
  });
});

describe("rebuildSearchContentForCategorySubtree", () => {
  it("取子樹連結 records 後重建（含自己與子孫）", async () => {
    mocks.recordCategoryFindMany.mockResolvedValue([
      { recordId: "r1" },
      { recordId: "r1" },
      { recordId: "r2" },
    ]);
    await rebuildSearchContentForCategorySubtree("fruit");
    // links 查詢以 fruit 子樹（fruit/orange）為條件
    expect(mocks.recordCategoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoryId: { in: expect.arrayContaining(["fruit", "orange"]) } } }),
    );
    // 去重後重建一次
    expect(mocks.recordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["r1", "r2"] } }) }),
    );
  });
});
