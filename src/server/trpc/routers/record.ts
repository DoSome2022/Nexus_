import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { checkRateLimit } from "@/server/security/rate-limit";
import { createRecordSchema, searchInputSchema } from "@/lib/schemas/record";
import { createRecord, getRecord, searchRecords } from "@/server/services/record-service";
import type { PermissionActor } from "@/server/security/permissions";

/**
 * Record router（TASK-003）
 * 五步驟：Zod → session（protectedProcedure）→ rate limit → service → DTO
 */
function actorFromCtx(ctx: { session: { user: { id: string; role: "ADMIN" | "USER" } } | null }): PermissionActor {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { id: user.id, role: user.role };
}

export const recordRouter = router({
  create: protectedProcedure
    .input(createRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      // 寫入 rate limit：30/min/user（CLAUDE.security.md）
      if (!checkRateLimit(`write:${actor.id}`, { limit: 30, windowMs: 60_000 })) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "寫入過於頻繁，請稍後再試" });
      }
      return createRecord(input, actor);
    }),

  search: protectedProcedure
    .input(searchInputSchema)
    .query(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      // 搜尋 rate limit：60/min/user
      if (!checkRateLimit(`search:${actor.id}`, { limit: 60, windowMs: 60_000 })) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "搜尋過於頻繁，請稍後再試" });
      }
      return searchRecords(input.q, actor, input.limit);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      return getRecord(input.id, actor);
    }),
});
