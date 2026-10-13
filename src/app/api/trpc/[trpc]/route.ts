import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/root";
import { createTRPCContext } from "@/server/trpc/trpc";
import { auth } from "@/server/auth";

/**
 * tRPC HTTP handler（POST，CSRF 由 Auth.js + 同源策略防護）
 * session 在此取得後傳入 context（TASK-002）
 */
const handler = async (req: Request) => {
  const session = await auth();
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers, session }),
  });
};

export { handler as GET, handler as POST };
