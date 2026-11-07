import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATE_FIELDS,
  templateFieldSchema,
  templateInputSchema,
  TEMPLATE_FIELD_TYPES,
} from "@/lib/schemas/template";

/**
 * Template schema 單元測試（TASK-008）
 */
const validTemplate = {
  name: "會議紀錄",
  description: "例會",
  fields: [
    { name: "topic", label: "會議主題", type: "text", required: true },
    { name: "attendees", label: "出席人員", type: "list" },
  ],
};

function makeFields(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `field_${i}`,
    label: `欄位 ${i}`,
    type: "text" as const,
  }));
}

describe("templateFieldSchema", () => {
  it("六種型別全通過", () => {
    for (const type of TEMPLATE_FIELD_TYPES) {
      expect(templateFieldSchema.safeParse({ name: "f", label: "欄位", type }).success).toBe(true);
    }
  });

  it("required 未給時 default 為 false", () => {
    const parsed = templateFieldSchema.safeParse({ name: "f", label: "欄位", type: "text" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.required).toBe(false);
  });

  it("欄位名稱限英文/數字/底線、開頭為字母", () => {
    expect(templateFieldSchema.safeParse({ name: "中文", label: "欄位", type: "text" }).success).toBe(false);
    expect(templateFieldSchema.safeParse({ name: "1abc", label: "欄位", type: "text" }).success).toBe(false);
    expect(templateFieldSchema.safeParse({ name: "a-b", label: "欄位", type: "text" }).success).toBe(false);
    expect(templateFieldSchema.safeParse({ name: "field_01", label: "欄位", type: "text" }).success).toBe(true);
  });

  it("空標籤被拒", () => {
    expect(templateFieldSchema.safeParse({ name: "f", label: "  ", type: "text" }).success).toBe(false);
  });
});

describe("templateInputSchema", () => {
  it("合法範本通過", () => {
    expect(templateInputSchema.safeParse(validTemplate).success).toBe(true);
  });

  it("0 欄位被拒", () => {
    expect(templateInputSchema.safeParse({ ...validTemplate, fields: [] }).success).toBe(false);
  });

  it(`超過 ${MAX_TEMPLATE_FIELDS} 欄被拒`, () => {
    const parsed = templateInputSchema.safeParse({
      ...validTemplate,
      fields: makeFields(MAX_TEMPLATE_FIELDS + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it("剛好 20 欄通過", () => {
    const parsed = templateInputSchema.safeParse({
      ...validTemplate,
      fields: makeFields(MAX_TEMPLATE_FIELDS),
    });
    expect(parsed.success).toBe(true);
  });

  it("重複欄位名稱被拒", () => {
    const parsed = templateInputSchema.safeParse({
      ...validTemplate,
      fields: [
        { name: "topic", label: "主題", type: "text" },
        { name: "topic", label: "主題二", type: "text" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("空範本名稱被拒", () => {
    expect(templateInputSchema.safeParse({ ...validTemplate, name: "  " }).success).toBe(false);
  });

  it("非法型別被拒", () => {
    const parsed = templateInputSchema.safeParse({
      ...validTemplate,
      fields: [{ name: "f", label: "欄位", type: "select" }],
    });
    expect(parsed.success).toBe(false);
  });
});
