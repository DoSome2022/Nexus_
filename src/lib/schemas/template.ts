import { z } from "zod";

/**
 * 表單範本 schema（前後端共用，TASK-008）
 * - 範本全站共用、Admin 管理；Record.schema 存建立時的 snapshot
 * - 欄位型別：text / textarea / number / boolean / list（逗號分隔）/ date（YYYY-MM-DD）
 * - required 對 boolean 無意義（checkbox 必有值）
 */

export const TEMPLATE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "boolean",
  "list",
  "date",
] as const;

export const MAX_TEMPLATE_FIELDS = 20;

/** 欄位名 = JSON key：英文/數字/底線、開頭為字母（label 才是給人看的中文） */
const FIELD_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

export const templateFieldSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "請輸入欄位名稱")
    .max(50, "欄位名稱過長")
    .regex(FIELD_NAME_REGEX, "欄位名稱僅限英文/數字/底線，開頭為字母"),
  label: z.string().trim().min(1, "請輸入顯示標籤").max(100, "顯示標籤過長"),
  type: z.enum(TEMPLATE_FIELD_TYPES, { message: "不支援的欄位型別" }),
  required: z.boolean().default(false),
});

export type TemplateField = z.infer<typeof templateFieldSchema>;

/** 範本建立/更新輸入（tRPC input，欄位名不可重複） */
export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "請輸入範本名稱").max(50, "範本名稱過長"),
  description: z.string().trim().max(200, "描述過長").optional(),
  fields: z
    .array(templateFieldSchema)
    .min(1, "至少需要一個欄位")
    .max(MAX_TEMPLATE_FIELDS, `欄位數不可超過 ${MAX_TEMPLATE_FIELDS} 個`)
    .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, {
      message: "欄位名稱不可重複",
    }),
});

export type TemplateInput = z.infer<typeof templateInputSchema>;

/** 範本更新輸入：至少變更一個欄位 */
export const templateUpdateSchema = templateInputSchema;

export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;
