import { createHash, timingSafeEqual } from "node:crypto";

/**
 * /admin/db 的 URL token 常數時間比較（TASK-011）
 * - 任一邊缺失 → false（ADMIN_DB_TOKEN 未設定時頁面一律 404）
 * - 兩邊先 SHA-256 成 32 bytes 再 timingSafeEqual：長度不同不會拋 RangeError，
 *   也避免直接字串比較的時序差異
 */
export function verifyAdminDbToken(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  if (!expected || expected.length === 0) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
