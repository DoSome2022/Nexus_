import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { CategoryForm } from "@/components/category-form";

export const metadata: Metadata = { title: "新增分類 | Nexus" };

/**
 * 新增分類（TASK-012）：任何登入者可建
 * ?parent=<id> 預選上層分類（不存在則忽略）
 */
const createCaller = createCallerFactory(appRouter);

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<{ parent?: string }>;
}) {
  const { parent } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  let parentHint: string | undefined;
  if (parent) {
    const caller = createCaller({ db: getDb(), headers: new Headers(), session });
    const categories = await caller.category.list();
    parentHint = categories.some((c) => c.id === parent) ? parent : undefined;
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link href="/categories" className="self-start text-sm text-zinc-500 hover:text-zinc-700">
        ← 回分類列表
      </Link>
      <CategoryForm mode="create" parentHint={parentHint} />
    </main>
  );
}
