import { z } from "zod";

/**
 * 資料關聯 schema（TASK-007）
 * 關聯為單向帶 label；建立需兩端 canRead（service 層強制）
 */
export const relationCreateSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  label: z.string().trim().max(100, "標籤過長").optional(),
});

export type RelationCreateInput = z.infer<typeof relationCreateSchema>;

export const relationDeleteSchema = z.object({ id: z.string().min(1) });
