import { initTRPC, TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { getDb } from "@/server/db";

/**
 * tRPC 初始化（依 .claude/CLAUDE.backend.md 分層）
 * procedure 五步驟：Zod 驗證 → session 檢查 → 權限檢查 → service → DTO
 * session 由 route handler 內 auth() 取得後傳入（避免 next/headers 在非 Request 上下文失效）
 */
export async function createTRPCContext(opts: { headers: Headers; session: Session | null }) {
  return { db: getDb(), headers: opts.headers, session: opts.session };
}

const t = initTRPC.context<typeof createTRPCContext>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/** 受保護 procedure：未登入一律 UNAUTHORIZED */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
