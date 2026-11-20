import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertWriteAllowed } from "@/server/trpc/lib/assert-write-allowed";
import {
  categoryCreateSchema,
  categoryIdSchema,
  categoryLinkSchema,
  categoryUpdateSchema,
} from "@/lib/schemas/category";
import {
  browseCategory,
  createCategory,
  deleteCategory,
  duplicateCategory,
  linkRecordCategory,
  listCategories,
  unlinkRecordCategory,
  updateCategory,
} from "@/server/services/category-service";
import type { PermissionActor } from "@/server/security/permissions";

/**
 * Category router（TASK-012）
 * - 讀取（list/browse）：任何登入者（分類全站可見）
 * - 寫入（create/update/delete/link/unlink）：assertWriteAllowed + service 權限檢查
 */
function actorFromCtx(ctx: { session: { user: { id: string; role: "ADMIN" | "USER" } } | null }): PermissionActor {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { id: user.id, role: user.role };
}

export const categoryRouter = router({
  list: protectedProcedure.query(async () => {
    return listCategories();
  }),

  browse: protectedProcedure.input(categoryIdSchema).query(async ({ ctx, input }) => {
    const actor = actorFromCtx(ctx);
    return browseCategory(input.id, actor);
  }),

  create: protectedProcedure
    .input(categoryCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return createCategory(input, actor);
    }),

  update: protectedProcedure
    .input(categoryUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return updateCategory(input, actor);
    }),

  delete: protectedProcedure
    .input(categoryIdSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return deleteCategory(input.id, actor);
    }),

  link: protectedProcedure
    .input(categoryLinkSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return linkRecordCategory(input, actor);
    }),

  unlink: protectedProcedure
    .input(categoryLinkSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return unlinkRecordCategory(input, actor);
    }),

  // 複製分類（TASK-013）：連同子分類樹與資料連結；人人可複製
  duplicate: protectedProcedure
    .input(categoryIdSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = actorFromCtx(ctx);
      assertWriteAllowed(actor.id);
      return duplicateCategory(input.id, actor);
    }),
});
