import { db } from "@/server/db";

/**
 * 健康檢查（infra.md）：app + db 狀態
 * NPM / Docker healthcheck 使用
 */
export async function GET() {
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  return Response.json(
    {
      status: "ok",
      db: dbOk ? "up" : "down",
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  );
}
