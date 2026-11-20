import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * record-service 單元測試（TASK-003 / TASK-010）
 * mock DB 與 localdata repository：
 * - search 權限兜底過濾（他人私有/保密即使回傳也被剔除）
 * - 保密內容搜尋：讀作者 localdata 檔案、合併排序、損毀跳過
 * - 保密建立：先寫檔 → DB 失敗刪檔回滾
 */
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
  recordCreate: vi.fn(),
  logCreate: vi.fn(),
  transaction: vi.fn(),
  createRecordFile: vi.fn(),
  removeRecordFile: vi.fn(),
  readRecordFile: vi.fn(),
  listCategoryRefs: vi.fn(),
  categoryFindMany: vi.fn(),
  recordCategoryCreate: vi.fn(),
  getCategoryNamePathsByIds: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    record: { findMany: mocks.findMany, findUnique: mocks.findUnique, create: mocks.recordCreate },
    category: { findMany: mocks.categoryFindMany },
    recordCategory: { create: mocks.recordCategoryCreate },
    operationLog: { create: mocks.logCreate },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
  }),
}));

vi.mock("@/server/repositories/localdata-repository", () => ({
  createRecordFile: mocks.createRecordFile,
  removeRecordFile: mocks.removeRecordFile,
  readRecordFile: mocks.readRecordFile,
  LocaldataFileNotFoundError: class extends Error {},
  LocaldataCorruptedFileError: class extends Error {},
}));

// TASK-012：record-service 只依賴 category-query 的批次 refs 查詢（內部邏輯另測）
vi.mock("@/server/services/category-query", () => ({
  listCategoryRefsForRecords: mocks.listCategoryRefs,
  rebuildRecordSearchContent: vi.fn(),
  logRebuildFailure: vi.fn(),
  getCategoryNamePathsByIds: mocks.getCategoryNamePathsByIds,
}));

import { createRecord, searchRecords } from "@/server/services/record-service";
import { logger } from "@/server/lib/logger";
import type { CreateRecordInput } from "@/lib/schemas/record";

const actor = { id: "me", role: "USER" as const };

function row(overrides: Record<string, unknown>) {
  return {
    id: "r1",
    title: "t",
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: false,
    authorId: "other",
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    titleMatches: 0,
    rank: 0,
    searchContent: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops as Promise<unknown>[]) await op;
  });
  // searchRecords 會另查作者保密列，預設無
  mocks.findMany.mockResolvedValue([]);
  mocks.listCategoryRefs.mockResolvedValue(new Map());
  mocks.categoryFindMany.mockResolvedValue([]);
  mocks.recordCategoryCreate.mockResolvedValue({ id: "link1" });
  mocks.getCategoryNamePathsByIds.mockResolvedValue([]);
});

describe("searchRecords 權限兜底", () => {
  it("他人私有/保密資料即使回傳也被剔除；自己的保密保留", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ id: "1", title: "公開", isPublic: true }),
      row({ id: "2", title: "他人私有" }),
      row({ id: "3", title: "他人保密", isConfidential: true }),
      row({ id: "4", title: "我的保密", isConfidential: true, authorId: "me" }),
    ]);

    const result = await searchRecords("x", actor, 50);
    expect(result.map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("列表 DTO 不含 data/schema/searchContent", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ id: "1", isPublic: true, searchContent: "內容文字" }),
    ]);
    const result = await searchRecords("x", actor, 50);
    expect(result[0]).not.toHaveProperty("data");
    expect(result[0]).not.toHaveProperty("schema");
    expect(result[0]).not.toHaveProperty("searchContent");
  });
});

describe("searchRecords 保密內容（TASK-010）", () => {
  it("作者保密檔案內容命中並與 DB 結果合併排序（標題命中優先）", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ id: "db1", title: "普通資料", isPublic: true, rank: 0.2 }),
    ]);
    const confRow = row({
      id: "conf1",
      title: "保密標題",
      isConfidential: true,
      authorId: "me",
      updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    });
    mocks.findMany.mockResolvedValue([confRow]);
    mocks.readRecordFile.mockResolvedValue({ data: { summary: "體檢內容" } });

    // 「保密」命中 conf1 標題 → 標題命中數較高排前
    const result = await searchRecords("體檢 保密", actor, 50);
    expect(result.map((r) => r.id)).toEqual(["conf1", "db1"]);
    // 未開 withSnippet → snippet null
    expect(result[0].snippet).toBeNull();
  });

  it("withSnippet 時產生片段（含保密檔案內容片段）", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([
      row({ id: "conf1", isConfidential: true, authorId: "me" }),
    ]);
    mocks.readRecordFile.mockResolvedValue({ data: { summary: "體檢內容" } });

    const result = await searchRecords("體檢", actor, 50, { withSnippet: true });
    expect(result[0].snippet).toBe("體檢內容");
  });

  it("非作者保密不掃描（canRead 先擋，不讀檔）", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([
      row({ id: "confX", isConfidential: true, authorId: "other" }),
    ]);

    const result = await searchRecords("x", actor, 50);
    expect(mocks.readRecordFile).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it("保密檔案損毀 → 跳過該筆、log error、其餘結果不受影響", async () => {
    mocks.queryRaw.mockResolvedValue([row({ id: "db1", isPublic: true })]);
    mocks.findMany.mockResolvedValue([
      row({ id: "conf1", isConfidential: true, authorId: "me" }),
    ]);
    mocks.readRecordFile.mockRejectedValue(new Error("corrupt"));
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const result = await searchRecords("x", actor, 50);
    expect(result.map((r) => r.id)).toEqual(["db1"]);
    expect(spy).toHaveBeenCalledWith(
      "search_localdata_read_failed",
      expect.objectContaining({ recordId: "conf1" }),
    );
    spy.mockRestore();
  });
});

describe("searchRecords 分類 enrich（TASK-012）", () => {
  it("預設不查分類：categories 為 [] 且不呼叫 helper", async () => {
    mocks.queryRaw.mockResolvedValue([row({ id: "1", isPublic: true })]);
    const result = await searchRecords("x", actor, 50);
    expect(result[0]?.categories).toEqual([]);
    expect(mocks.listCategoryRefs).not.toHaveBeenCalled();
  });

  it("withCategories：slice 後只批次呼叫一次，DTO 附分類 path", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ id: "1", isPublic: true }),
      row({ id: "2", isPublic: true }),
    ]);
    mocks.listCategoryRefs.mockResolvedValue(
      new Map([
        [
          "1",
          [
            { id: "c1", name: "橙", path: "食物 / 水果 / 橙", namePath: ["食物", "水果", "橙"] },
            { id: "c2", name: "維他命", path: "維他命", namePath: ["維他命"] },
          ],
        ],
        ["2", []],
      ]),
    );
    const result = await searchRecords("x", actor, 50, { withCategories: true });
    expect(mocks.listCategoryRefs).toHaveBeenCalledTimes(1);
    expect(mocks.listCategoryRefs).toHaveBeenCalledWith(["1", "2"]);
    expect(result[0]?.categories).toEqual([
      { id: "c1", name: "橙", path: "食物 / 水果 / 橙" },
      { id: "c2", name: "維他命", path: "維他命" },
    ]);
    expect(result[1]?.categories).toEqual([]);
  });
});

describe("createRecord", () => {
  const confidentialInput: CreateRecordInput = {
    title: "機密",
    dataJson: '{"plan":"Q1"}',
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: true,
  };

  it("保密：先寫檔 → DB transaction；DB 失敗刪檔回滾", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(createRecord(confidentialInput, actor)).rejects.toThrow("db down");
    expect(mocks.createRecordFile).toHaveBeenCalledTimes(1);
    expect(mocks.removeRecordFile).toHaveBeenCalledTimes(1);
  });

  it("保密：成功時不刪檔，transaction 含 record + OperationLog", async () => {
    await createRecord(confidentialInput, actor);
    expect(mocks.createRecordFile).toHaveBeenCalledTimes(1);
    expect(mocks.removeRecordFile).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("非保密：不碰 localdata，DB 直接建立", async () => {
    await createRecord(
      { ...confidentialInput, isConfidential: false, isPublic: true },
      actor,
    );
    expect(mocks.createRecordFile).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("非保密建立：DB payload 含 searchContent（TASK-010）", async () => {
    await createRecord(
      { ...confidentialInput, isConfidential: false, isPublic: true },
      actor,
    );
    const payload = mocks.recordCreate.mock.calls[0][0];
    expect(payload.data.searchContent).toContain("Q1");
  });

  it("保密建立：DB payload 不含 searchContent（內容只在 localdata）", async () => {
    await createRecord(confidentialInput, actor);
    const payload = mocks.recordCreate.mock.calls[0][0];
    expect(payload.data).not.toHaveProperty("searchContent");
  });
});

describe("createRecord 分類（TASK-012 後續）", () => {
  const baseInput: CreateRecordInput = {
    title: "機密",
    dataJson: '{"plan":"Q1"}',
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: true,
  };

  it("帶 categoryIds：驗證存在 → transaction 含連結建立 → searchContent 併入分類名", async () => {
    mocks.categoryFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mocks.getCategoryNamePathsByIds.mockResolvedValue([["食物", "水果"], ["食物"]]);
    await createRecord(
      { ...baseInput, isConfidential: false, categoryIds: ["c1", "c2", "c1"] },
      actor,
    );
    // 去重後驗證
    expect(mocks.categoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["c1", "c2"] } } }),
    );
    // transaction 內含兩個連結 create
    expect(mocks.recordCategoryCreate).toHaveBeenCalledTimes(2);
    expect(mocks.recordCategoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "c1" }) }),
    );
    // searchContent 併入分類名
    const payload = mocks.recordCreate.mock.calls[0][0];
    expect(payload.data.searchContent).toContain("水果");
    expect(payload.data.searchContent).toContain("食物");
  });

  it("分類不存在 → BAD_REQUEST，不建立", async () => {
    mocks.categoryFindMany.mockResolvedValue([{ id: "c1" }]); // 缺 c2
    await expect(
      createRecord(
        { ...baseInput, isConfidential: false, categoryIds: ["c1", "c2"] },
        actor,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.recordCreate).not.toHaveBeenCalled();
  });

  it("保密資料帶分類：連結建立但 searchContent 不寫", async () => {
    mocks.categoryFindMany.mockResolvedValue([{ id: "c1" }]);
    mocks.getCategoryNamePathsByIds.mockResolvedValue([["食物"]]);
    await createRecord({ ...baseInput, categoryIds: ["c1"] }, actor);
    expect(mocks.recordCategoryCreate).toHaveBeenCalledTimes(1);
    const payload = mocks.recordCreate.mock.calls[0][0];
    expect(payload.data).not.toHaveProperty("searchContent");
  });
});
