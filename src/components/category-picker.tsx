"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";
import { CategoryBrowserDialog } from "@/components/category-browser-dialog";
import { buildCategoryIndex, buildCategoryPath } from "@/lib/category-tree";

/**
 * 表單用的分類多選（TASK-012 後續，檔案對話框式）：受控 value/onChange
 * - 已選分類顯示為 chips（完整路徑，可移除）
 * - 「＋ 加入分類」開啟檔案對話框式瀏覽器（方向鍵/滑鼠、Enter 進入、Space 選取）
 * - 建立/編輯資料表單共用；實際寫入在表單 submit 時一併送出
 */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = trpc.category.list.useQuery(undefined, { enabled: open || value.length > 0 });
  const index = buildCategoryIndex(list.data ?? []);

  function add(id: string) {
    if (value.includes(id)) return;
    onChange([...value, id]);
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 ? (
          <span className="text-sm text-zinc-500">尚未選擇分類</span>
        ) : (
          value.map((id) => (
            <span key={id} className="flex items-center gap-1">
              <Badge variant="secondary">{buildCategoryPath(id, index) || id}</Badge>
              <button
                type="button"
                aria-label={`移除分類 ${buildCategoryPath(id, index) || id}`}
                className="text-sm text-zinc-400 hover:text-red-600"
                onClick={() => remove(id)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          ＋ 加入分類
        </Button>
      </div>

      <CategoryBrowserDialog open={open} onOpenChange={setOpen} onSelect={add} />
    </div>
  );
}
