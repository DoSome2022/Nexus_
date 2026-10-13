import { handlers } from "@/server/auth";

/**
 * Auth.js v5 route handler（/api/auth/*：signin / signout / session / csrf）
 */
export const { GET, POST } = handlers;
