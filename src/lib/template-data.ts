import { z } from "zod";
import { createRecordSchema } from "@/lib/schemas/record";
import {
  MAX_TEMPLATE_FIELDS,
  templateFieldSchema,
  type TemplateField,
} from "@/lib/schemas/template";

/**
 * 範本資料純函式（TASK-008，前後端共用、可單元測試）
 * - snapshot：Record.schema 存建立時的範本快照（範本之後怎麼改都不影響舊紀錄）
 * - schemaMatchesData：欄位集合 + 型別 + required 全對才算「相符」，否則 UI 回退 raw JSON
 */

export const SNAPSHOT_VERSION = 1 as const;

export interface RecordTemplateSnapshot {
  v: typeof SNAPSHOT_VERSION;
  templateName: string;
  fields: TemplateField[];
}

/** 只要能提供 name/fields 就能產生 snapshot（template row 或 seed 常數） */
export interface TemplateLike {
  name: string;
  fields: TemplateField[];
}

const snapshotSchema = z.object({
  v: z.literal(SNAPSHOT_VERSION),
  templateName: z.string().min(1).max(50),
  fields: z
    .array(templateFieldSchema)
    .min(1)
    .max(MAX_TEMPLATE_FIELDS)
    .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length),
});

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** 建立 snapshot：{ v: 1, templateName, fields }（寫進 Record.schema 或 localdata 檔案） */
export function buildRecordTemplateSnapshot(template: TemplateLike): RecordTemplateSnapshot {
  return { v: SNAPSHOT_VERSION, templateName: template.name, fields: template.fields };
}

/** 解析 Record.schema → snapshot；無效（legacy {}、損壞）回 null */
export function parseRecordTemplateSnapshot(schema: unknown): RecordTemplateSnapshot | null {
  const parsed = snapshotSchema.safeParse(schema);
  return parsed.success ? parsed.data : null;
}

function valueMatchesType(type: TemplateField["type"], value: unknown): boolean {
  switch (type) {
    case "text":
    case "textarea":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "list":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "date":
      return typeof value === "string" && DATE_REGEX.test(value);
  }
}

/** 資料是否與 snapshot 相符：頂層物件、無未知欄位、required 全在（boolean 除外）、型別全對 */
export function schemaMatchesData(snapshot: RecordTemplateSnapshot, data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const fieldByName = new Map(snapshot.fields.map((f) => [f.name, f]));

  for (const [key, value] of Object.entries(record)) {
    const field = fieldByName.get(key);
    if (!field || !valueMatchesType(field.type, value)) return false;
  }
  for (const field of snapshot.fields) {
    // boolean 必有值（checkbox 序列化恒含 false），required 對其無意義
    if (field.required && field.type !== "boolean" && !(field.name in record)) return false;
  }
  return true;
}

/**
 * 表單值 → 資料物件（submit 時 JSON.stringify 成 dataJson）
 * - 空字串的選填欄位省略；boolean 恒寫入（false = 明確未勾選）
 * - list 以中/英逗號分隔（list 值不可含逗號，文件已註明）
 */
export function serializeTemplateValues(
  fields: TemplateField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === "boolean") {
      out[field.name] = raw === true;
      continue;
    }
    const s = typeof raw === "string" ? raw.trim() : "";
    if (s === "") continue;
    if (field.type === "number") {
      const n = Number(s);
      if (Number.isFinite(n)) out[field.name] = n;
      continue;
    }
    if (field.type === "list") {
      out[field.name] = s
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== "");
      continue;
    }
    out[field.name] = s; // text / textarea / date
  }
  return out;
}

/** 資料物件 → 表單值（編輯頁回填；型別對不上/資料非物件的欄位給空值） */
export function toTemplateFormValues(
  fields: TemplateField[],
  data: unknown,
): Record<string, string | boolean> {
  const record =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    const v = record ? record[field.name] : undefined;
    if (field.type === "boolean") {
      values[field.name] = v === true;
    } else if (field.type === "number") {
      values[field.name] = typeof v === "number" ? String(v) : "";
    } else if (field.type === "list") {
      values[field.name] = Array.isArray(v)
        ? v.map((item) => (typeof item === "string" ? item : String(item))).join(", ")
        : "";
    } else {
      values[field.name] = typeof v === "string" ? v : "";
    }
  }
  return values;
}

/** RHF 表單值（建立/編輯共用；兩種模式欄位都註冊，data 未註冊時 default({}) 兜底） */
export interface RecordFormValues {
  title: string;
  dataJson: string;
  data: Record<string, string | boolean>;
  visibility: "PUBLIC" | "PRIVATE" | "CONFIDENTIAL";
  isEditableByOthers: boolean;
}

/**
 * 建立/編輯資料表單的動態 resolver：
 * - fields = null（JSON 模式）：dataJson 走原 JSON 驗證，data 為空
 * - fields = 範本欄位（表單模式）：data 逐欄驗證（required/數字/日期），dataJson 為隱藏原始值
 * RHF 每次 render 會重設 control._options（含 resolver），動態 schema 安全（已驗證 7.89 行為）
 */
export function buildRecordFormSchema(fields: TemplateField[] | null) {
  const dataSchema = z.record(z.string(), z.union([z.string(), z.boolean()]));
  // 單一 schema + 頂層 superRefine 依模式驗證（避免 union 回傳型別破壞 zodResolver 推斷）
  return z
    .object({
      title: createRecordSchema.shape.title,
      dataJson: z.string(),
      data: dataSchema,
      visibility: z.enum(["PUBLIC", "PRIVATE", "CONFIDENTIAL"]),
      isEditableByOthers: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (!fields) {
        // JSON 模式：dataJson 沿用 createRecordSchema 的規則（min 1 / 合法 JSON / 1MB）
        const check = createRecordSchema.shape.dataJson.safeParse(values.dataJson);
        if (!check.success) {
          ctx.addIssue({
            code: "custom",
            message: check.error.issues[0]?.message ?? "資料必須是合法 JSON（物件或陣列）",
            path: ["dataJson"],
          });
        }
        return;
      }
      // 範本模式：data 逐欄驗證（required/數字/日期）
      for (const field of fields) {
        if (field.type === "boolean") continue;
        const raw = values.data[field.name];
        const s = typeof raw === "string" ? raw.trim() : "";
        if (field.required && s === "") {
          ctx.addIssue({ code: "custom", message: `請填寫「${field.label}」`, path: ["data", field.name] });
        } else if (field.type === "number" && s !== "" && !Number.isFinite(Number(s))) {
          ctx.addIssue({ code: "custom", message: `「${field.label}」必須是數字`, path: ["data", field.name] });
        } else if (field.type === "date" && s !== "" && !DATE_REGEX.test(s)) {
          ctx.addIssue({ code: "custom", message: `「${field.label}」日期格式不正確`, path: ["data", field.name] });
        }
      }
    });
}
