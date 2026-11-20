import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  categoryFormSchema,
  categoryLinkSchema,
  categoryUpdateSchema,
} from "@/lib/schemas/category";

/**
 * 分類 Zod schema（TASK-012）
 * 核心：parentId 的 null/undefined 語意、update 至少一項、trim
 */
describe("categoryCreateSchema", () => {
  it("name trim 後通過", () => {
    expect(categoryCreateSchema.parse({ name: "  水果  " }).name).toBe("水果");
  });

  it("空字串/全空白 → 錯誤", () => {
    expect(categoryCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("name 超過 100 → 錯誤", () => {
    expect(categoryCreateSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });

  it("parentId 可省略、可 null", () => {
    expect(categoryCreateSchema.parse({ name: "根" }).parentId).toBeUndefined();
    expect(categoryCreateSchema.parse({ name: "根", parentId: null }).parentId).toBeNull();
  });
});

describe("categoryUpdateSchema", () => {
  it("只給 id → 錯誤（至少變更一項）", () => {
    expect(categoryUpdateSchema.safeParse({ id: "c1" }).success).toBe(false);
  });

  it("parentId: null 合法（移到根）", () => {
    const parsed = categoryUpdateSchema.parse({ id: "c1", parentId: null });
    expect(parsed.parentId).toBeNull();
  });

  it("parentId undefined 表示不變更", () => {
    const parsed = categoryUpdateSchema.parse({ id: "c1", name: "新名" });
    expect(parsed.parentId).toBeUndefined();
  });
});

describe("categoryLinkSchema / categoryFormSchema", () => {
  it("link 缺 recordId/categoryId → 錯誤", () => {
    expect(categoryLinkSchema.safeParse({ recordId: "r1" }).success).toBe(false);
    expect(categoryLinkSchema.safeParse({ categoryId: "c1" }).success).toBe(false);
    expect(categoryLinkSchema.parse({ recordId: "r1", categoryId: "c1" })).toEqual({
      recordId: "r1",
      categoryId: "c1",
    });
  });

  it("表單 schema：parentId 空字串代表根", () => {
    expect(categoryFormSchema.parse({ name: "根", parentId: "" }).parentId).toBe("");
  });
});
