import { describe, expect, it } from "vitest";
import {
  containsTitle,
  findTitleMentions,
  flattenText,
  MAX_SUGGESTIONS,
  MIN_TITLE_LENGTH,
} from "@/lib/relation-suggest";

/**
 * relation-suggest 純函式單元測試（TASK-009）
 */
const CANDIDATES = [
  { id: "person", title: "甲君", isConfidential: false },
  { id: "site", title: "某某網", isConfidential: false },
  { id: "short", title: "王", isConfidential: false },
  { id: "eng", title: "IT", isConfidential: false },
];

describe("flattenText", () => {
  it("收集標題 + 巢狀 data 的字串值", () => {
    const texts = flattenText("標題", {
      a: "文字",
      nested: { b: "巢狀" },
      list: ["清單一", "清單二"],
      num: 42,
      flag: false,
      nil: null,
    });
    expect(texts).toEqual(["標題", "文字", "巢狀", "清單一", "清單二"]);
  });

  it("忽略空白字串", () => {
    expect(flattenText("t", { a: "   ", b: "" })).toEqual(["t"]);
  });
});

describe("containsTitle", () => {
  it("中文：純 substring", () => {
    expect(containsTitle("這是甲君在某某網的帳號", "甲君")).toBe(true);
    expect(containsTitle("這是甲君在某某網的帳號", "乙君")).toBe(false);
  });

  it("ASCII：邊界守衛（IT 不配 WHITE；Net 不配 Network）", () => {
    expect(containsTitle("the WHITE house", "IT")).toBe(false);
    expect(containsTitle("IT department", "IT")).toBe(true);
    expect(containsTitle("Network outage", "Net")).toBe(false);
    expect(containsTitle("Net income", "Net")).toBe(true);
    expect(containsTitle("IT_ops", "IT")).toBe(false); // 底線視為字元
  });
});

describe("findTitleMentions", () => {
  const accountData = { note: "這是甲君在某某網的帳號" };

  it("標題與 data 都掃描；長標題優先排序", () => {
    const result = findTitleMentions("甲君的某某網帳號", accountData, CANDIDATES, new Set());
    expect(result.map((r) => r.id)).toEqual(["site", "person"]); // 某某網(3) 優先於 甲君(2)
  });

  it("排除集合（自己與已關聯）", () => {
    const result = findTitleMentions(
      "甲君的某某網帳號",
      accountData,
      CANDIDATES,
      new Set(["site", "account"]),
    );
    expect(result.map((r) => r.id)).toEqual(["person"]);
  });

  it(`單字標題（<${MIN_TITLE_LENGTH}）不建議`, () => {
    const result = findTitleMentions("王小明", {}, CANDIDATES, new Set());
    expect(result.map((r) => r.id)).not.toContain("short");
  });

  it("無提及 → 空陣列", () => {
    const result = findTitleMentions("專案進度報告", { status: "進行中" }, CANDIDATES, new Set());
    expect(result).toEqual([]);
  });

  it(`上限 ${MAX_SUGGESTIONS} 筆`, () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 5 }, (_, i) => ({
      id: `c${i}`,
      title: `候選標題${i}`,
      isConfidential: false,
    }));
    const data = many.map((c) => c.title).join("、");
    const result = findTitleMentions("t", { text: data }, many, new Set());
    expect(result).toHaveLength(MAX_SUGGESTIONS);
  });

  it("保密標記原樣帶出", () => {
    const result = findTitleMentions(
      "甲君的某某網帳號",
      accountData,
      [{ id: "person", title: "甲君", isConfidential: true }],
      new Set(),
    );
    expect(result[0]?.isConfidential).toBe(true);
  });
});
