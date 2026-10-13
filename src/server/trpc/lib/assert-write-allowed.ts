import { TRPCError } from "@trpc/server";
import { checkRateLimit } from "@/server/security/rate-limit";

/** 寫入 rate limit：30/min/user（CLAUDE.security.md；record/relation router 共用） */
export function assertWriteAllowed(actorId: string): void {
  if (!checkRateLimit(`write:${actorId}`, { limit: 30, windowMs: 60_000 })) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "寫入過於頻繁，請稍後再試" });
  }
}
