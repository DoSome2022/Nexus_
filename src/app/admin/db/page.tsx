import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth";
import { getEnv } from "@/env";
import { verifyAdminDbToken } from "@/server/security/admin-db-token";
import { getDbOverview } from "@/server/services/db-overview-service";
import { DbOverviewTableCard } from "@/components/db-overview-table";
import { parseDbOverviewLimits } from "@/lib/db-overview";

export const metadata: Metadata = {
  title: "資料庫總覽 | Nexus",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

/**
 * 隱藏資料庫總覽頁（TASK-011）：/admin/db?token=<ADMIN_DB_TOKEN>
 * - 僅 ADMIN + URL token（timing-safe 比較）；任何失敗一律 notFound() 不洩漏存在性
 * - 每表獨立筆數（20/100/500）走 GET form + searchParams，token 以 hidden input 帶回
 * - 8 張表全欄位顯示（含敏感欄位與保密 localdata 內容——需求指定）；無任何導覽連結
 * - 不設 route 專屬 error/not-found：沿用根目錄通用版，避免 404 文案差異洩漏頁面存在
 */
export default async function DbOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") notFound();

  const params = await searchParams;
  // token 必須是單一字串（重複參數 → 陣列 → 一律 404）
  const token = typeof params.token === "string" ? params.token : null;
  if (!token || !verifyAdminDbToken(token, getEnv().ADMIN_DB_TOKEN)) notFound();

  const limits = parseDbOverviewLimits(params);

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerList.get("user-agent");

  let overview;
  try {
    overview = await getDbOverview({
      actor: { id: session.user.id, role: session.user.role },
      limits,
      request: { ip, userAgent },
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") notFound();
    if (err instanceof TRPCError && err.code === "TOO_MANY_REQUESTS") {
      return (
        <main className="flex flex-1 flex-col items-center justify-center gap-2 bg-zinc-50 p-6 dark:bg-black">
          <p className="text-zinc-600 dark:text-zinc-400">請求過於頻繁，請一分鐘後再試</p>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← 回首頁
          </Link>
        </main>
      );
    }
    throw err;
  }

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">資料庫總覽</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← 回首頁
        </Link>
      </header>

      <div
        role="note"
        className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        本頁含敏感資訊（密碼雜湊、token 雜湊），僅限 ADMIN 使用。
        請勿截圖、分享網址或保留瀏覽紀錄。
      </div>

      <form method="get" action="/admin/db" className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        {overview.tables.map((table) => (
          <DbOverviewTableCard key={table.key} table={table} />
        ))}
      </form>
    </main>
  );
}
