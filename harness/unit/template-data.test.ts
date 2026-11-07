import { describe, expect, it } from "vitest";
import {
  buildRecordFormSchema,
  buildRecordTemplateSnapshot,
  parseRecordTemplateSnapshot,
  schemaMatchesData,
  serializeTemplateValues,
  toTemplateFormValues,
  type RecordTemplateSnapshot,
} from "@/lib/template-data";
import type { TemplateField } from "@/lib/schemas/template";

/**
 * template-data 純函式單元測試（TASK-008）
 */
const MEETING_FIELDS: TemplateField[] = [
  { name: "topic", label: "會議主題", type: "text", required: true },
  { name: "attendees", label: "出席人員", type: "list", required: false },
  { name: "attendee_count", label: "人數", type: "number", required: false },
  { name: "meeting_date", label: "日期", type: "date", required: false },
  { name: "done", label: "已完成", type: "boolean", required: true },
  { name: "notes", label: "備註", type: "textarea", required: false },
];

const SNAPSHOT: RecordTemplateSnapshot = {
  v: 1,
  templateName: "會議紀錄",
  fields: MEETING_FIELDS,
};

describe("buildRecordTemplateSnapshot / parseRecordTemplateSnapshot", () => {
  it("roundtrip：build 之後 parse 得回相同 snapshot", () => {
    const snapshot = buildRecordTemplateSnapshot({ name: "會議紀錄", fields: MEETING_FIELDS });
    expect(parseRecordTemplateSnapshot(snapshot)).toEqual(snapshot);
  });

  it("legacy 空物件 / 非物件 → null", () => {
    expect(parseRecordTemplateSnapshot({})).toBeNull();
    expect(parseRecordTemplateSnapshot(null)).toBeNull();
    expect(parseRecordTemplateSnapshot("v1")).toBeNull();
  });

  it("版本不符 / 欄位損壞 → null", () => {
    expect(parseRecordTemplateSnapshot({ ...SNAPSHOT, v: 2 })).toBeNull();
    expect(
      parseRecordTemplateSnapshot({ ...SNAPSHOT, fields: [{ name: "", label: "", type: "text" }] }),
    ).toBeNull();
  });
});

describe("schemaMatchesData", () => {
  const validData = {
    topic: "Q4 例會",
    attendees: ["Alice", "Bob"],
    attendee_count: 12,
    meeting_date: "2026-11-02",
    done: false,
    notes: "多行\n內容",
  };

  it("完全相符 → true", () => {
    expect(schemaMatchesData(SNAPSHOT, validData)).toBe(true);
  });

  it("選填欄位可缺（boolean required 無意義）", () => {
    expect(schemaMatchesData(SNAPSHOT, { topic: "t", done: false })).toBe(true);
  });

  it("缺必填欄位 → false", () => {
    expect(schemaMatchesData(SNAPSHOT, { ...validData, topic: undefined })).toBe(false);
  });

  it("未知欄位 → false", () => {
    expect(schemaMatchesData(SNAPSHOT, { ...validData, extra: 1 })).toBe(false);
  });

  it("型別不符 → false（number 給字串 / list 給非字串陣列 / date 格式錯）", () => {
    expect(schemaMatchesData(SNAPSHOT, { ...validData, attendee_count: "12" })).toBe(false);
    expect(schemaMatchesData(SNAPSHOT, { ...validData, attendees: [1, 2] })).toBe(false);
    expect(schemaMatchesData(SNAPSHOT, { ...validData, meeting_date: "11/02" })).toBe(false);
  });

  it("頂層陣列 / 非物件 → false", () => {
    expect(schemaMatchesData(SNAPSHOT, [validData])).toBe(false);
    expect(schemaMatchesData(SNAPSHOT, "topic")).toBe(false);
    expect(schemaMatchesData(SNAPSHOT, null)).toBe(false);
  });
});

describe("serializeTemplateValues", () => {
  it("型別轉換：number 轉數字、list 分割、boolean 恒寫入", () => {
    const out = serializeTemplateValues(MEETING_FIELDS, {
      topic: "  Q4 例會  ",
      attendees: "Alice, Bob，Carol",
      attendee_count: "12",
      meeting_date: "2026-11-02",
      done: false,
      notes: "備註",
    });
    expect(out).toEqual({
      topic: "Q4 例會",
      attendees: ["Alice", "Bob", "Carol"],
      attendee_count: 12,
      meeting_date: "2026-11-02",
      done: false,
      notes: "備註",
    });
  });

  it("空字串的選填欄位省略；boolean 未勾選仍寫 false", () => {
    const out = serializeTemplateValues(MEETING_FIELDS, {
      topic: "t",
      attendees: "",
      attendee_count: "",
      meeting_date: "",
      done: false,
      notes: "",
    });
    expect(out).toEqual({ topic: "t", done: false });
  });

  it("非數字忽略", () => {
    const out = serializeTemplateValues(MEETING_FIELDS, {
      topic: "t",
      attendees: "",
      attendee_count: "abc",
      meeting_date: "",
      done: false,
      notes: "",
    });
    expect(out).toEqual({ topic: "t", done: false });
  });
});

describe("toTemplateFormValues", () => {
  it("資料 → 表單值（number 轉字串、list 以逗號連接、缺值給空）", () => {
    const values = toTemplateFormValues(MEETING_FIELDS, {
      topic: "Q4 例會",
      attendees: ["Alice", "Bob"],
      attendee_count: 12,
      done: true,
    });
    expect(values).toEqual({
      topic: "Q4 例會",
      attendees: "Alice, Bob",
      attendee_count: "12",
      meeting_date: "",
      done: true,
      notes: "",
    });
  });

  it("非物件資料 → 全空值", () => {
    const values = toTemplateFormValues(MEETING_FIELDS, null);
    expect(values.topic).toBe("");
    expect(values.done).toBe(false);
  });
});

describe("buildRecordFormSchema", () => {
  it("JSON 模式（fields=null）：合法 JSON 通過、非法被拒", () => {
    const schema = buildRecordFormSchema(null);
    const base = {
      title: "t",
      data: {},
      visibility: "PRIVATE",
      isEditableByOthers: false,
    };
    expect(schema.safeParse({ ...base, dataJson: '{"a":1}' }).success).toBe(true);
    const bad = schema.safeParse({ ...base, dataJson: "{oops" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.path).toEqual(["dataJson"]);
    }
  });

  it("範本模式：必填/數字/日期驗證；合法通過", () => {
    const schema = buildRecordFormSchema(MEETING_FIELDS);
    const base = {
      title: "t",
      dataJson: '{"原始":1}',
      visibility: "PRIVATE",
      isEditableByOthers: false,
    };
    const valid = schema.safeParse({
      ...base,
      data: { topic: "t", attendees: "", attendee_count: "3", meeting_date: "2026-11-02", done: false, notes: "" },
    });
    expect(valid.success).toBe(true);

    const missing = schema.safeParse({ ...base, data: { done: false } });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues[0]?.path).toEqual(["data", "topic"]);
    }

    const badNumber = schema.safeParse({
      ...base,
      data: { topic: "t", attendee_count: "abc", done: false },
    });
    expect(badNumber.success).toBe(false);

    const badDate = schema.safeParse({
      ...base,
      data: { topic: "t", meeting_date: "11/02", done: false },
    });
    expect(badDate.success).toBe(false);
  });
});
