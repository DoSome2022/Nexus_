import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * template-service 單元測試（TASK-008）
 * - 非 admin 的 create/update/delete → FORBIDDEN；list 任何人可用
 * - 名稱重複 → CONFLICT；不存在 → NOT_FOUND
 * - CRUD 各寫一份 OperationLog（targetType: RECORD_TEMPLATE）
 */
const mocks = vi.hoisted(() => ({
  templateFindMany: vi.fn(),
  templateFindFirst: vi.fn(),
  templateFindUnique: vi.fn(),
  templateCreate: vi.fn(),
  templateUpdate: vi.fn(),
  templateDelete: vi.fn(),
  logOperation: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    recordTemplate: {
      findMany: mocks.templateFindMany,
      findFirst: mocks.templateFindFirst,
      findUnique: mocks.templateFindUnique,
      create: mocks.templateCreate,
      update: mocks.templateUpdate,
      delete: mocks.templateDelete,
    },
  }),
}));
vi.mock("@/server/audit/operation-log", () => ({
  logOperation: mocks.logOperation,
}));

import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "@/server/services/template-service";

const admin = { id: "admin1", role: "ADMIN" as const };
const user = { id: "user1", role: "USER" as const };

const validInput = {
  name: "會議紀錄",
  description: "例會",
  fields: [{ name: "topic", label: "會議主題", type: "text" as const, required: true }],
};

function templateRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "會議紀錄",
    description: "例會",
    fields: validInput.fields,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTemplates", () => {
  it("任何登入者可用；損壞列跳過", async () => {
    mocks.templateFindMany.mockResolvedValue([
      templateRow("t1"),
      templateRow("t2", { fields: "corrupt" }),
    ]);
    const result = await listTemplates(user);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("t1");
  });
});

describe("createTemplate", () => {
  it("非 admin → FORBIDDEN", async () => {
    await expect(createTemplate(validInput, user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.templateCreate).not.toHaveBeenCalled();
  });

  it("名稱重複 → CONFLICT", async () => {
    mocks.templateFindFirst.mockResolvedValue({ id: "exists" });
    await expect(createTemplate(validInput, admin)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("成功：建立 + OperationLog(CREATE)", async () => {
    mocks.templateFindFirst.mockResolvedValue(null);
    mocks.templateCreate.mockResolvedValue({ id: "t1" });
    const result = await createTemplate(validInput, admin);
    expect(result).toEqual({ id: "t1" });
    expect(mocks.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: admin.id,
        action: "CREATE",
        targetType: "RECORD_TEMPLATE",
        targetId: "t1",
      }),
    );
  });
});

describe("updateTemplate", () => {
  it("非 admin → FORBIDDEN", async () => {
    await expect(updateTemplate(validInput, user, "t1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("不存在 → NOT_FOUND", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    await expect(updateTemplate(validInput, admin, "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("名稱撞到其他範本 → CONFLICT", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "t1" });
    mocks.templateFindFirst.mockResolvedValue({ id: "other" });
    await expect(updateTemplate(validInput, admin, "t1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("成功：更新 + OperationLog(UPDATE)", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "t1" });
    mocks.templateFindFirst.mockResolvedValue(null);
    mocks.templateUpdate.mockResolvedValue({ id: "t1" });
    await updateTemplate(validInput, admin, "t1");
    expect(mocks.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: admin.id,
        action: "UPDATE",
        targetType: "RECORD_TEMPLATE",
        targetId: "t1",
      }),
    );
  });
});

describe("deleteTemplate", () => {
  it("非 admin → FORBIDDEN", async () => {
    await expect(deleteTemplate("t1", user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.templateDelete).not.toHaveBeenCalled();
  });

  it("不存在 → NOT_FOUND", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    await expect(deleteTemplate("missing", admin)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("成功：硬刪除 + OperationLog(DELETE)", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "t1" });
    mocks.templateDelete.mockResolvedValue({ id: "t1" });
    const result = await deleteTemplate("t1", admin);
    expect(result).toEqual({ id: "t1" });
    expect(mocks.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: admin.id,
        action: "DELETE",
        targetType: "RECORD_TEMPLATE",
        targetId: "t1",
      }),
    );
  });
});
