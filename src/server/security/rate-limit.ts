/**
 * Rate limit（TASK-002）：in-memory 滑動視窗
 * - 登入：5/min/IP（CLAUDE.security.md）
 * - 限制：單實例有效、重啟歸零；多實例需 Redis/DB（記錄於 TASK-002 風險）
 * - `now` 可注入 clock 供單元測試
 */
interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

export function checkRateLimit(key: string, opts: RateLimitOptions = {}): boolean {
  const { limit = 5, windowMs = 60_000, now = Date.now } = opts;
  const ts = now();

  pruneIfNeeded(ts);

  const entry = store.get(key);
  if (!entry) {
    store.set(key, { timestamps: [ts] });
    return true;
  }

  const valid = entry.timestamps.filter((t) => ts - t < windowMs);
  if (valid.length >= limit) {
    store.set(key, { timestamps: valid });
    return false; // 超限
  }
  valid.push(ts);
  store.set(key, { timestamps: valid });
  return true;
}

/** 登入：5/min/IP（無論成敗都計數） */
export function checkLoginRateLimit(ip: string): boolean {
  return checkRateLimit(`login:${ip}`);
}

/** 防記憶體無限成長：超過 1000 個 key 時清掉閒置 > 10 分鐘的條目 */
function pruneIfNeeded(now: number): void {
  if (store.size <= 1000) return;
  for (const [k, v] of store) {
    const last = v.timestamps[v.timestamps.length - 1];
    if (last !== undefined && now - last > 600_000) store.delete(k);
  }
}

/** 測試用：清空 store */
export function clearRateLimitStore(): void {
  store.clear();
}
