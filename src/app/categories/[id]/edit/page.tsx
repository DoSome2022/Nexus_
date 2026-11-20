import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { CategoryForm } from "@/components/category-form";

export const metadata: Metadata = { title: "編輯分類 | Nexus" };

/**
 * 編輯分類（TASK-012）：作者或 Admin（browse 的 canManage）
 * 無權 → 404（不洩漏管理介面）
 */
const createCaller = createCallerFactory(appRouter);

export default async function EditCategoryPage({
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
  if (!browse.canManage) notFound();

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link
        href={`/categories/${id}`}
        className="self-start text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← 回分類
      </Link>
      <CategoryForm
        mode="edit"
        categoryId={id}
        initialValues={{
          name: browse.category.name,
          parentId: browse.category.parentId ?? "",
        }}
      />
    </main>
  );
}
