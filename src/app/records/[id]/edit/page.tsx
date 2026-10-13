import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { RecordEditForm } from "@/components/record-edit-form";

/**
 * 編輯頁（TASK-005）：service 層 canEdit 檢查（get 成功但 canEdit=false 也擋）
 */
const createCaller = createCallerFactory(appRouter);

export default async function EditRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });

  let record;
  try {
    record = await caller.record.get({ id });
  } catch {
    notFound();
  }
  if (!record.canEdit) notFound();

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link href={`/records/${id}`} className="self-start text-sm text-zinc-500 hover:text-zinc-700">
        ← 回檢視頁
      </Link>
      <RecordEditForm
        id={id}
        initialTitle={record.title}
        initialDataJson={JSON.stringify(record.data, null, 2)}
        isPublic={record.isPublic}
        isEditableByOthers={record.isEditableByOthers}
        isConfidential={record.isConfidential}
      />
    </main>
  );
}
