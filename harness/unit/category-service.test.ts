import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * category-service 單元測試（TASK-012）
 * - 作者制 CRUD（作者/ADMIN/他人）、per-parent 重名、cycle、刪除阻擋
 * - link/unlink 權限（canEdit/ADMIN、垃圾桶僅 ADMIN）、上限、重複
 * - rename/move 觸發子樹 searchContent 重建；失敗不阻斷
 * - 每次寫入 OperationLog（CATEGORY / RECORD_CATEGORY）
 */
const mocks = vi.hoisted(() => ({
  categoryFindMany: vi.fn(),
  categoryFindFirst: vi.fn(),
  categoryFindUnique: vi.fn(),
  categoryCreate: vi.fn(),
  categoryUpdate: vi.fn(),
  categoryDelete: vi.fn(),
  categoryCount: vi.fn(),
  recordCategoryFindMany: vi.fn(),
  recordCategoryFindFirst: vi.fn(),
  recordCategoryCreate: vi.fn(),
  recordCategoryDelete: vi.fn(),
  recordCategoryDeleteMany: vi.fn(),
  recordCategoryCount: vi.fn(),
  recordFindMany: vi.fn(),
  recordFindUnique: vi.fn(),
  operationLogCreate: vi.fn(),
  transaction: vi.fn(),
  // category-query mocks
  loadCategoryIndex: vi.fn(),
  rebuildRecordSearchContent: vi.fn(),
  rebuildSearchContentForCategorySubtree: vi.fn(),
  logRebuildFailure: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    category: {
      findMany: mocks.categoryFindMany,
      findFirst: mocks.categoryFindFirst,
      findUnique: mocks.categoryFindUnique,
      create: mocks.categoryCreate,
      update: mocks.categoryUpdate,
      delete: mocks.categoryDelete,
      count: mocks.categoryCount,
    },
    recordCategory: {
      findMany: mocks.recordCategoryFindMany,
      findFirst: mocks.recordCategoryFindFirst,
      create: mocks.recordCategoryCreate,
      delete: mocks.recordCategoryDelete,
      deleteMany: mocks.recordCategoryDeleteMany,
      count: mocks.recordCategoryCount,
    },
    record: { findMany: mocks.recordFindMany, findUnique: mocks.recordFindUnique },
    operationLog: { create: mocks.operationLogCreate },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/server/services/category-query", () => ({
  loadCategoryIndex: mocks.loadCategoryIndex,
  rebuildRecordSearchContent: mocks.rebuildRecordSearchContent,
  rebuildSearchContentForCategorySubtree: mocks.rebuildSearchContentForCategorySubtree,
  logRebuildFailure: mocks.logRebuildFailure,
}));

import {
  browseCategory,
  createCategory,
  deleteCategory,
  duplicateCategory,
  linkRecordCategory,
  listCategories,
  unlinkRecordCategory,
  updateCategory,
} from "@/server/services/category-service";
import type { FlatCategory } from "@/lib/category-tree";

const author = { id: "u1", role: "USER" as const };
const other = { id: "u2", role: "USER" as const };
const admin = { id: "admin1", role: "ADMIN" as const };

const INDEX = new Map<string, FlatCategory>([
  ["food", { id: "food", name: "食物", parentId: null }],
  ["fruit", { id: "fruit", name: "水果", parentId: "food" }],
  ["orange", { id: "orange", name: "橙", parentId: "fruit" }],
]);

function categoryRow(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: "食物", parentId: null, createdById: author.id, ...overrides };
}

function recordPermRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    authorId: author.id,
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: false,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCategoryIndex.mockResolvedValue(INDEX);
  mocks.rebuildRecordSearchContent.mockResolvedValue(1);
  mocks.rebuildSearchContentForCategorySubtree.mockResolvedValue(3);
  mocks.categoryFindMany.mockResolvedValue([]);
  mocks.categoryCount.mockResolvedValue(0);
  mocks.recordCategoryCount.mockResolvedValue(0);
  mocks.transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  mocks.operationLogCreate.mockResolvedValue({ id: "log1" });
});

describe("listCategories", () => {
  it("回傳 flat DTO（不含 createdById）", async () => {
    mocks.categoryFindMany.mockResolvedValue([
      { id: "food", name: "食物", parentId: null },
      { id: "fruit", name: "水果", parentId: "food" },
    ]);
    const list = await listCategories();
    expect(list).toEqual([
      { id: "food", name: "食物", parentId: null },
      { id: "fruit", name: "水果", parentId: "food" },
    ]);
  });
});

describe("createCategory", () => {
  it("同層重名 → CONFLICT", async () => {
    mocks.categoryFindFirst.mockResolvedValue({ id: "dup" });
    await expect(createCategory({ name: "食物", parentId: null }, author)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("不同 parent 同名可建立；parentId null 的查詢帶 null（IS NULL 語意）", async () => {
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.categoryCreate.mockResolvedValue({ id: "c1" });
    const result = await createCategory({ name: "食物", parentId: null }, author);
    expect(mocks.categoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "食物", parentId: null } }),
    );
    expect(result).toEqual({ id: "c1" });
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE", targetType: "CATEGORY", targetId: "c1" }),
      }),
    );
  });

  it("上層分類不存在 → BAD_REQUEST", async () => {
    mocks.categoryFindUnique.mockResolvedValue(null);
    await expect(createCategory({ name: "橙", parentId: "missing" }, author)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("updateCategory", () => {
  it("非作者 USER → FORBIDDEN；ADMIN 可改", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    await expect(updateCategory({ id: "fruit", name: "果物" }, other)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    mocks.categoryUpdate.mockResolvedValue({ id: "fruit" });
    await updateCategory({ id: "fruit", name: "果物" }, admin);
    expect(mocks.categoryUpdate).toHaveBeenCalled();
  });

  it("移到自己的子孫下 / 自己 → BAD_REQUEST", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("food"));
    await expect(updateCategory({ id: "food", parentId: "orange" }, author)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(updateCategory({ id: "food", parentId: "food" }, author)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("移到根（parentId: null）成功；根層同名 → CONFLICT", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindFirst.mockResolvedValue({ id: "other-root" });
    await expect(updateCategory({ id: "fruit", parentId: null }, author)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("名稱變更觸發子樹 searchContent 重建；重建失敗 log 後不阻斷", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.categoryUpdate.mockResolvedValue({ id: "fruit" });
    await updateCategory({ id: "fruit", name: "果物" }, author);
    expect(mocks.rebuildSearchContentForCategorySubtree).toHaveBeenCalledWith("fruit");
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "UPDATE", targetType: "CATEGORY", targetId: "fruit" }),
      }),
    );

    vi.clearAllMocks();
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.categoryUpdate.mockResolvedValue({ id: "fruit" });
    mocks.rebuildSearchContentForCategorySubtree.mockRejectedValue(new Error("boom"));
    await updateCategory({ id: "fruit", name: "果物" }, author); // 不 throw
    expect(mocks.logRebuildFailure).toHaveBeenCalled();
  });

  it("只改名稱不變 parent 時，重名檢查用原 parent", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.categoryUpdate.mockResolvedValue({ id: "fruit" });
    await updateCategory({ id: "fruit", name: "果物" }, author);
    expect(mocks.categoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: "果物", parentId: "food", id: { not: "fruit" } },
      }),
    );
  });
});

describe("deleteCategory", () => {
  it("非作者 → FORBIDDEN", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit"));
    await expect(deleteCategory("fruit", other)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("有子分類 → BAD_REQUEST（仍阻擋）", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("food"));
    mocks.categoryCount.mockResolvedValue(1);
    await expect(deleteCategory("food", author)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("有連結（含垃圾桶）→ 自動解除後刪除，回傳 unlinked 數並重建 searchContent", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange"));
    mocks.recordCategoryFindMany.mockResolvedValue([
      { recordId: "r1" },
      { recordId: "r1" },
      { recordId: "r2" },
    ]);
    mocks.recordCategoryDeleteMany.mockResolvedValue({ count: 3 });
    mocks.categoryDelete.mockResolvedValue({ id: "orange" });
    const result = await deleteCategory("orange", author);
    expect(result).toEqual({ id: "orange", unlinked: 3 });
    expect(mocks.recordCategoryDeleteMany).toHaveBeenCalledWith({ where: { categoryId: "orange" } });
    expect(mocks.transaction).toHaveBeenCalled();
    // 去重後重建
    expect(mocks.rebuildRecordSearchContent).toHaveBeenCalledWith(["r1", "r2"]);
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELETE", targetType: "CATEGORY", targetId: "orange" }),
      }),
    );
  });

  it("無連結分類刪除：unlinked 0、不重建", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange"));
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    mocks.recordCategoryDeleteMany.mockResolvedValue({ count: 0 });
    mocks.categoryDelete.mockResolvedValue({ id: "orange" });
    const result = await deleteCategory("orange", author);
    expect(result).toEqual({ id: "orange", unlinked: 0 });
    expect(mocks.rebuildRecordSearchContent).not.toHaveBeenCalled();
  });

  it("重建失敗不阻斷刪除（log 後仍成功）", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange"));
    mocks.recordCategoryFindMany.mockResolvedValue([{ recordId: "r1" }]);
    mocks.recordCategoryDeleteMany.mockResolvedValue({ count: 1 });
    mocks.categoryDelete.mockResolvedValue({ id: "orange" });
    mocks.rebuildRecordSearchContent.mockRejectedValue(new Error("boom"));
    const result = await deleteCategory("orange", author);
    expect(result).toEqual({ id: "orange", unlinked: 1 });
    expect(mocks.logRebuildFailure).toHaveBeenCalled();
  });
});

describe("browseCategory", () => {
  it("不存在 → NOT_FOUND", async () => {
    mocks.categoryFindUnique.mockResolvedValue(null);
    await expect(browseCategory("nope", author)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ancestors（root→parent）、children、可讀 records 過濾、canManage、linkCount", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange", { name: "橙", parentId: "fruit" }));
    mocks.categoryFindMany.mockResolvedValue([{ id: "x", name: "子", parentId: "orange" }]);
    mocks.recordCategoryCount.mockResolvedValue(4);
    mocks.recordFindMany.mockResolvedValue([
      { id: "r1", title: "公開", isPublic: true, isConfidential: false, authorId: "other", updatedAt: new Date() },
      { id: "r2", title: "私有", isPublic: false, isConfidential: false, authorId: "other", updatedAt: new Date() },
      { id: "r3", title: "保密", isPublic: false, isConfidential: true, authorId: "other", updatedAt: new Date() },
    ]);
    const browse = await browseCategory("orange", author);
    expect(browse.category).toEqual({ id: "orange", name: "橙", parentId: "fruit" });
    expect(browse.ancestors.map((c) => c.name)).toEqual(["食物", "水果"]);
    expect(browse.children).toHaveLength(1);
    expect(browse.records.map((r) => r.title)).toEqual(["公開"]); // 私有/他人保密被 canRead 擋下
    expect(browse.canManage).toBe(true); // 作者
    expect(browse.linkCount).toBe(4); // 含垃圾桶
    expect(browse.subtreeCategoryCount).toBe(1); // 橙是葉節點
    expect(browse.subtreeLinkCount).toBe(4); // 同 mock 值
    expect(mocks.recordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          categories: { some: { categoryId: "orange" } },
          OR: [{ isPublic: true }, { authorId: "u1" }],
        }),
        take: 100,
      }),
    );
  });
});

describe("linkRecordCategory", () => {
  it("對不可編輯的他人資料 → NOT_FOUND；ADMIN 可", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordPermRow({ authorId: "other" }));
    mocks.categoryFindUnique.mockResolvedValue({ id: "orange" });
    await expect(linkRecordCategory({ recordId: "r1", categoryId: "orange" }, author)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    mocks.recordCategoryCount.mockResolvedValue(0);
    mocks.recordCategoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryCreate.mockResolvedValue({ id: "l1" });
    await linkRecordCategory({ recordId: "r1", categoryId: "orange" }, admin);
    expect(mocks.recordCategoryCreate).toHaveBeenCalled();
  });

  it("垃圾桶資料僅 ADMIN 可 link", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordPermRow({ deletedAt: new Date() }));
    await expect(linkRecordCategory({ recordId: "r1", categoryId: "orange" }, author)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("分類不存在 → NOT_FOUND；重複 → BAD_REQUEST；超過上限 → BAD_REQUEST", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordPermRow());
    mocks.categoryFindUnique.mockResolvedValue(null);
    await expect(linkRecordCategory({ recordId: "r1", categoryId: "nope" }, author)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    mocks.categoryFindUnique.mockResolvedValue({ id: "orange" });
    mocks.recordCategoryCount.mockResolvedValue(20);
    await expect(linkRecordCategory({ recordId: "r1", categoryId: "orange" }, author)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    mocks.recordCategoryCount.mockResolvedValue(1);
    mocks.recordCategoryFindFirst.mockResolvedValue({ id: "l1" });
    await expect(linkRecordCategory({ recordId: "r1", categoryId: "orange" }, author)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("成功：create + 重建 searchContent + OperationLog(CREATE, RECORD_CATEGORY)", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordPermRow());
    mocks.categoryFindUnique.mockResolvedValue({ id: "orange" });
    mocks.recordCategoryCount.mockResolvedValue(0);
    mocks.recordCategoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryCreate.mockResolvedValue({ id: "l1" });
    const result = await linkRecordCategory({ recordId: "r1", categoryId: "orange" }, author);
    expect(result).toEqual({ id: "l1" });
    expect(mocks.rebuildRecordSearchContent).toHaveBeenCalledWith(["r1"]);
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE", targetType: "RECORD_CATEGORY", targetId: "l1" }),
      }),
    );
  });
});

describe("unlinkRecordCategory", () => {
  it("連結不存在 → NOT_FOUND", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordPermRow());
    mocks.recordCategoryFindFirst.mockResolvedValue(null);
    await expect(
      unlinkRecordCategory({ recordId: "r1", categoryId: "orange" }, author),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("成功：delete + 重建 + OperationLog(DELETE)", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordPermRow());
    mocks.recordCategoryFindFirst.mockResolvedValue({ id: "l1" });
    mocks.recordCategoryDelete.mockResolvedValue({ id: "l1" });
    await unlinkRecordCategory({ recordId: "r1", categoryId: "orange" }, author);
    expect(mocks.rebuildRecordSearchContent).toHaveBeenCalledWith(["r1"]);
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELETE", targetType: "RECORD_CATEGORY", targetId: "l1" }),
      }),
    );
  });
});

describe("duplicateCategory（TASK-013）", () => {
  beforeEach(() => {
    mocks.categoryCreate.mockResolvedValue({ id: "new-id" });
    mocks.recordCategoryCreate.mockResolvedValue({ id: "nl1" });
  });

  it("分類不存在 → NOT_FOUND", async () => {
    mocks.categoryFindUnique.mockResolvedValue(null);
    await expect(duplicateCategory("nope", author)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("葉節點複製：單一節點、(副本) 後綴、同層、createdById=複製者、無連結不重建", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange", { name: "橙", parentId: "fruit" }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "orange", name: "橙", parentId: "fruit" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null); // 無同名衝突
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    const result = await duplicateCategory("orange", author);
    expect(result.name).toBe("橙(副本)");
    expect(result.copiedCategories).toBe(1);
    expect(result.copiedLinks).toBe(0);
    const rootCreate = mocks.categoryCreate.mock.calls[0]?.[0];
    expect(rootCreate.data).toMatchObject({
      name: "橙(副本)",
      parentId: "fruit",
      createdById: author.id,
    });
    expect(result.id).toBe(rootCreate.data.id);
    expect(mocks.rebuildRecordSearchContent).not.toHaveBeenCalled();
  });

  it("子樹複製：子分類 parentId 映射到新 id、原名不變", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "fruit", name: "水果", parentId: "food" },
      { id: "orange", name: "橙", parentId: "fruit" },
      { id: "apple", name: "蘋果", parentId: "fruit" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    const result = await duplicateCategory("fruit", author);
    expect(result.copiedCategories).toBe(3);
    const [root, childA, childB] = mocks.categoryCreate.mock.calls.map((c) => c[0].data);
    expect(root.name).toBe("水果(副本)");
    expect(root.parentId).toBe("food"); // 根複製放原分類同層
    expect(childA.parentId).toBe(root.id); // 子分類指向新根
    expect(childB.parentId).toBe(root.id);
    expect([childA.name, childB.name].sort()).toEqual(["橙", "蘋果"]);
  });

  it("同層已有 (副本) → 根名遞增為 (副本2)", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange", { name: "橙", parentId: "fruit" }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "orange", name: "橙", parentId: "fruit" },
    ]);
    mocks.categoryFindFirst
      .mockResolvedValueOnce({ id: "dup1" }) // 橙(副本) 已存在
      .mockResolvedValue(null); // 橙(副本2) 可用
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    const result = await duplicateCategory("orange", author);
    expect(result.name).toBe("橙(副本2)");
  });

  it("連結複製：子樹內全部映射到新 id；同 record 多連結各自複製；rebuild 去重", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "fruit", name: "水果", parentId: "food" },
      { id: "orange", name: "橙", parentId: "fruit" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([
      { recordId: "r1", categoryId: "fruit" },
      { recordId: "r1", categoryId: "orange" },
      { recordId: "r2", categoryId: "fruit" },
    ]);
    const result = await duplicateCategory("fruit", author);
    expect(result.copiedLinks).toBe(3);
    const rootId = mocks.categoryCreate.mock.calls[0]?.[0].data.id;
    const orangeId = mocks.categoryCreate.mock.calls[1]?.[0].data.id;
    const linkDatas = mocks.recordCategoryCreate.mock.calls.map((c) => c[0].data);
    expect(linkDatas).toContainEqual({ recordId: "r1", categoryId: rootId });
    expect(linkDatas).toContainEqual({ recordId: "r1", categoryId: orangeId });
    expect(linkDatas).toContainEqual({ recordId: "r2", categoryId: rootId });
    // 去重後重建
    expect(mocks.rebuildRecordSearchContent).toHaveBeenCalledWith(["r1", "r2"]);
  });

  it("rebuild 失敗不阻斷複製（log 後仍成功）", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "fruit", name: "水果", parentId: "food" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([{ recordId: "r1", categoryId: "fruit" }]);
    mocks.rebuildRecordSearchContent.mockRejectedValue(new Error("boom"));
    const result = await duplicateCategory("fruit", author);
    expect(result.copiedLinks).toBe(1);
    expect(mocks.logRebuildFailure).toHaveBeenCalled();
  });

  it("OperationLog 兩筆：CATEGORY CREATE + RECORD_CATEGORY CREATE（targetId=新根 id）", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("orange", { name: "橙", parentId: "fruit" }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "orange", name: "橙", parentId: "fruit" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    const result = await duplicateCategory("orange", author);
    expect(mocks.operationLogCreate).toHaveBeenCalledTimes(2);
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE", targetType: "CATEGORY", targetId: result.id }),
      }),
    );
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE", targetType: "RECORD_CATEGORY", targetId: result.id }),
      }),
    );
  });

  it("非作者可複製（人人可複製，不 FORBIDDEN）", async () => {
    mocks.categoryFindUnique.mockResolvedValue(
      categoryRow("fruit", { name: "水果", parentId: "food", createdById: "someone-else" }),
    );
    mocks.categoryFindMany.mockResolvedValue([
      { id: "fruit", name: "水果", parentId: "food" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    const result = await duplicateCategory("fruit", other);
    expect(result.name).toBe("水果(副本)");
    // 新樹建立者是複製者
    expect(mocks.categoryCreate.mock.calls[0]?.[0].data.createdById).toBe(other.id);
  });
});

describe("duplicateCategory 建立順序（FK 回歸）", () => {
  it("findMany 回傳子先父後的亂序 → create 仍依父先子後順序執行", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("fruit", { name: "水果", parentId: "food" }));
    // 刻意反序：子分類在前
    mocks.categoryFindMany.mockResolvedValue([
      { id: "apple", name: "蘋果", parentId: "fruit" },
      { id: "orange", name: "橙", parentId: "fruit" },
      { id: "fruit", name: "水果", parentId: "food" },
    ]);
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    await duplicateCategory("fruit", author);
    const callDatas = mocks.categoryCreate.mock.calls.map((c) => c[0].data);
    // 第一個 create 必須是根（父在子前），且子分類指向根的新 id
    expect(callDatas[0]?.name).toBe("水果(副本)");
    expect(callDatas[0]?.parentId).toBe("food");
    const rootId = callDatas[0]?.id;
    expect(callDatas[1]?.parentId).toBe(rootId);
    expect(callDatas[2]?.parentId).toBe(rootId);
  });

  it("三層亂序 → 依深度 0/1/2 順序建立", async () => {
    mocks.categoryFindUnique.mockResolvedValue(categoryRow("food", { name: "食物", parentId: null }));
    mocks.categoryFindMany.mockResolvedValue([
      { id: "leaf", name: "葉", parentId: "fruit" },
      { id: "food", name: "食物", parentId: null },
      { id: "fruit", name: "水果", parentId: "food" },
    ]);
    // index 需含全部子樹節點（production 的 loadCategoryIndex 載入全表）
    mocks.loadCategoryIndex.mockResolvedValue(
      new Map<string, FlatCategory>([
        ["food", { id: "food", name: "食物", parentId: null }],
        ["fruit", { id: "fruit", name: "水果", parentId: "food" }],
        ["leaf", { id: "leaf", name: "葉", parentId: "fruit" }],
      ]),
    );
    mocks.categoryFindFirst.mockResolvedValue(null);
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    await duplicateCategory("food", author);
    const callDatas = mocks.categoryCreate.mock.calls.map((c) => c[0].data);
    expect(callDatas.map((d) => d.name)).toEqual(["食物(副本)", "水果", "葉"]);
    expect(callDatas[1]?.parentId).toBe(callDatas[0]?.id);
    expect(callDatas[2]?.parentId).toBe(callDatas[1]?.id);
  });
});
