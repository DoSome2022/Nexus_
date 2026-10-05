import { z } from "zod";
import { publicProcedure, router } from "@/server/trpc/trpc";

export const healthRouter = router({
  check: publicProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      let dbOk = true;
      try {
        await ctx.db.$queryRaw`SELECT 1`;
      } catch {
        dbOk = false;
      }
      return {
        status: "ok",
        db: dbOk ? "up" : "down",
        timestamp: new Date().toISOString(),
      };
    }),
});
