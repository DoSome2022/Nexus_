import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * relation-service 單元測試（TASK-007）
 * - create：兩端 canRead、自關聯/重複拒絕
 * - delete：任一端 canEdit 或 Admin；無權 NOT_FOUND
 * - list：過濾另一端不可讀/已刪除
 */
const mocks = vi.hoisted(() => ({
  recordFindMany: vi.fn(),
  relationFindFirst: vi.fn(),
  relationFindUnique: vi.fn(),
  relationFindMany: vi.fn(),
  relationCreate: vi.fn(),
  relationDelete: vi.fn(),
  operationLogCreate: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    record: { findMany: mocks.recordFindMany },
    recordRelation: {
      findFirst: mocks.relationFindFirst,
      findUnique: mocks.relationFindUnique,
      findMany: mocks.relationFindMany,
      create: mocks.relationCreate,
      delete: mocks.relationDelete,
    },
    operationLog: { create: mocks.operationLogCreate },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  }),
}));

import {
  createRelation,
  deleteRelation,
  listRelationsForRecord,
} from "@/server/services/relation-service";

const author = { id: "me", role: "USER" as const };
const admin = { id: "admin1", role: "ADMIN" as const };

function permRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    authorId: "me",
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: false,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createRelation", () => {
  it("自關聯被拒", async () => {
    await expect(
      createRelation({ fromId: "r1", toId: "r1" }, author),
    ).rejects.toThrow(/不可關聯到自己/);
  });

  it("兩端可讀 → 建立成功 + OperationLog", async () => {
    mocks.recordFindMany.mockResolvedValue([permRow("r1"), permRow("r2")]);
    mocks.relationFindFirst.mockResolvedValue(null);
    mocks.relationCreate.mockResolvedValue({ id: "rel1" });

    const result = await createRelation({ fromId: "r1", toId: "r2", label: "相關" }, author);
    expect(result.id).toBe("rel1");
    expect(mocks.relationCreate).toHaveBeenCalledWith({
      data: { fromId: "r1", toId: "r2", label: "相關" },
      select: { id: true },
    });
    expect(mocks.operationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CREATE", targetType: "RECORD_RELATION" }),
    });
  });

  it("任一端不可讀 → NOT_FOUND（不洩漏哪一端）", async () => {
    mocks.recordFindMany.mockResolvedValue([
      permRow("r1"),
      permRow("r2", { isConfidential: true, authorId: "other" }),
    ]);
    await expect(createRelation({ fromId: "r1", toId: "r2" }, author)).rejects.toThrow(
      /無權建立關聯/,
    );
  });

  it("重複關聯被拒", async () => {
    mocks.recordFindMany.mockResolvedValue([permRow("r1"), permRow("r2")]);
    mocks.relationFindFirst.mockResolvedValue({ id: "existing" });
    await expect(createRelation({ fromId: "r1", toId: "r2" }, author)).rejects.toThrow(
      /關聯已存在/,
    );
  });
});

describe("deleteRelation", () => {
  it("Admin 可刪除", async () => {
    mocks.relationFindUnique.mockResolvedValue({
      id: "rel1",
      from: permRow("r1"),
      to: permRow("r2", { authorId: "other" }),
    });
    await deleteRelation("rel1", admin);
    expect(mocks.relationDelete).toHaveBeenCalledWith({ where: { id: "rel1" } });
  });

  it("任一端 canEdit 可刪除", async () => {
    mocks.relationFindUnique.mockResolvedValue({
      id: "rel1",
      from: permRow("r1"),
      to: permRow("r2", { authorId: "other", isEditableByOthers: true }),
    });
    await deleteRelation("rel1", author);
    expect(mocks.relationDelete).toHaveBeenCalledTimes(1);
  });

  it("無權 → NOT_FOUND", async () => {
    mocks.relationFindUnique.mockResolvedValue({
      id: "rel1",
      from: permRow("r1", { authorId: "other" }),
      to: permRow("r2", { authorId: "other" }),
    });
    await expect(deleteRelation("rel1", author)).rejects.toThrow(/無權刪除/);
  });
});

describe("listRelationsForRecord", () => {
  it("雙向合併；另一端不可讀/已刪除者被過濾", async () => {
    mocks.relationFindMany.mockResolvedValueOnce([
      // out：r1 → r2（可讀公開）
      {
        id: "out1",
        label: "參考",
        to: { id: "r2", title: "公開資料", authorId: "other", isPublic: true, isEditableByOthers: false, isConfidential: false, deletedAt: null },
      },
      // out：r1 → r3（他人保密，應被過濾）
      {
        id: "out2",
        label: null,
        to: { id: "r3", title: "他人機密", authorId: "other", isPublic: false, isEditableByOthers: false, isConfidential: true, deletedAt: null },
      },
      // out：r1 → r4（已刪除，應被過濾）
      {
        id: "out3",
        label: null,
        to: { id: "r4", title: "已刪除", authorId: "other", isPublic: true, isEditableByOthers: false, isConfidential: false, deletedAt: new Date() },
      },
    ]);
    mocks.relationFindMany.mockResolvedValueOnce([
      // in：r5 → r1（自己的資料）
      {
        id: "in1",
        label: null,
        from: { id: "r5", title: "我的資料", authorId: "me", isPublic: false, isEditableByOthers: false, isConfidential: false, deletedAt: null },
      },
    ]);

    const result = await listRelationsForRecord("r1", author);
    expect(result.map((r) => `${r.direction}:${r.id}`)).toEqual(["out:out1", "in:in1"]);
    expect(result[0].related.title).toBe("公開資料");
  });
});
