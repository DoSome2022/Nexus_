import type { Role } from "@/generated/prisma/enums";

/**
 * 權限純函式（依 .claude/CLAUDE.security.md 權限模型）
 * 每個 tRPC procedure 必呼叫；保密資料（isConfidential）僅作者可存取（TASK-004）。
 */

export interface PermissionActor {
  id: string;
  role: Role;
}

/** 權限判斷所需的 Record 欄位（結構型別，與 Prisma model 相容） */
export interface RecordPermissions {
  authorId: string;
  isPublic: boolean;
  isEditableByOthers: boolean;
  isConfidential: boolean;
}

export function canRead(record: RecordPermissions, user: PermissionActor): boolean {
  // 保密：僅作者（服務層已強制 isPublic=false，此處防禦性優先判斷）
  if (record.isConfidential) return record.authorId === user.id;
  if (record.authorId === user.id) return true;
  return record.isPublic;
}

export function canEdit(record: RecordPermissions, user: PermissionActor): boolean {
  if (record.isConfidential) return record.authorId === user.id;
  if (record.authorId === user.id) return true;
  return record.isEditableByOthers;
}

/** 刪除：僅 ADMIN（Mail 確認流程由 service 層處理） */
export function canDelete(_record: RecordPermissions, user: PermissionActor): boolean {
  return user.role === "ADMIN";
}
