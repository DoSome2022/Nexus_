import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 刪除確認頁（TASK-005）：等同郵件中的核准連結
 * token 一次性、15 分鐘（驗證在 service 層 confirmDelete）
 */
export default async function DeleteConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link href={`/records/${id}`} className="self-start text-sm text-zinc-500 hover:text-zinc-700">
        ← 回檢視頁
      </Link>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>刪除確認</CardTitle>
          <CardDescription>資料 ID：{id}</CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <ConfirmDeleteButton recordId={id} token={token} />
          ) : (
            <p className="text-sm text-red-600">缺少確認 token，請從刪除申請產生的連結進入</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
