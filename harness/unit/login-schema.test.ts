import { describe, expect, it } from "vitest";
import { loginSchema } from "@/lib/schemas/login";

/**
 * 登入 schema 單元測試（TASK-002）
 */
describe("loginSchema", () => {
  it("合法 email + 密碼通過", () => {
    const r = loginSchema.safeParse({ email: "admin@nexus.local", password: "password123" });
    expect(r.success).toBe(true);
  });

  it("非法 email 被拒", () => {
    const r = loginSchema.safeParse({ email: "not-an-email", password: "password123" });
    expect(r.success).toBe(false);
  });

  it("email 為空被拒", () => {
    const r = loginSchema.safeParse({ email: "", password: "password123" });
    expect(r.success).toBe(false);
  });

  it("密碼短於 8 字元被拒", () => {
    const r = loginSchema.safeParse({ email: "a@b.co", password: "short" });
    expect(r.success).toBe(false);
  });

  it("密碼超過 72 字元被拒（bcrypt 上限）", () => {
    const r = loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(73) });
    expect(r.success).toBe(false);
  });
});
