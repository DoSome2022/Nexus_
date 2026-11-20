import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/env.ts 單元測試（核心邏輯必測，Solo 模式）
 * 驗證：Zod 啟動驗證、fail-fast、預設值
 */
const VALID_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public",
  AUTH_SECRET: "a".repeat(32),
  APP_URL: "http://localhost:3000",
};

function stubValidEnv() {
  for (const [k, v] of Object.entries(VALID_ENV)) {
    vi.stubEnv(k, v);
  }
  // 避免開發者 shell 環境污染測試（TASK-011）
  vi.stubEnv("ADMIN_DB_TOKEN", undefined);
}

async function loadEnv() {
  vi.resetModules();
  return (await import("@/env")).getEnv();
}

describe("src/env.ts", () => {
  beforeEach(() => {
    stubValidEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("合法環境變數通過驗證", async () => {
    const env = await loadEnv();
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.NODE_ENV).toBe("test");
  });

  it("缺少 DATABASE_URL 應 throw 並指向 .env.example", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(loadEnv()).rejects.toThrow(/環境變數驗證失敗/);
  });

  it("AUTH_SECRET 少於 32 字元應 throw", async () => {
    vi.stubEnv("AUTH_SECRET", "short");
    await expect(loadEnv()).rejects.toThrow(/AUTH_SECRET/);
  });

  it("NODE_ENV 未設定時預設 development", async () => {
    vi.stubEnv("NODE_ENV", undefined);
    const env = await loadEnv();
    expect(env.NODE_ENV).toBe("development");
  });

  it("ADMIN_DB_TOKEN 未設定時為 undefined（TASK-011，功能停用不影響啟動）", async () => {
    vi.stubEnv("ADMIN_DB_TOKEN", undefined);
    const env = await loadEnv();
    expect(env.ADMIN_DB_TOKEN).toBeUndefined();
  });

  it("ADMIN_DB_TOKEN 32 字元通過驗證", async () => {
    vi.stubEnv("ADMIN_DB_TOKEN", "b".repeat(32));
    const env = await loadEnv();
    expect(env.ADMIN_DB_TOKEN).toBe("b".repeat(32));
  });

  it("ADMIN_DB_TOKEN 少於 32 字元應 throw", async () => {
    vi.stubEnv("ADMIN_DB_TOKEN", "too-short");
    await expect(loadEnv()).rejects.toThrow(/ADMIN_DB_TOKEN/);
  });
});
