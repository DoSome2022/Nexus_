import bcrypt from "bcryptjs";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "@/server/db";
import { loginSchema } from "@/lib/schemas/login";
import { checkLoginRateLimit } from "@/server/security/rate-limit";
import { logOperation } from "@/server/audit/operation-log";
import { logger } from "@/server/lib/logger";
import type { Role } from "@/generated/prisma/enums";

/**
 * Auth.js v5 設定（TASK-002）
 * - Credentials + JWT session（id/email/role 進 token，maxAge 7 天）
 * - authorize：Zod 驗證 → rate limit（5/min/IP）→ bcrypt.compare（常數時間）
 * - 帳號不存在也跑一次 bcrypt（統一回應時間，防帳號列舉）
 * - 登入成功寫 OperationLog（action: LOGIN）
 */

/** 假 hash（cost 12）：帳號不存在時做一次等價比較，維持回應時間一致 */
const DUMMY_HASH = "$2b$12$CkWiZSLcYNwkOtDj3svj/ueY1rmYaZ.eKnb0X47.qpCSznSEw8Trm";

declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: DefaultSession["user"] & { id: string; role: Role };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 }, // 7 天
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "密碼", type: "password" },
      },
      async authorize(credentials, request) {
        const startedAt = Date.now();
        const ip = getClientIp(request);
        const userAgent = request.headers.get("user-agent");

        // 1. Zod 驗證（輸入永不信任）
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          logger.warn("login_rejected", { reason: "invalid_input", ip });
          return null;
        }
        const { email, password } = parsed.data;

        // 2. Rate limit：5/min/IP（無論成敗都計數）
        if (!checkLoginRateLimit(ip)) {
          logger.warn("login_rate_limited", { ip });
          return null;
        }

        // 3. 查使用者；不存在/已軟刪除 → 假 bcrypt 後統一拒絕
        const db = getDb();
        const user = await db.user.findUnique({
          where: { email },
          select: { id: true, email: true, passwordHash: true, role: true, deletedAt: true },
        });
        if (!user || user.deletedAt) {
          await bcrypt.compare(password, DUMMY_HASH);
          logger.warn("login_failed", { ip, userAgent, reason: "user_not_found" });
          return null;
        }

        // 4. 密碼比對（bcrypt.compare 常數時間）
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          logger.warn("login_failed", { ip, userAgent, reason: "bad_password" });
          return null;
        }

        // 5. 審計：登入成功寫 OperationLog（失敗無 actor，僅寫結構化 logger）
        await logOperation({
          actorId: user.id,
          action: "LOGIN",
          targetType: "USER",
          targetId: user.id,
          durationMs: Date.now() - startedAt,
          ip,
          userAgent,
        });

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
});
