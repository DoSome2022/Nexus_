import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { SearchBar } from "@/components/search-bar";
import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

/**
 * 搜尋首頁（TASK-003）：Google 式置中搜尋條 + 新增資料入口
 * proxy 已擋未登入，此處 redirect 為第二層防禦
 */
export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-end gap-3 p-4">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {session.user.email} <Badge variant="secondary">{session.user.role}</Badge>
        </span>
        {session.user.role === "ADMIN" ? (
          <Link
            href="/templates"
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            範本管理
          </Link>
        ) : null}
        <LogoutButton />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-24">
        <h1 className="text-4xl font-semibold tracking-tight">Nexus</h1>
        <SearchBar variant="hero" />
        <Link href="/records/new" className={buttonVariants({ variant: "outline" })}>
          新增資料
        </Link>
      </main>
    </div>
  );
}
