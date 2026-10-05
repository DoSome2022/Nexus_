import { PrismaPg } from "@prisma/adapter-pg";
import { getEnv } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma Client lazy singleton
 * - Prisma 7 起 client 需 driver adapter（@prisma/adapter-pg）
 * - 延遲到首次呼叫才建立：next build 的 page data 收集階段會執行
 *   route module 程式碼，builder 內無 .env，top-level 連線會讓 build 炸掉
 * - 查詢一律在 service / repository 層使用，禁止元件直接呼叫
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

export function getDb(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;

  const client = createClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}
