import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clearRateLimitStore } from "@/server/security/rate-limit";

/**
 * Rate limit 單元測試（TASK-002）：滑動視窗、key 隔離
 * `now` 注入 clock，store 在 beforeEach 清空
 */
describe("checkRateLimit（滑動視窗）", () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it("視窗內前 N 次通過，第 N+1 次被拒", () => {
    let t = 1_000;
    const now = () => t;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("ip1", { now, limit: 5, windowMs: 60_000 })).toBe(true);
      t += 1_000;
    }
    expect(checkRateLimit("ip1", { now, limit: 5, windowMs: 60_000 })).toBe(false);
  });

  it("視窗滑動後舊紀錄過期，可再通過", () => {
    let t = 0;
    const now = () => t;
    for (let i = 0; i < 5; i++) {
      checkRateLimit("ip2", { now, limit: 5, windowMs: 60_000 });
      t += 1;
    }
    expect(checkRateLimit("ip2", { now, limit: 5, windowMs: 60_000 })).toBe(false);
    t += 60_001; // 全部過期
    expect(checkRateLimit("ip2", { now, limit: 5, windowMs: 60_000 })).toBe(true);
  });

  it("不同 key 互不影響", () => {
    const t = 0;
    const now = () => t;
    for (let i = 0; i < 5; i++) {
      checkRateLimit("ipA", { now });
    }
    expect(checkRateLimit("ipA", { now })).toBe(false);
    expect(checkRateLimit("ipB", { now })).toBe(true);
  });
});
