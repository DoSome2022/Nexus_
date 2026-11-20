import { describe, expect, it } from "vitest";
import {
  canDelete,
  canEdit,
  canManageCategory,
  canRead,
  type PermissionActor,
  type RecordPermissions,
} from "@/server/security/permissions";

/**
 * 權限純函式單元測試（TASK-004 保密分支，核心邏輯必測）
 * 依 .claude/CLAUDE.harness.md 必測清單：權限過濾
 */
const author: PermissionActor = { id: "u_author", role: "USER" };
const other: PermissionActor = { id: "u_other", role: "USER" };
const admin: PermissionActor = { id: "u_admin", role: "ADMIN" };

function record(overrides: Partial<RecordPermissions> = {}): RecordPermissions {
  return {
    authorId: author.id,
    isPublic: false,
    isEditableByOthers: false,
    isConfidential: false,
    ...overrides,
  };
}

describe("canRead", () => {
  it("作者可讀自己的資料", () => {
    expect(canRead(record(), author)).toBe(true);
  });

  it("公開資料他人可讀", () => {
    expect(canRead(record({ isPublic: true }), other)).toBe(true);
  });

  it("私有資料他人不可讀", () => {
    expect(canRead(record(), other)).toBe(false);
  });

  it("保密資料僅作者可讀", () => {
    expect(canRead(record({ isConfidential: true }), author)).toBe(true);
    expect(canRead(record({ isConfidential: true }), other)).toBe(false);
  });

  it("保密資料即使 isPublic=true（防禦性）非作者仍不可讀", () => {
    expect(canRead(record({ isConfidential: true, isPublic: true }), other)).toBe(false);
  });
});

describe("canEdit", () => {
  it("作者可編輯自己的資料", () => {
    expect(canEdit(record(), author)).toBe(true);
  });

  it("isEditableByOthers=true 他人可編輯", () => {
    expect(canEdit(record({ isEditableByOthers: true }), other)).toBe(true);
  });

  it("保密資料僅作者可編輯（他人即使 isEditableByOthers 也不可）", () => {
    expect(canEdit(record({ isConfidential: true }), author)).toBe(true);
    expect(canEdit(record({ isConfidential: true, isEditableByOthers: true }), other)).toBe(
      false,
    );
  });
});

describe("canDelete", () => {
  it("僅 ADMIN 可刪除", () => {
    expect(canDelete(record(), admin)).toBe(true);
    expect(canDelete(record(), author)).toBe(false);
    expect(canDelete(record({ isConfidential: true }), author)).toBe(false);
  });
});

describe("canManageCategory（TASK-012）", () => {
  it("建立者可管理自己的分類", () => {
    expect(canManageCategory({ createdById: author.id }, author)).toBe(true);
  });

  it("非建立者 USER 不可管理", () => {
    expect(canManageCategory({ createdById: author.id }, other)).toBe(false);
  });

  it("ADMIN 可管理任何人的分類", () => {
    expect(canManageCategory({ createdById: author.id }, admin)).toBe(true);
  });
});
