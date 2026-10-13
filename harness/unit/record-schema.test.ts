import { describe, expect, it } from "vitest";
import {
  createRecordFormSchema,
  createRecordSchema,
  MAX_DATA_BYTES,
  searchInputSchema,
} from "@/lib/schemas/record";

/**
 * Record schema 單元測試（TASK-003）
 */
const valid = {
  title: "測試資料",
  dataJson: '{"a":1}',
  isPublic: false,
  isEditableByOthers: false,
  isConfidential: false,
};

describe("createRecordSchema", () => {
  it("合法輸入通過", () => {
    expect(createRecordSchema.safeParse(valid).success).toBe(true);
  });

  it("非法 JSON 被拒", () => {
    expect(createRecordSchema.safeParse({ ...valid, dataJson: "{oops" }).success).toBe(false);
  });

  it("空白標題被拒", () => {
    expect(createRecordSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
  });

  it("超過 1MB 被拒", () => {
    const big = JSON.stringify({ pad: "x".repeat(MAX_DATA_BYTES) });
    expect(createRecordSchema.safeParse({ ...valid, dataJson: big }).success).toBe(false);
  });

  it("保密 + 公開互斥被拒", () => {
    expect(
      createRecordSchema.safeParse({ ...valid, isConfidential: true, isPublic: true }).success,
    ).toBe(false);
  });

  it("保密 + 可被他人編輯互斥被拒", () => {
    expect(
      createRecordSchema.safeParse({ ...valid, isConfidential: true, isEditableByOthers: true })
        .success,
    ).toBe(false);
  });

  it("保密單獨成立", () => {
    expect(createRecordSchema.safeParse({ ...valid, isConfidential: true }).success).toBe(true);
  });
});

describe("createRecordFormSchema", () => {
  it("合法表單輸入通過", () => {
    expect(
      createRecordFormSchema.safeParse({
        title: "測試",
        dataJson: "{}",
        visibility: "CONFIDENTIAL",
        isEditableByOthers: false,
      }).success,
    ).toBe(true);
  });

  it("非法可見性被拒", () => {
    expect(
      createRecordFormSchema.safeParse({
        title: "測試",
        dataJson: "{}",
        visibility: "UNKNOWN",
      }).success,
    ).toBe(false);
  });
});

describe("searchInputSchema", () => {
  it("合法 q 通過", () => {
    expect(searchInputSchema.safeParse({ q: "會議" }).success).toBe(true);
  });

  it("空白 q 被拒", () => {
    expect(searchInputSchema.safeParse({ q: "   " }).success).toBe(false);
  });

  it("limit 超過 100 被拒", () => {
    expect(searchInputSchema.safeParse({ q: "x", limit: 101 }).success).toBe(false);
  });

  it("limit 預設 50", () => {
    const r = searchInputSchema.parse({ q: "x" });
    expect(r.limit).toBe(50);
  });
});
