import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * suggestRelations（record-service）單元測試（TASK-009）
 * - 被檢視記錄不可讀 → NOT_FOUND（getRecord 行為）
 * - 候選只含 canRead 可見記錄（他人私有不洩漏）
 * - 保密記錄的內容從 localdata 檔案載入
 * - 已關聯（雙向）排除
 */
const mocks = vi.hoisted(() => ({
  recordFindUnique: vi.fn(),
  recordFindMany: vi.fn(),
  relationFindMany: vi.fn(),
  readRecordFile: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    record: { findUnique: mocks.recordFindUnique, findMany: mocks.recordFindMany },
    recordRelation: { findMany: mocks.relationFindMany },
  }),
}));
vi.mock("@/server/repositories/localdata-repository", () => ({
  readRecordFile: mocks.readRecordFile,
  createRecordFile: vi.fn(),
  updateRecordFile: vi.fn(),
  removeRecordFile: vi.fn(),
  moveToTrash: vi.fn(),
  restoreFromTrash: vi.fn(),
  LocaldataFileNotFoundError: class extends Error {},
  LocaldataCorruptedFileError: class extends Error {},
}));

import { suggestRelations } from "@/server/services/record-service";

const demo = { id: "demo1", role: "USER" as const };

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "seed_suggest_account",
    authorId: "demo1",
    title: "甲君的某某網帳號",
    schema: {},
    data: { note: "這是甲君在某某網的帳號" },
    isPublic: true,
    isEditableByOthers: false,
    isConfidential: false,
    deletedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function candidateRow(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    authorId: "demo1",
    isPublic: true,
    isEditableByOthers: false,
    isConfidential: false,
    ...overrides,
  };
}

function fileFixture(data: unknown) {
  return {
    version: 1,
    id: "seed_suggest_account",
    authorId: "demo1",
    schema: {},
    data,
    changes: [],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("suggestRelations", () => {
  it("被檢視記錄不存在/不可讀 → NOT_FOUND", async () => {
    mocks.recordFindUnique.mockResolvedValue(null);
    await expect(suggestRelations("missing", demo)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("掃描標題 + data，長標題優先；他人私有候選不洩漏", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordRow());
    mocks.recordFindMany.mockResolvedValue([
      candidateRow("seed_suggest_site", "某某網"),
      candidateRow("seed_suggest_person", "甲君"),
      candidateRow("other_private", "甲君機密", { authorId: "other", isPublic: false }),
    ]);
    mocks.relationFindMany.mockResolvedValue([]);

    const result = await suggestRelations("seed_suggest_account", demo);
    expect(result.map((r) => r.id)).toEqual(["seed_suggest_site", "seed_suggest_person"]);
  });

  it("保密記錄：內容從 localdata 檔案載入後掃描", async () => {
    mocks.recordFindUnique.mockResolvedValue(
      recordRow({ isConfidential: true, data: null, schema: null }),
    );
    mocks.readRecordFile.mockResolvedValue(fileFixture({ summary: "甲君的年度體檢" }));
    mocks.recordFindMany.mockResolvedValue([candidateRow("seed_suggest_person", "甲君")]);
    mocks.relationFindMany.mockResolvedValue([]);

    const result = await suggestRelations("seed_suggest_account", demo);
    expect(result.map((r) => r.id)).toEqual(["seed_suggest_person"]);
  });

  it("已關聯（任一方向）排除", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordRow());
    mocks.recordFindMany.mockResolvedValue([
      candidateRow("seed_suggest_site", "某某網"),
      candidateRow("seed_suggest_person", "甲君"),
    ]);
    // 依方向回應：toId 方向已存在 某某網 → 甲君 的關聯 → 某某網 應被排除
    mocks.relationFindMany.mockImplementation((args: { where: { toId?: string } }) =>
      Promise.resolve(
        args.where.toId
          ? [
              {
                from: {
                  id: "seed_suggest_site",
                  title: "某某網",
                  authorId: "demo1",
                  isPublic: true,
                  isEditableByOthers: false,
                  isConfidential: false,
                  deletedAt: null,
                },
              },
            ]
          : [],
      ),
    );

    const result = await suggestRelations("seed_suggest_account", demo);
    expect(result.map((r) => r.id)).toEqual(["seed_suggest_person"]);
  });

  it("無提及 → 空陣列", async () => {
    mocks.recordFindUnique.mockResolvedValue(recordRow({ title: "專案進度報告", data: {} }));
    mocks.recordFindMany.mockResolvedValue([candidateRow("seed_suggest_person", "甲君")]);
    mocks.relationFindMany.mockResolvedValue([]);

    expect(await suggestRelations("seed_suggest_account", demo)).toEqual([]);
  });
});
