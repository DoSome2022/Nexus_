/**
 * Next.js 啟動 hook（Next 16 慣例：export register）
 * 用途：伺服器啟動時 fail-fast 驗證環境變數（.claude/CLAUDE.security.md）
 */
export async function register() {
  // 僅在真實 Node server 啟動時驗證；next build（Docker builder 無 .env）跳過
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    await import("./env").then((m) => m.getEnv());
  }
}
