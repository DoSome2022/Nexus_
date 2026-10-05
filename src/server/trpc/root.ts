import { healthRouter } from "@/server/trpc/routers/health";
import { router } from "@/server/trpc/trpc";

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
