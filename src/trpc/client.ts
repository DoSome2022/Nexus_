import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/server/trpc/root";

/**
 * tRPC client（TASK-003）：server 端（非 React 元件）直接呼叫用
 * React 元件請用 src/trpc/react.tsx 的 hooks
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
