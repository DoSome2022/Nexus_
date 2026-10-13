import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "登入 | Nexus" };

/**
 * 登入頁（TASK-002）：server component 讀 callbackUrl 後交給 client 表單
 * （避免 client 端 useSearchParams 需要 Suspense 邊界）
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-black">
      <LoginForm callbackUrl={callbackUrl} />
    </main>
  );
}
