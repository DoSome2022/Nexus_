"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * 關聯建議區塊（TASK-009）：掃描記錄標題/內容中提到的其他可讀記錄標題
 * - 常駐收合（預設收合）；autoExpand（?hl=suggestions）→ 展開 + 琥珀色高亮一次
 * - 一鍵加入走 relation.create（服務端兩端 canRead）；加入後 invalidate 建議清單
 * - 0 筆 / 載入中 → 不渲染
 */
interface RelationSuggestionsProps {
  recordId: string;
  autoExpand: boolean;
}

export function RelationSuggestions({ recordId, autoExpand }: RelationSuggestionsProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(autoExpand);
  const [highlighted, setHighlighted] = useState(autoExpand);

  const suggest = trpc.relation.suggest.useQuery({ id: recordId }, { retry: false });
  const createMutation = trpc.relation.create.useMutation({
    onSuccess: () => {
      void utils.relation.suggest.invalidate();
      router.refresh();
    },
  });

  const suggestions = suggest.data;
  // 已載入且無候選 → 不渲染；載入中先渲染收合殼（SSR 可見，避免 pop-in）
  if (suggestions !== undefined && suggestions.length === 0) return null;

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800 ${
        highlighted ? "ring-1 ring-amber-300" : ""
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setHighlighted(false);
        }}
        className="flex items-center justify-between text-left text-sm font-medium"
      >
        <span>
          可能相關的資料{suggestions !== undefined ? ` (${suggestions.length})` : ""}
        </span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && suggestions ? (
        <ul className="flex flex-col gap-1">
          {suggestions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{s.title}</span>
                {s.isConfidential ? <Badge variant="destructive">保密</Badge> : null}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate({ fromId: recordId, toId: s.id })}
              >
                {createMutation.isPending ? "加入中…" : "加入"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {createMutation.error ? (
        <p role="alert" className="text-sm text-red-600">
          {createMutation.error.message || "加入關聯失敗"}
        </p>
      ) : null}
    </div>
  );
}
