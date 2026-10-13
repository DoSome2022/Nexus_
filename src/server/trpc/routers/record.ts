import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertWriteAllowed } from "@/server/trpc/lib/assert-write-allowed";
import { checkRateLimit } from "@/server/security/rate-limit";
import {
  confirmDeleteSchema,
  createRecordSchema,
  deleteRequestSchema,
  restoreSchema,
  searchInputSchema,
  updateRecordSchema,
} from "@/lib/schemas/record";
import {
  confirmDelete,
  createRecord,
  getRecord,
  listTrash,
  requestDelete,
  restoreRecord,
  searchRecords,
  updateRecord,
} from "@/server/services/record-service";
import type { PermissionActor } from "@/server/security/permissions";

/**
 * Record router（TASK-003 / TASK-005）
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
      assertWriteAllowed(actor.id);
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

  update: protectedProcedure
    .input(updateRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return updateRecord(input, actor);
    }),

  requestDelete: protectedProcedure
    .input(deleteRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return requestDelete(input.id, actor);
    }),

  confirmDelete: protectedProcedure
    .input(confirmDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return confirmDelete(input.id, input.token, actor);
    }),

  listTrash: protectedProcedure.query(async ({ ctx }) => {
    const actor = actorFromCtx(ctx);
    return listTrash(actor);
  }),

  restore: protectedProcedure
    .input(restoreSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return restoreRecord(input.id, actor);
    }),
});
