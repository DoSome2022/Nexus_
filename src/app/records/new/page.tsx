import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { CreateRecordForm } from "@/components/create-record-form";

export const metadata: Metadata = { title: "新增資料 | Nexus" };

/**
 * 建立資料頁（TASK-003）
 */
export default async function NewRecordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link href="/" className="self-start text-sm text-zinc-500 hover:text-zinc-700">
        ← 回首頁
      </Link>
      <CreateRecordForm />
    </main>
  );
}
