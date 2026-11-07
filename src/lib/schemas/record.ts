import { z } from "zod";

/**
 * Record schema（前後端共用，TASK-003）
 * data 為自由格式 JSON（表單以 textarea 貼入，服務層 JSON.parse）
 */
export const MAX_DATA_BYTES = 1024 * 1024; // 1MB（CLAUDE.security.md 大小上限）

function isValidDataJson(s: string): boolean {
  try {
    const parsed: unknown = JSON.parse(s);
    // 頂層必須是物件/陣列（避免 JSON null 字面量在 Prisma Json 欄位上的 runtime 錯誤）
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length; // Buffer 在瀏覽器不可用
}

/** API 層建立輸入（三旗標，保密與另兩者互斥；templateId 為 TASK-008 範本選用） */
export const createRecordSchema = z
  .object({
    title: z.string().trim().min(1, "請輸入標題").max(200, "標題過長"),
    dataJson: z
      .string()
      .min(1, "請輸入資料")
      .refine(isValidDataJson, { message: "資料必須是合法 JSON（物件或陣列）" })
      .refine((s) => byteLength(s) <= MAX_DATA_BYTES, { message: "資料超過 1MB 上限" }),
    isPublic: z.boolean().default(false),
    isEditableByOthers: z.boolean().default(false),
    isConfidential: z.boolean().default(false),
    templateId: z.string().trim().min(1).optional(),
  })
  .refine((v) => !(v.isConfidential && (v.isPublic || v.isEditableByOthers)), {
    message: "保密資料不可同時設為公開或可被他人編輯",
    path: ["isConfidential"],
  });

export type CreateRecordInput = z.infer<typeof createRecordSchema>;

/** 表單層輸入（三選一可見性，submit 時換算成 API 旗標；isEditableByOthers 由 useForm defaultValues 提供） */
export const createRecordFormSchema = z.object({
  title: createRecordSchema.shape.title,
  dataJson: createRecordSchema.shape.dataJson,
  visibility: z.enum(["PUBLIC", "PRIVATE", "CONFIDENTIAL"]),
  isEditableByOthers: z.boolean(),
});

export type CreateRecordFormInput = z.infer<typeof createRecordFormSchema>;

/** 搜尋輸入 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "請輸入關鍵字").max(200, "關鍵字過長"),
});

export const searchInputSchema = searchQuerySchema.extend({
  limit: z.number().int().min(1).max(100).default(50),
  // TASK-010：結果附命中片段（結果頁用；下拉建議/關聯選取器不傳 → 省成本）
  withSnippet: z.boolean().default(false),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

/** 編輯輸入（至少變更一個欄位；isConfidential 不可變更，TASK-005 限制） */
export const updateRecordSchema = z
  .object({
    id: z.string().min(1),
    title: createRecordSchema.shape.title.optional(),
    dataJson: createRecordSchema.shape.dataJson.optional(),
    isPublic: z.boolean().optional(),
    isEditableByOthers: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.dataJson !== undefined ||
      v.isPublic !== undefined ||
      v.isEditableByOthers !== undefined,
    { message: "至少變更一個欄位" },
  );

export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;

export const deleteRequestSchema = z.object({ id: z.string().min(1) });
export const confirmDeleteSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
});
export const restoreSchema = z.object({ id: z.string().min(1) });
