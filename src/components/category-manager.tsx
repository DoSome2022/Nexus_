"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";
import { CategoryBrowserDialog } from "@/components/category-browser-dialog";
import type { CategoryRefDTO } from "@/server/services/record-service";

/**
 * 檢視頁的分類管理元件（TASK-012，檔案對話框式）
 * - chips：顯示完整路徑（同名但不同分支的分類不會混淆）+ 連結到 /categories/[id]；可移除（canManage）
 * - 「＋ 加入分類」開啟檔案對話框式瀏覽器（方向鍵/滑鼠、Enter 進入、Space 選取）→ 即時 link
 * - 成功後 refresh，錯誤 inline 顯示
 */
interface CategoryManagerProps {
  recordId: string;
  canManage: boolean;
  initialCategories: CategoryRefDTO[];
}

export function CategoryManager({ recordId, canManage, initialCategories }: CategoryManagerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const linkMutation = trpc.category.link.useMutation({
    onSuccess: () => {
      router.refresh();
    },
  });
  const unlinkMutation = trpc.category.unlink.useMutation({
    onSuccess: () => {
      router.refresh();
    },
  });

  const error = linkMutation.error ?? unlinkMutation.error;

  function select(categoryId: string) {
    linkMutation.mutate({ recordId, categoryId });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {initialCategories.length === 0 ? (
          <span className="text-sm text-zinc-500">尚未分類</span>
        ) : (
          initialCategories.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <Link href={`/categories/${c.id}`}>
                <Badge variant="secondary" className="hover:bg-zinc-200 dark:hover:bg-zinc-700">
                  {c.path}
                </Badge>
              </Link>
              {canManage ? (
                <button
                  type="button"
                  aria-label={`移除分類 ${c.path}`}
                  className="text-sm text-zinc-400 hover:text-red-600"
                  disabled={unlinkMutation.isPending}
                  onClick={() => unlinkMutation.mutate({ recordId, categoryId: c.id })}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))
        )}
      </div>

      {canManage ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              ＋ 加入分類
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error.message || "操作失敗，請稍後再試"}
            </p>
          ) : null}
        </div>
      ) : null}

      <CategoryBrowserDialog open={open} onOpenChange={setOpen} onSelect={select} />
    </div>
  );
}
