import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * seed admin 帳號（TASK-002）
 * 用法：npm run db:seed
 * - ADMIN_EMAIL / ADMIN_PASSWORD 可從 env 覆寫
 * - 未設密碼則隨機產生並顯示一次（bcrypt cost 12）
 * - 已存在則略過（不覆寫密碼）
 */
async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@nexus.local";
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL 未設定（請確認 .env）");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`使用者 ${email} 已存在（role=${existing.role}），略過`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email, passwordHash, name: "管理員", role: "ADMIN" },
    });
    console.log(`已建立 admin 帳號：${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`隨機密碼（僅顯示一次，請立即登入並更換）：${password}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("seed 失敗:", err);
  process.exit(1);
});
