import { describe, expect, it } from "vitest";
import {
  SEARCH_CONTENT_SEPARATOR,
  buildDisplayText,
  buildSearchContent,
  countTitleMatches,
  deriveDateTokens,
  escapeLikePattern,
  findHighlightRanges,
  flattenSearchValues,
  getDisplayText,
  makeSnippet,
  matchesAllTerms,
  tokenizeQuery,
} from "@/lib/search-text";

/** TASK-010：全欄位內容搜尋純函式 */
describe("flattenSearchValues", () => {
  it("巢狀物件/陣列字串 + 數字；跳過 boolean/null/NaN/Infinity", () => {
    expect(
      flattenSearchValues({
        a: "文字",
        n: 42,
        flag: true,
        nothing: null,
        nan: NaN,
        inf: Infinity,
        list: ["清單一", "清單二"],
        nested: { deep: "深層" },
      }),
    ).toEqual(["文字", "42", "清單一", "清單二", "深層"]);
  });

  it("trim 空字串、剝控制字元（含 SEP 本身）", () => {
    expect(
      flattenSearchValues({ a: `  含${SEARCH_CONTENT_SEPARATOR}分隔符  `, b: "   " }),
    ).toEqual(["含分隔符"]);
  });

  it("深度守衛：超過 MAX_DEPTH 停止", () => {
    let deep: unknown = { leaf: "底層" };
    for (let i = 0; i < 12; i += 1) deep = { next: deep };
    expect(flattenSearchValues(deep)).toEqual([]);
  });
});

describe("deriveDateTokens", () => {
  it("支援 - / 年 三種格式，產出衍生詞並去重", () => {
    const tokens = deriveDateTokens("2026-11-02 和 2026/11/2 和 2026年11月2日 同日再寫 2026-11-02");
    expect(tokens).toContain("11月");
    expect(tokens).toContain("11月2日");
    expect(tokens).toContain("2026年11月");
    expect(tokens).toContain("2026年11月2日");
    expect(tokens).toContain("2026-11-2");
    expect(tokens).toContain("2026/11/2");
    // 去重：11月 只出現一次
    expect(tokens.filter((t) => t === "11月")).toHaveLength(1);
  });

  it("年月格式（無日）只產出 月/年月 詞", () => {
    const tokens = deriveDateTokens("於 2026年11月 完成");
    expect(tokens).toContain("11月");
    expect(tokens).toContain("2026年11月");
    expect(tokens).not.toContain("11月1日");
  });

  it("無效日期被忽略", () => {
    expect(deriveDateTokens("2026-13-40 與 2026-02-30")).toEqual([]);
  });
});

describe("buildSearchContent / getDisplayText", () => {
  it("顯示段 + SEP + 日期衍生詞（data + title）；getDisplayText 往返", () => {
    const sc = buildSearchContent("例會 2026-11-02", { note: "討論內容", day: "2026-11-03" });
    expect(sc.startsWith(`討論內容\n2026-11-03${SEARCH_CONTENT_SEPARATOR}`)).toBe(true);
    expect(sc).toContain("11月"); // data 與 title 的日期詞
    expect(sc).toContain("11月3日"); // data 日期衍生
    expect(getDisplayText(sc)).toBe("討論內容\n2026-11-03");
  });

  it("無日期時僅顯示段 + 空衍生詞；兩者皆空回 ''", () => {
    expect(buildSearchContent("標題", { a: "內容" })).toBe(`內容${SEARCH_CONTENT_SEPARATOR}`);
    expect(buildSearchContent("標題", {})).toBe("");
  });

  it("分類名進入 suffix 段（TASK-012）：顯示段不變、snippet 不會出現分類名", () => {
    const sc = buildSearchContent("橙的營養", { note: "維他命 C" }, ["食物", "水果", "橙"]);
    expect(getDisplayText(sc)).toBe("維他命 C");
    expect(sc).toContain("食物");
    expect(sc).toContain("水果");
    expect(sc).toContain("橙");
  });

  it("無分類名時輸出與舊版完全一致（byte-for-byte 相容）", () => {
    expect(buildSearchContent("標題", { a: "內容" })).toBe(
      buildSearchContent("標題", { a: "內容" }, []),
    );
  });

  it("只有分類名、data 為空 → 回非空字串、顯示段為空", () => {
    const sc = buildSearchContent("標題", {}, ["水果"]);
    expect(sc).toBe(`${SEARCH_CONTENT_SEPARATOR}水果`);
    expect(getDisplayText(sc)).toBe("");
  });

  it("分類名剝控制字元、trim、去重", () => {
    const sc = buildSearchContent("標題", {}, [" 水果 ", "水果", "食物"]);
    expect(sc).toBe(`${SEARCH_CONTENT_SEPARATOR}水果 食物`);
  });
});

describe("tokenizeQuery", () => {
  it("空白/全形空白切分、剝控制字元、case-insensitive 去重", () => {
    expect(tokenizeQuery("  甲　乙 乙 A a ")).toEqual(["甲", "乙", "A"]);
  });

  it("上限 10 詞", () => {
    const q = Array.from({ length: 15 }, (_, i) => `詞${i}`).join(" ");
    expect(tokenizeQuery(q)).toHaveLength(10);
  });

  it("全空白回空陣列", () => {
    expect(tokenizeQuery("  　 ")).toEqual([]);
  });
});

describe("escapeLikePattern", () => {
  it("先 escape 反斜線再 % _", () => {
    expect(escapeLikePattern("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });
});

describe("matchesAllTerms / countTitleMatches", () => {
  const indexText = buildSearchContent("會議 2026-11-02", { note: "網頁 layout 修正" });

  it("每詞 AND：全部命中才 true", () => {
    expect(matchesAllTerms("會議 2026-11-02", indexText, ["網頁", "layout"])).toBe(true);
    expect(matchesAllTerms("會議 2026-11-02", indexText, ["網頁", "不存在"])).toBe(false);
  });

  it("日期衍生詞命中（11月 對 2026-11-02）", () => {
    expect(matchesAllTerms("會議 2026-11-02", indexText, ["11月"])).toBe(true);
  });

  it("countTitleMatches 只算標題命中", () => {
    expect(countTitleMatches(["會議", "網頁"], "會議紀錄")).toBe(1);
  });
});

describe("findHighlightRanges", () => {
  it("字面比對（case-insensitive）", () => {
    expect(findHighlightRanges("Web layout 網頁", ["web", "網頁"])).toEqual([
      { start: 0, end: 3 },
      { start: 11, end: 13 },
    ]);
  });

  it("日期感知：11月 高亮 raw 日期 2026-11-02；重疊合併", () => {
    expect(findHighlightRanges("改於 2026-11-02 前", ["11月"])).toEqual([
      { start: 3, end: 13 },
    ]);
  });

  it("日期詞帶日/年時精確比對", () => {
    expect(findHighlightRanges("2026-11-02 與 2025-11-02", ["2026年11月"])).toEqual([
      { start: 0, end: 10 },
    ]);
  });
});

describe("makeSnippet", () => {
  const longText =
    "前段文字。今日改動總結：網頁 layout 修正，後段還有更多內容但應該被截斷掉。" +
    "再補一段更長更長更長更長更長更長更長更長更長更長更長更長更長更長更長更長更長更長更長更長";

  it("以第一個命中為中心開窗、加省略號", () => {
    const snippet = makeSnippet(longText, ["網頁"]);
    expect(snippet).not.toBeNull();
    expect(snippet).toContain("網頁 layout 修正");
    expect(snippet!.length).toBeLessThanOrEqual(122); // 120 + 兩側 …
  });

  it("短文字無省略號", () => {
    expect(makeSnippet("網頁修正", ["網頁"])).toBe("網頁修正");
  });

  it("無命中（如向量同義詞命中）→ 前導摘錄", () => {
    expect(makeSnippet("第一句 第二句", ["不存在"])).toBe("第一句 第二句");
  });

  it("空白文字回 null", () => {
    expect(makeSnippet("   ", ["x"])).toBeNull();
  });

  it("日期詞命中時高亮 raw 日期片段", () => {
    const snippet = makeSnippet("修改日子是 2026-11-02 之後", ["11月"]);
    expect(snippet).toBe("修改日子是 2026-11-02 之後");
    expect(findHighlightRanges(snippet!, ["11月"])).toEqual([{ start: 6, end: 16 }]);
  });
});

describe("buildDisplayText", () => {
  it("字串值以 \\n 連接", () => {
    expect(buildDisplayText({ a: "一", b: ["二", 3] })).toBe("一\n二\n3");
  });
});
