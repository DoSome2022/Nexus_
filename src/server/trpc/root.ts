import { healthRouter } from "@/server/trpc/routers/health";
import { recordRouter } from "@/server/trpc/routers/record";
import { router } from "@/server/trpc/trpc";

export const appRouter = router({
  health: healthRouter,
  record: recordRouter,
});

export type AppRouter = typeof appRouter;
