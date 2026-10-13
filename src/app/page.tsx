import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 首頁（TASK-002）：已登入顯示（email / role + 登出）
 * 搜尋 UI 留 TASK-003；proxy 已擋未登入，此處 redirect 為第二層防禦
 */
export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 p-6 dark:bg-black">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Nexus</CardTitle>
          <CardDescription>企業內部搜尋與資料管理</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            已登入：
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {session.user.email}
            </span>{" "}
            <Badge variant="secondary">{session.user.role}</Badge>
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500">搜尋功能將於 TASK-003 上線</p>
          <LogoutButton />
        </CardContent>
      </Card>
    </main>
  );
}
