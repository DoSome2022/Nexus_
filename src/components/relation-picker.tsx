"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 新增關聯選取器（TASK-007）
 * 搜尋關鍵字（300ms debounce）→ 下拉選取可讀資料 → 建立關聯
 * service 層仍強制兩端 canRead（此處僅 UX 過濾）
 */
export function RelationPicker({ fromId }: { fromId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = trpc.record.search.useQuery(
    { q: debounced },
    { enabled: debounced.length > 0 && open },
  );

  const createMutation = trpc.relation.create.useMutation({
    onSuccess: () => {
      setQuery("");
      setLabel("");
      setOpen(false);
      router.refresh();
    },
  });

  function pick(toId: string) {
    if (toId === fromId) return;
    createMutation.mutate({ fromId, toId, label: label || undefined });
  }

  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋要關聯的資料…"
          aria-label="搜尋要關聯的資料"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="關聯標籤（可選）"
          aria-label="關聯標籤"
          className="max-w-40"
        />
      </div>

      {open && debounced.length > 0 ? (
        <ul className="absolute top-full z-10 mt-1 w-full rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {search.isLoading ? (
            <li className="p-2 text-sm text-zinc-500">搜尋中…</li>
          ) : (search.data ?? []).length === 0 ? (
            <li className="p-2 text-sm text-zinc-500">沒有數據</li>
          ) : (
            search.data
              ?.filter((r) => r.id !== fromId)
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => pick(r.id)}
                  >
                    <span>{r.title}</span>
                    {r.isConfidential ? (
                      <span className="text-xs text-red-600">保密</span>
                    ) : null}
                  </button>
                </li>
              ))
          )}
        </ul>
      ) : null}

      {createMutation.error ? (
        <p role="alert" className="text-sm text-red-600">
          {createMutation.error.message || "建立關聯失敗"}
        </p>
      ) : null}

      {open ? (
        <Button type="button" variant="ghost" className="w-fit" onClick={() => setOpen(false)}>
          取消
        </Button>
      ) : null}
    </div>
  );
}
