import { getDb } from "@/server/db";

/**
 * OperationLog 審計寫入（CLAUDE.backend.md：每操作一份，不可省）
 * 登入（TASK-002）與後續 CRUD 共用
 */
export type OperationAction = "LOGIN" | "CREATE" | "UPDATE" | "DELETE" | "VIEW";

export interface OperationLogInput {
  actorId: string;
  action: OperationAction;
  targetType: string;
  targetId: string;
  durationMs: number;
  ip?: string | null;
  userAgent?: string | null;
}

export async function logOperation(input: OperationLogInput): Promise<void> {
  await getDb().operationLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      durationMs: Math.round(input.durationMs),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
