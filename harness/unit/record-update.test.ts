import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * record-service 編輯/刪除單元測試（TASK-005）
 * mock DB 與 localdata repository：
 * - diffRecordFields 純函式
 * - 保密更新：DB 失敗 → 檔案回滾舊內容
 * - confirmDelete：無效/過期 token 被拒；有效 → 軟刪除 + moveToTrash
 * - restore：非 Admin 拒絕
 */
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  recordUpdate: vi.fn(),
  changeLogCreate: vi.fn(),
  operationLogCreate: vi.fn(),
  deletionRequestFindFirst: vi.fn(),
  deletionRequestCreate: vi.fn(),
  deletionRequestUpdate: vi.fn(),
  transaction: vi.fn(),
  readRecordFile: vi.fn(),
  updateRecordFile: vi.fn(),
  moveToTrash: vi.fn(),
  restoreFromTrash: vi.fn(),
  listCategoryRefs: vi.fn(),
  rebuildRecordSearchContent: vi.fn(),
  categoryFindMany: vi.fn(),
  recordCategoryFindMany: vi.fn(),
  recordCategoryDeleteMany: vi.fn(),
  recordCategoryCreate: vi.fn(),
  getCategoryNamePathsByIds: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    record: { findUnique: mocks.findUnique, update: mocks.recordUpdate },
    category: { findMany: mocks.categoryFindMany },
    recordCategory: {
      findMany: mocks.recordCategoryFindMany,
      deleteMany: mocks.recordCategoryDeleteMany,
      create: mocks.recordCategoryCreate,
    },
    changeLog: { create: mocks.changeLogCreate },
    operationLog: { create: mocks.operationLogCreate },
    deletionRequest: {
      findFirst: mocks.deletionRequestFindFirst,
      create: mocks.deletionRequestCreate,
      update: mocks.deletionRequestUpdate,
    },
    $transaction: mocks.transaction,
  }),
}));

// TASK-012：update/restore 只依賴 category-query 的分類 refs 與重建（內部邏輯另測）
vi.mock("@/server/services/category-query", () => ({
  listCategoryRefsForRecords: mocks.listCategoryRefs,
  rebuildRecordSearchContent: mocks.rebuildRecordSearchContent,
  logRebuildFailure: vi.fn(),
  getCategoryNamePathsByIds: mocks.getCategoryNamePathsByIds,
}));

vi.mock("@/server/repositories/localdata-repository", () => ({
  createRecordFile: vi.fn(),
  removeRecordFile: vi.fn(),
  readRecordFile: mocks.readRecordFile,
  updateRecordFile: mocks.updateRecordFile,
  moveToTrash: mocks.moveToTrash,
  restoreFromTrash: mocks.restoreFromTrash,
  LocaldataFileNotFoundError: class extends Error {},
  LocaldataCorruptedFileError: class extends Error {},
}));

import {
  confirmDelete,
  diffRecordFields,
  restoreRecord,
  updateRecord,
} from "@/server/services/record-service";
import { buildSearchContent } from "@/lib/search-text";
import type { UpdateRecordInput } from "@/lib/schemas/record";

const author = { id: "me", role: "USER" as const };
const admin = { id: "admin1", role: "ADMIN" as const };

function dbRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    authorId: "me",
    title: "舊標題",
    data: { note: "舊內容" },
    searchContent: null,
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: false,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops as Promise<unknown>[]) await op;
  });
  mocks.listCategoryRefs.mockResolvedValue(new Map());
  mocks.rebuildRecordSearchContent.mockResolvedValue(0);
  mocks.categoryFindMany.mockResolvedValue([]);
  mocks.recordCategoryFindMany.mockResolvedValue([]);
  mocks.recordCategoryDeleteMany.mockResolvedValue({ count: 0 });
  mocks.recordCategoryCreate.mockResolvedValue({ id: "link1" });
  mocks.getCategoryNamePathsByIds.mockResolvedValue([]);
});

describe("diffRecordFields", () => {
  const old = { title: "舊", data: { a: 1 }, isPublic: false, isEditableByOthers: false };

  it("title 變更 → 一筆 diff", () => {
    const diffs = diffRecordFields(old, { id: "r1", title: "新" });
    expect(diffs).toEqual([{ field: "title", oldValue: "舊", newValue: "新" }]);
  });

  it("data JSON 語義相同 → 無 diff（key 順序不同不算變更）", () => {
    const diffs = diffRecordFields(old, { id: "r1", dataJson: '{"a":1}' });
    expect(diffs).toHaveLength(0);
  });

  it("多欄位變更 → 各一筆", () => {
    const input: UpdateRecordInput = {
      id: "r1",
      title: "新標題",
      dataJson: '{"b":2}',
      isPublic: true,
    };
    const diffs = diffRecordFields(old, input);
    expect(diffs.map((d) => d.field)).toEqual(["title", "data", "isPublic"]);
  });
});

describe("updateRecord（保密回滾）", () => {
  const oldFile = {
    version: 1 as const,
    id: "r1",
    authorId: "me",
    schema: {},
    data: { note: "舊內容" },
    changes: [],
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  };

  it("保密：DB 失敗 → 檔案回滾為舊內容", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ isConfidential: true, data: null }));
    mocks.readRecordFile.mockResolvedValue(oldFile);
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));

    await expect(
      updateRecord({ id: "r1", title: "新標題" }, author),
    ).rejects.toThrow("db down");
    // 寫新 + 回滾舊 = 兩次
    expect(mocks.updateRecordFile).toHaveBeenCalledTimes(2);
    expect(mocks.updateRecordFile).toHaveBeenLastCalledWith(oldFile);
  });

  it("保密：成功時 changes 陣列 append ChangeLog、不刪檔", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ isConfidential: true, data: null }));
    mocks.readRecordFile.mockResolvedValue(oldFile);

    await updateRecord({ id: "r1", title: "新標題" }, author);
    expect(mocks.updateRecordFile).toHaveBeenCalledTimes(1);
    const written = mocks.updateRecordFile.mock.calls[0][0];
    expect(written.changes).toHaveLength(1);
    expect(written.changes[0]).toMatchObject({ field: "title", oldValue: "舊標題", newValue: "新標題" });
  });

  it("保密：不可變更可見性", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ isConfidential: true, data: null }));
    mocks.readRecordFile.mockResolvedValue(oldFile);
    await expect(
      updateRecord({ id: "r1", isPublic: true }, author),
    ).rejects.toThrow(/保密資料不可變更可見性/);
  });

  it("非作者編輯 → NOT_FOUND", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ authorId: "other", isPublic: true }));
    await expect(
      updateRecord({ id: "r1", title: "x" }, author),
    ).rejects.toThrow(/無權編輯/);
  });
});

describe("updateRecord（searchContent 重建，TASK-010）", () => {
  it("非保密：data 變更 → update payload 含 searchContent", async () => {
    mocks.findUnique.mockResolvedValue(
      dbRecord({ searchContent: buildSearchContent("舊標題", { note: "舊內容" }) }),
    );
    await updateRecord({ id: "r1", dataJson: '{"note":"新內容"}' }, author);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).toContain("新內容");
  });

  it("非保密：僅 title 變更 → 重建（title 日期衍生詞入 searchContent）", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: null }));
    await updateRecord({ id: "r1", title: "會議 2026-11-02" }, author);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).toContain("11月");
  });

  it("非保密：legacy NULL、內容語義相同 → 補值、不寫 ChangeLog、仍寫 OperationLog", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: null }));
    await updateRecord({ id: "r1", dataJson: '{"note":"舊內容"}' }, author);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).toContain("舊內容");
    expect(mocks.changeLogCreate).not.toHaveBeenCalled();
    expect(mocks.operationLogCreate).toHaveBeenCalledTimes(1);
  });

  it("非保密：無變更且 searchContent 已是最新 → 不寫任何東西", async () => {
    mocks.findUnique.mockResolvedValue(
      dbRecord({ searchContent: buildSearchContent("舊標題", { note: "舊內容" }) }),
    );
    await updateRecord({ id: "r1", dataJson: '{"note":"舊內容"}' }, author);
    expect(mocks.recordUpdate).not.toHaveBeenCalled();
    expect(mocks.operationLogCreate).not.toHaveBeenCalled();
  });

  it("保密：update payload 不含 searchContent", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ isConfidential: true, data: null }));
    mocks.readRecordFile.mockResolvedValue({
      version: 1 as const,
      id: "r1",
      authorId: "me",
      schema: {},
      data: { note: "舊內容" },
      changes: [],
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    await updateRecord({ id: "r1", title: "新標題" }, author);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty("searchContent");
  });

  it("非保密：重建時併入目前分類 namePath（TASK-012，避免編輯洗掉分類名）", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: null }));
    mocks.listCategoryRefs.mockResolvedValue(
      new Map([
        ["r1", [{ id: "c1", name: "橙", path: "食物 / 水果 / 橙", namePath: ["食物", "水果", "橙"] }]],
      ]),
    );
    await updateRecord({ id: "r1", title: "新標題" }, author);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).toContain("食物");
    expect(updateArg.data.searchContent).toContain("水果");
    expect(updateArg.data.searchContent).toContain("橙");
  });

  it("非保密：無分類時 searchContent 與舊版一致", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: null }));
    await updateRecord({ id: "r1", title: "新標題" }, author);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).toBe(buildSearchContent("新標題", { note: "舊內容" }));
  });
});

describe("confirmDelete（token 驗證）", () => {
  it("無效 token → BAD_REQUEST", async () => {
    mocks.deletionRequestFindFirst.mockResolvedValue(null);
    await expect(confirmDelete("r1", "bad-token", admin)).rejects.toThrow(/無效或已過期/);
  });

  it("有效 token → 軟刪除 + 保密檔案移 .trash", async () => {
    const { createHash } = await import("node:crypto");
    const token = "secret-token";
    mocks.deletionRequestFindFirst.mockResolvedValue({
      id: "dr1",
      tokenHash: createHash("sha256").update(token).digest("hex"),
    });
    mocks.findUnique.mockResolvedValue({ id: "r1", isConfidential: true, deletedAt: null });

    await confirmDelete("r1", token, admin);
    expect(mocks.recordUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mocks.moveToTrash).toHaveBeenCalledWith("r1");
  });

  it("非 Admin → FORBIDDEN", async () => {
    await expect(confirmDelete("r1", "t", { id: "me", role: "USER" })).rejects.toThrow(
      /只有 Admin/,
    );
  });
});

describe("restoreRecord", () => {
  it("非 Admin → FORBIDDEN", async () => {
    await expect(restoreRecord("r1", author)).rejects.toThrow(/只有 Admin/);
  });

  it("Admin 恢復保密資料：清 deletedAt + 檔案移回", async () => {
    mocks.findUnique.mockResolvedValue({ id: "r1", isConfidential: true, deletedAt: new Date() });
    await restoreRecord("r1", admin);
    expect(mocks.recordUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { deletedAt: null },
    });
    expect(mocks.restoreFromTrash).toHaveBeenCalledWith("r1");
    expect(mocks.rebuildRecordSearchContent).not.toHaveBeenCalled();
  });

  it("Admin 恢復非保密資料：rebuild searchContent（TASK-012）", async () => {
    mocks.findUnique.mockResolvedValue({ id: "r1", isConfidential: false, deletedAt: new Date() });
    await restoreRecord("r1", admin);
    expect(mocks.rebuildRecordSearchContent).toHaveBeenCalledWith(["r1"]);
  });
});

describe("updateRecord 分類取代（TASK-012 後續）", () => {
  it("categoryIds 變更 → 取代整組連結 + searchContent 用新名稱 + RECORD_CATEGORY UPDATE log", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: null }));
    mocks.recordCategoryFindMany.mockResolvedValue([{ categoryId: "old1" }]);
    mocks.categoryFindMany.mockResolvedValue([{ id: "new1" }, { id: "new2" }]);
    mocks.getCategoryNamePathsByIds.mockResolvedValue([["食物", "水果"], ["食物"]]);
    await updateRecord({ id: "r1", categoryIds: ["new1", "new2"] }, author);
    expect(mocks.recordCategoryDeleteMany).toHaveBeenCalledWith({ where: { recordId: "r1" } });
    expect(mocks.recordCategoryCreate).toHaveBeenCalledTimes(2);
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).toContain("水果");
    expect(mocks.operationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE",
          targetType: "RECORD_CATEGORY",
          targetId: "r1",
        }),
      }),
    );
  });

  it("categoryIds 與現況相同 → 不動作（無 deleteMany/create）", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: "舊" }));
    mocks.recordCategoryFindMany.mockResolvedValue([{ categoryId: "c1" }]);
    await updateRecord({ id: "r1", categoryIds: ["c1"] }, author);
    expect(mocks.recordCategoryDeleteMany).not.toHaveBeenCalled();
    expect(mocks.recordCategoryCreate).not.toHaveBeenCalled();
    expect(mocks.operationLogCreate).not.toHaveBeenCalled();
  });

  it("所選分類不存在 → BAD_REQUEST", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: null }));
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    mocks.categoryFindMany.mockResolvedValue([{ id: "c1" }]); // 缺 c2
    await expect(
      updateRecord({ id: "r1", categoryIds: ["c1", "c2"] }, author),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.recordUpdate).not.toHaveBeenCalled();
  });

  it("只改分類（無其他欄位）→ 正常執行、清空分類也合法", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ searchContent: "含 舊分類 的索引" }));
    mocks.recordCategoryFindMany.mockResolvedValue([{ categoryId: "c1" }]);
    await updateRecord({ id: "r1", categoryIds: [] }, author);
    expect(mocks.recordCategoryDeleteMany).toHaveBeenCalledWith({ where: { recordId: "r1" } });
    expect(mocks.recordCategoryCreate).not.toHaveBeenCalled();
    // searchContent 移除舊分類名
    const updateArg = mocks.recordUpdate.mock.calls[0][0];
    expect(updateArg.data.searchContent).not.toContain("舊分類");
  });

  it("保密資料分類取代：連結更新、不寫 searchContent", async () => {
    mocks.findUnique.mockResolvedValue(dbRecord({ isConfidential: true, data: null }));
    mocks.readRecordFile.mockResolvedValue({
      version: 1 as const,
      id: "r1",
      authorId: "me",
      schema: {},
      data: { note: "舊內容" },
      changes: [],
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    mocks.recordCategoryFindMany.mockResolvedValue([]);
    mocks.categoryFindMany.mockResolvedValue([{ id: "c1" }]);
    await updateRecord({ id: "r1", categoryIds: ["c1"] }, author);
    expect(mocks.recordCategoryCreate).toHaveBeenCalledTimes(1);
    const updateArg = mocks.recordUpdate.mock.calls[0]?.[0];
    expect(updateArg?.data ?? {}).not.toHaveProperty("searchContent");
  });
});
