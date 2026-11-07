"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 搜尋條（TASK-003；TASK-007 後 UX 修正）
 * - 輸入中：debounce 300ms → client 端 tRPC 下拉建議（不導航、不重整）
 * - 點選建議：直接跳該資料檢視頁
 * - Enter / 按鈕：才跳 /search?q=...（結果頁）
 * - 點擊外部關閉下拉
 * hero：首頁置中；top：結果頁置頂（條件在 URL）
 */
interface SearchBarProps {
  variant?: "hero" | "top";
  initialValue?: string;
}

export function SearchBar({ variant = "hero", initialValue = "" }: SearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // debounce 300ms（CLAUDE.frontend.md）：只驅動下拉建議，不導航
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);

  // 點擊容器外部 → 關閉下拉
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = trpc.record.search.useQuery(
    { q: debounced },
    { enabled: debounced.length > 0 && open },
  );

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setOpen(false);
    startTransition(() => {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    });
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${variant === "hero" ? "max-w-xl" : "max-w-2xl"}`}
    >
      <form
        role="search"
        className="flex w-full gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
      >
        <Input
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋公司內部資料…"
          aria-label="搜尋關鍵字"
          className={variant === "hero" ? "h-12 text-base" : ""}
        />
        <Button
          type="submit"
          disabled={isPending}
          className={variant === "hero" ? "h-12 px-6" : ""}
        >
          {isPending ? "搜尋中…" : "搜尋"}
        </Button>
      </form>

      {open && debounced.length > 0 ? (
        <ul
          role="listbox"
          aria-label="搜尋建議"
          className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {suggestions.isLoading ? (
            <li className="p-3 text-sm text-zinc-500">搜尋中…</li>
          ) : (suggestions.data ?? []).length === 0 ? (
            <li className="p-3 text-sm text-zinc-500">沒有數據</li>
          ) : (
            suggestions.data?.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/records/${r.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>{r.title}</span>
                  {r.isConfidential ? (
                    <Badge variant="destructive">保密</Badge>
                  ) : r.isPublic ? (
                    <Badge variant="secondary">公開</Badge>
                  ) : (
                    <Badge variant="outline">私有</Badge>
                  )}
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
