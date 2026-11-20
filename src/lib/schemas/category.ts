import { z } from "zod";

/**
 * 分類 schema（TASK-012，前後端共用）
 * - parentId：create 可省略/null；update 的 null = 移到根、undefined = 不變更
 */

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "請輸入分類名稱")
  .max(100, "分類名稱過長");

export const categoryCreateSchema = z.object({
  name: categoryNameSchema,
  parentId: z.string().min(1).nullable().optional(),
});

export const categoryUpdateSchema = z
  .object({
    id: z.string().min(1),
    name: categoryNameSchema.optional(),
    parentId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, {
    message: "至少變更一個欄位",
  });

export const categoryIdSchema = z.object({ id: z.string().min(1) });

export const categoryLinkSchema = z.object({
  recordId: z.string().min(1),
  categoryId: z.string().min(1),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type CategoryLinkInput = z.infer<typeof categoryLinkSchema>;

/** RHF 表單用：parentId 以空字串代表根分類 */
export const categoryFormSchema = z.object({
  name: categoryNameSchema,
  parentId: z.string(),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;
