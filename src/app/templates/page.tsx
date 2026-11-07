import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { TemplateDeleteButton } from "@/components/template-delete-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "範本管理 | Nexus" };

/**
 * 範本管理列表（TASK-008）：僅 Admin（頁面層 notFound，service 層再驗）
 */
const createCaller = createCallerFactory(appRouter);

export default async function TemplatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") notFound();

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });
  const templates = await caller.template.list();

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">範本管理</h1>
        <span className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← 回首頁
          </Link>
          <Link href="/templates/new" className={buttonVariants({ variant: "outline" })}>
            ＋ 新增範本
          </Link>
        </span>
      </header>

      {templates.length === 0 ? (
        <p className="py-16 text-center text-zinc-500">尚無範本，點右上角建立第一個範本</p>
      ) : (
        <ul className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="break-all font-medium">{t.name}</span>
                    <span className="truncate text-sm text-zinc-500">
                      {t.description ? `${t.description}・` : ""}
                      {t.fields.length} 個欄位・更新於 {t.updatedAt.toLocaleString("zh-Hant-TW")}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/templates/${t.id}/edit`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      編輯
                    </Link>
                    <TemplateDeleteButton templateId={t.id} />
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
