"use client";

/**
 * 全域錯誤邊界（CLAUDE.frontend.md：每路由必備 error；
 * 錯誤訊息不可洩漏內部細節）
 */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-6 dark:bg-black">
      <h1 className="text-2xl font-semibold">發生錯誤</h1>
      <p className="text-sm text-zinc-500">請稍後再試，或聯絡管理員</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
      >
        重試
      </button>
    </main>
  );
}
