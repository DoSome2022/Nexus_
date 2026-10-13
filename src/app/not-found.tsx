import Link from "next/link";

/** 全域 404（CLAUDE.frontend.md：每路由必備 not-found） */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <h1 className="text-2xl font-semibold">找不到此頁面</h1>
      <p className="text-sm text-zinc-500">資料不存在或沒有權限存取</p>
      <Link href="/" className="text-sm text-zinc-700 underline dark:text-zinc-300">
        回首頁
      </Link>
    </main>
  );
}
