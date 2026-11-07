import { healthRouter } from "@/server/trpc/routers/health";
import { recordRouter } from "@/server/trpc/routers/record";
import { relationRouter } from "@/server/trpc/routers/relation";
import { templateRouter } from "@/server/trpc/routers/template";
import { router } from "@/server/trpc/trpc";

export const appRouter = router({
  health: healthRouter,
  record: recordRouter,
  relation: relationRouter,
  template: templateRouter,
});

export type AppRouter = typeof appRouter;
