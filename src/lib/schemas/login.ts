import { z } from "zod";

/**
 * 登入表單 schema（前後端共用，TASK-002）
 * 密碼上限 72 字元（bcrypt 只能處理 72 bytes）
 */
export const loginSchema = z.object({
  email: z.string().trim().min(1, "請輸入 Email").email("Email 格式不正確"),
  password: z.string().min(8, "密碼至少 8 字元").max(72, "密碼過長"),
});

export type LoginInput = z.infer<typeof loginSchema>;
