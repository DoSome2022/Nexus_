import { describe, expect, it } from "vitest";
import {
  DB_OVERVIEW_TABLE_CONFIG,
  DB_OVERVIEW_TABLES,
  formatDbCell,
  parseDbOverviewLimit,
  parseDbOverviewLimits,
} from "@/lib/db-overview";

/**
 * src/lib/db-overview.ts 純函式（TASK-011）
 * 核心：limit 參數安全解析（不可被 parseInt 漏洞繞過）、cell 格式化、config invariant
 */
describe("parseDbOverviewLimit", () => {
  it("合法值 20/100/500 對應回傳", () => {
    expect(parseDbOverviewLimit("20")).toBe(20);
    expect(parseDbOverviewLimit("100")).toBe(100);
    expect(parseDbOverviewLimit("500")).toBe(500);
  });

  it("undefined / null / 空字串 → 預設 20", () => {
    expect(parseDbOverviewLimit(undefined)).toBe(20);
    expect(parseDbOverviewLimit(null)).toBe(20);
    expect(parseDbOverviewLimit("")).toBe(20);
  });

  it("非法字串（含 parseInt 陷阱）→ 20", () => {
    expect(parseDbOverviewLimit("50")).toBe(20);
    expect(parseDbOverviewLimit("0")).toBe(20);
    expect(parseDbOverviewLimit("-1")).toBe(20);
    expect(parseDbOverviewLimit("abc")).toBe(20);
    expect(parseDbOverviewLimit("20abc")).toBe(20);
    expect(parseDbOverviewLimit("1e2")).toBe(20);
    expect(parseDbOverviewLimit(" 100")).toBe(20);
  });

  it("陣列取第一個；空陣列 → 20", () => {
    expect(parseDbOverviewLimit(["100", "20"])).toBe(100);
    expect(parseDbOverviewLimit([])).toBe(20);
  });
});

describe("parseDbOverviewLimits", () => {
  it("只帶 limit_record=100 → record 100、其他全部 20", () => {
    const limits = parseDbOverviewLimits({ limit_record: "100" });
    expect(limits.record).toBe(100);
    for (const table of DB_OVERVIEW_TABLES) {
      if (table !== "record") expect(limits[table]).toBe(20);
    }
  });

  it("全部表參數正確映射", () => {
    const params: Record<string, string> = {};
    for (const [i, table] of DB_OVERVIEW_TABLES.entries()) {
      params[`limit_${table}`] = ["20", "100", "500"][i % 3] ?? "20";
    }
    const limits = parseDbOverviewLimits(params);
    for (const [i, table] of DB_OVERVIEW_TABLES.entries()) {
      const expected: number[] = [20, 100, 500];
      expect(limits[table]).toBe(expected[i % 3]);
    }
  });

  it("空參數 → 全部 20", () => {
    const limits = parseDbOverviewLimits({});
    for (const table of DB_OVERVIEW_TABLES) {
      expect(limits[table]).toBe(20);
    }
  });
});

describe("formatDbCell", () => {
  it("null / undefined → null cell「—」", () => {
    expect(formatDbCell(null)).toEqual({ kind: "null", text: "—" });
    expect(formatDbCell(undefined)).toEqual({ kind: "null", text: "—" });
  });

  it("字串 / 數字 / 布林 → text", () => {
    expect(formatDbCell("hello")).toEqual({ kind: "text", text: "hello" });
    expect(formatDbCell(42)).toEqual({ kind: "text", text: "42" });
    expect(formatDbCell(true)).toEqual({ kind: "text", text: "true" });
  });

  it("Date → ISO 字串", () => {
    const d = new Date("2026-11-02T04:35:00.754Z");
    expect(formatDbCell(d)).toEqual({ kind: "text", text: d.toISOString() });
  });

  it("物件 / 陣列 → pretty JSON", () => {
    const cell = formatDbCell({ b: 1, a: [1, 2] });
    expect(cell.kind).toBe("json");
    expect(cell.text).toBe(JSON.stringify({ b: 1, a: [1, 2] }, null, 2));
  });

  it("circular object → [unserializable] 不拋錯", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const cell = formatDbCell(obj);
    expect(cell.kind).toBe("json");
    expect(cell.text).toBe("[unserializable]");
  });
});

describe("DB_OVERVIEW_TABLE_CONFIG", () => {
  it("全部表齊全且順序固定、欄位不重複", () => {
    expect(DB_OVERVIEW_TABLE_CONFIG.map((c) => c.key)).toEqual([...DB_OVERVIEW_TABLES]);
    for (const config of DB_OVERVIEW_TABLE_CONFIG) {
      expect(config.columns.length).toBe(new Set(config.columns).size);
    }
  });

  it("record 表依需求只顯示 title 與 searchContent", () => {
    const record = DB_OVERVIEW_TABLE_CONFIG.find((c) => c.key === "record");
    expect(record?.columns).toEqual(["title", "searchContent"]);
  });
});
