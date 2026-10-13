import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * record-service 單元測試（TASK-003）
 * mock DB 與 localdata repository：
 * - search 權限兜底過濾（他人私有/保密即使回傳也被剔除）
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
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    record: { findMany: mocks.findMany, findUnique: mocks.findUnique, create: mocks.recordCreate },
    operationLog: { create: mocks.logCreate },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
  }),
}));

vi.mock("@/server/repositories/localdata-repository", () => ({
  createRecordFile: mocks.createRecordFile,
  removeRecordFile: mocks.removeRecordFile,
  readRecordFile: vi.fn(),
  LocaldataFileNotFoundError: class extends Error {},
  LocaldataCorruptedFileError: class extends Error {},
}));

import { createRecord, searchRecords } from "@/server/services/record-service";
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
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops as Promise<unknown>[]) await op;
  });
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

  it("列表 DTO 不含 data 內容", async () => {
    mocks.queryRaw.mockResolvedValue([row({ id: "1", isPublic: true })]);
    const result = await searchRecords("x", actor, 50);
    expect(result[0]).not.toHaveProperty("data");
    expect(result[0]).not.toHaveProperty("schema");
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
});
