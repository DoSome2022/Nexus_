import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { TemplateForm } from "@/components/template-form";

export const metadata: Metadata = { title: "新增範本 | Nexus" };

/**
 * 新增範本頁（TASK-008）：僅 Admin
 */
export default async function NewTemplatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") notFound();

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link
        href="/templates"
        className="self-start text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← 回範本管理
      </Link>
      <TemplateForm mode="create" />
    </main>
  );
}
