import { describe, expect, it } from "vitest";
import { verifyAdminDbToken } from "@/server/security/admin-db-token";

/**
 * verifyAdminDbToken（TASK-011）：常數時間 token 比較
 * 核心安全邏輯必測：長度不等不得拋 RangeError、缺失一律 false
 */
describe("verifyAdminDbToken", () => {
  it("相同 token → true", () => {
    const token = "a".repeat(64);
    expect(verifyAdminDbToken(token, token)).toBe(true);
  });

  it("同長度不同內容 → false", () => {
    expect(verifyAdminDbToken("a".repeat(64), "b".repeat(64))).toBe(false);
  });

  it("provided 比 expected 短/長 → false 且不拋 RangeError", () => {
    expect(() => verifyAdminDbToken("short", "a".repeat(64))).not.toThrow();
    expect(verifyAdminDbToken("short", "a".repeat(64))).toBe(false);
    expect(verifyAdminDbToken("a".repeat(64), "short")).toBe(false);
  });

  it("expected 為 undefined / 空字串 → false（未設定 ADMIN_DB_TOKEN）", () => {
    expect(verifyAdminDbToken("a".repeat(64), undefined)).toBe(false);
    expect(verifyAdminDbToken("a".repeat(64), "")).toBe(false);
  });

  it("provided 為 undefined / null / 陣列 → false", () => {
    expect(verifyAdminDbToken(undefined, "a".repeat(64))).toBe(false);
    expect(verifyAdminDbToken(null, "a".repeat(64))).toBe(false);
    expect(verifyAdminDbToken(["a"], "a".repeat(64))).toBe(false);
    expect(verifyAdminDbToken("", "a".repeat(64))).toBe(false);
  });

  it("Unicode / 空白 / URL 特殊字元 token 正常比較", () => {
    const unicode = "密碼🔒-token_+/= 中文";
    expect(verifyAdminDbToken(unicode, unicode)).toBe(true);
    expect(verifyAdminDbToken(unicode, "different")).toBe(false);
  });

  it("32 字元（env 下限）token → true", () => {
    const token = "c".repeat(32);
    expect(verifyAdminDbToken(token, token)).toBe(true);
  });
});
