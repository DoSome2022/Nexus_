import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertWriteAllowed } from "@/server/trpc/lib/assert-write-allowed";
import { checkRateLimit } from "@/server/security/rate-limit";
import {
  relationCreateSchema,
  relationDeleteSchema,
  relationSuggestSchema,
} from "@/lib/schemas/relation";
import { createRelation, deleteRelation } from "@/server/services/relation-service";
import { suggestRelations } from "@/server/services/record-service";
import type { PermissionActor } from "@/server/security/permissions";

/**
 * RecordRelation router（TASK-007）
 * 五步驟：Zod → session（protectedProcedure）→ rate limit → service → DTO
 */
function actorFromCtx(ctx: {
  session: { user: { id: string; role: "ADMIN" | "USER" } } | null;
}): PermissionActor {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { id: user.id, role: user.role };
}

export const relationRouter = router({
  suggest: protectedProcedure
    .input(relationSuggestSchema)
    .query(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      // 建議 rate limit：60/min/user（同 search）
      if (!checkRateLimit(`suggest:${actor.id}`, { limit: 60, windowMs: 60_000 })) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "查詢過於頻繁，請稍後再試" });
      }
      return suggestRelations(input.id, actor);
    }),

  create: protectedProcedure
    .input(relationCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return createRelation(input, actor);
    }),

  delete: protectedProcedure
    .input(relationDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return deleteRelation(input.id, actor);
    }),
});
