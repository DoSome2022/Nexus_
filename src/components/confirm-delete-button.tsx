"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";

/**
 * 刪除確認（TASK-005）：點擊等同郵件核准 → 軟刪除 → 垃圾桶
 */
export function ConfirmDeleteButton({ recordId, token }: { recordId: string; token: string }) {
  const router = useRouter();
  const confirmMutation = trpc.record.confirmDelete.useMutation({
    onSuccess: () => {
      router.push("/trash");
      router.refresh();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        點擊下方按鈕等同郵件核准：資料將軟刪除並移入垃圾桶（保密資料的檔案會移入 .trash）。
      </p>
      {confirmMutation.error ? (
        <p role="alert" className="text-sm text-red-600">
          {confirmMutation.error.message}
        </p>
      ) : null}
      <Button
        variant="destructive"
        disabled={confirmMutation.isPending}
        onClick={() => confirmMutation.mutate({ id: recordId, token })}
      >
        {confirmMutation.isPending ? "處理中…" : "確認刪除"}
      </Button>
    </div>
  );
}
