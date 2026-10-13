import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 檢視頁（TASK-003）：canRead 檢查在 service；保密內容從 localdata 檔案載入
 */
const createCaller = createCallerFactory(appRouter);

export default async function RecordPage({
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
    notFound(); // 無權限/不存在一律 404（不洩漏存在性）
  }

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link href="/" className="self-start text-sm text-zinc-500 hover:text-zinc-700">
        ← 回首頁
      </Link>
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="break-all">{record.title}</CardTitle>
            <span className="flex shrink-0 gap-1">
              {record.isConfidential ? (
                <Badge variant="destructive">保密</Badge>
              ) : record.isPublic ? (
                <Badge variant="secondary">公開</Badge>
              ) : (
                <Badge variant="outline">私有</Badge>
              )}
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            更新於 {record.updatedAt.toLocaleString("zh-Hant-TW")}
          </p>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
            {JSON.stringify(record.data, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </main>
  );
}
