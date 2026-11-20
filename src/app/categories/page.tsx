import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { buildCategoryTree } from "@/lib/category-tree";
import { CategoryTreeView } from "@/components/category-tree-view";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "分類 | Nexus" };

/**
 * 分類總覽（TASK-012）：全站分類樹（任何登入者可見）
 * 全樹縮排顯示，每節點連結到 /categories/[id]
 */
const createCaller = createCallerFactory(appRouter);

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });
  const categories = await caller.category.list();
  const tree = buildCategoryTree(categories);

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">分類</h1>
        <span className="flex items-center gap-2">
          <Link href="/categories/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
            ＋ 新增分類
          </Link>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← 回首頁
          </Link>
        </span>
      </header>

      {tree.length === 0 ? (
        <p className="py-16 text-center text-zinc-500">
          尚無分類，點右上角建立第一個分類
        </p>
      ) : (
        <Card className="mx-auto w-full max-w-2xl">
          <CardContent className="py-4">
            <CategoryTreeView nodes={tree} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
