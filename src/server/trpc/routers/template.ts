import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertWriteAllowed } from "@/server/trpc/lib/assert-write-allowed";
import { templateInputSchema } from "@/lib/schemas/template";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "@/server/services/template-service";
import type { PermissionActor } from "@/server/security/permissions";

/**
 * Template router（TASK-008）
 * - list：所有登入者可用（建立資料時選範本）
 * - create/update/delete：僅 ADMIN（service 內再驗一次，雙重防護）
 * - 五步驟：Zod → session（protectedProcedure）→ rate limit → service → DTO
 */
function actorFromCtx(ctx: {
  session: { user: { id: string; role: "ADMIN" | "USER" } } | null;
}): PermissionActor {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { id: user.id, role: user.role };
}

function assertAdmin(actor: PermissionActor): void {
  if (actor.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 Admin 可管理範本" });
  }
}

export const templateRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const actor = actorFromCtx(ctx);
    return listTemplates(actor);
  }),

  create: protectedProcedure
    .input(templateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertAdmin(actor);
      assertWriteAllowed(actor.id);
      return createTemplate(input, actor);
    }),

  update: protectedProcedure
    .input(templateInputSchema.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertAdmin(actor);
      assertWriteAllowed(actor.id);
      const { id, ...rest } = input;
      return updateTemplate(rest, actor, id);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertAdmin(actor);
      assertWriteAllowed(actor.id);
      return deleteTemplate(input.id, actor);
    }),
});
