"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 搜尋條（TASK-003，CLAUDE.frontend.md 搜尋 UI 規則）
 * - hero：首頁置中，submit → /search?q=
 * - top：結果頁置頂，input 變更 debounce 300ms → router.replace（useTransition 避免阻塞）
 * 條件一律走 URL searchParams。
 */
interface SearchBarProps {
  variant?: "hero" | "top";
  initialValue?: string;
}

export function SearchBar({ variant = "hero", initialValue = "" }: SearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    startTransition(() => {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    });
  }

  function onChange(next: string) {
    setValue(next);
    if (variant !== "top") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(`/search?q=${encodeURIComponent(next.trim())}`);
      });
    }, 300); // debounce 300ms（CLAUDE.frontend.md）
  }

  return (
    <form
      role="search"
      className={`flex w-full gap-2 ${variant === "hero" ? "max-w-xl" : "max-w-2xl"}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜尋公司內部資料…"
        aria-label="搜尋關鍵字"
        className={variant === "hero" ? "h-12 text-base" : ""}
      />
      <Button type="submit" disabled={isPending} className={variant === "hero" ? "h-12 px-6" : ""}>
        {isPending ? "搜尋中…" : "搜尋"}
      </Button>
    </form>
  );
}
