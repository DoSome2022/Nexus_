import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryDeleteButton } from "@/components/category-delete-button";
import { CategoryDuplicateButton } from "@/components/category-duplicate-button";

export const metadata: Metadata = { title: "分類 | Nexus" };

/**
 * 分類瀏覽（TASK-012）：麵包屑路徑 + 子分類 + 此分類下的可讀資料
 * 點上層麵包屑逐層上跳（食物 → 水果 → 橙 的瀏覽方式）
 */
const createCaller = createCallerFactory(appRouter);

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });
  let browse;
  try {
    browse = await caller.category.browse({ id });
  } catch {
    notFound();
  }

  const { category, ancestors, children, records, canManage } = browse;

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <header className="flex items-center justify-between">
        <nav aria-label="麵包屑" className="flex flex-wrap items-center gap-1 text-sm">
          <Link href="/categories" className="text-zinc-500 hover:text-zinc-700">
            分類
          </Link>
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <span className="text-zinc-400">/</span>
              <Link href={`/categories/${a.id}`} className="text-zinc-500 hover:text-zinc-700">
                {a.name}
              </Link>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="text-zinc-400">/</span>
            <h1 className="text-xl font-semibold">{category.name}</h1>
          </span>
        </nav>
        <span className="flex items-center gap-2">
          <Link
            href={`/categories/new?parent=${category.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            ＋ 新增子分類
          </Link>
          <CategoryDuplicateButton
            categoryId={category.id}
            categoryName={category.name}
            subtreeCategoryCount={browse.subtreeCategoryCount}
            subtreeLinkCount={browse.subtreeLinkCount}
          />
          {canManage ? (
            <>
              <Link
                href={`/categories/${category.id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                編輯
              </Link>
              <CategoryDeleteButton categoryId={category.id} linkCount={browse.linkCount} />
            </>
          ) : null}
        </span>
      </header>

      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="flex flex-col gap-4 py-4">
          {children.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">子分類</h2>
              <ul className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/categories/${c.id}`}
                      className="inline-block rounded-md border border-zinc-200 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="text-sm font-medium">此分類下的資料</h2>
            {records.length === 0 ? (
              <p className="text-sm text-zinc-500">沒有資料</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {records.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      href={`/records/${r.id}`}
                      className="break-all underline-offset-2 hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span className="flex shrink-0 gap-1">
                      {r.isConfidential ? (
                        <Badge variant="destructive">保密</Badge>
                      ) : r.isPublic ? (
                        <Badge variant="secondary">公開</Badge>
                      ) : (
                        <Badge variant="outline">私有</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
