import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { TemplateForm } from "@/components/template-form";

export const metadata: Metadata = { title: "編輯範本 | Nexus" };

/**
 * 編輯範本頁（TASK-008）：僅 Admin；範本不存在一律 404
 */
const createCaller = createCallerFactory(appRouter);

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") notFound();

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });
  const templates = await caller.template.list();
  const template = templates.find((t) => t.id === id);
  if (!template) notFound();

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link
        href="/templates"
        className="self-start text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← 回範本管理
      </Link>
      <TemplateForm
        mode="edit"
        templateId={template.id}
        initialValues={{
          name: template.name,
          description: template.description ?? "",
          fields: template.fields,
        }}
      />
    </main>
  );
}
