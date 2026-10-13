import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { SearchBar } from "@/components/search-bar";
import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 搜尋結果頁（TASK-003）：搜尋條置頂 + 列表；條件走 URL searchParams
 * Server Component 用 tRPC server caller 取資料（CLAUDE.frontend.md）
 */
const createCaller = createCallerFactory(appRouter);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const caller = createCaller({
    db: getDb(),
    headers: new Headers(),
    session,
  });

  const results = q ? await caller.record.search({ q }) : [];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar key={q ?? ""} variant="top" initialValue={q ?? ""} />
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{session.user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-4">
        {!q ? (
          <p className="py-16 text-center text-zinc-500">請輸入關鍵字開始搜尋</p>
        ) : results.length === 0 ? (
          <p className="py-16 text-center text-zinc-500">沒有數據</p>
        ) : (
          <ul className="mx-auto flex max-w-2xl flex-col gap-2">
            {results.map((r) => (
              <li key={r.id}>
                <Link href={`/records/${r.id}`} className="block">
                  <Card className="transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <CardContent className="flex items-center justify-between gap-3 py-4">
                      <span className="font-medium">{r.title}</span>
                      <span className="flex shrink-0 gap-1">
                        {r.isConfidential ? (
                          <Badge variant="destructive">保密</Badge>
                        ) : r.isPublic ? (
                          <Badge variant="secondary">公開</Badge>
                        ) : (
                          <Badge variant="outline">私有</Badge>
                        )}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
