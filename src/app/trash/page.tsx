import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { RestoreButton } from "@/components/restore-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "垃圾桶 | Nexus" };

/**
 * 垃圾桶（TASK-005）：僅 Admin 可見（service 層強制）；列表 + 恢復
 */
const createCaller = createCallerFactory(appRouter);

export default async function TrashPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") notFound();

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });
  const items = await caller.record.listTrash();

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">垃圾桶</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← 回首頁
        </Link>
      </header>

      {items.length === 0 ? (
        <p className="py-16 text-center text-zinc-500">垃圾桶是空的</p>
      ) : (
        <ul className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {items.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <span className="break-all font-medium">{r.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {r.isConfidential ? <Badge variant="destructive">保密</Badge> : null}
                    <RestoreButton recordId={r.id} />
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
