"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";

/**
 * 刪除申請（TASK-005）：僅 Admin 可提出
 * 成功後顯示確認 URL（等同郵件內容；SMTP 接上後只換傳遞管道）
 */
export function DeleteRequestButton({ recordId }: { recordId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const requestMutation = trpc.record.requestDelete.useMutation({
    onSuccess: (result) => setToken(result.token),
  });

  if (token) {
    const confirmUrl = `/records/${recordId}/delete-confirm?token=${encodeURIComponent(token)}`;
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-amber-700 dark:text-amber-400">
          確認連結已產生（等同郵件內容，15 分鐘內有效、一次性）：
        </p>
        <a href={confirmUrl} className="break-all underline">
          {confirmUrl}
        </a>
      </div>
    );
  }

  return (
    <Button
      variant="destructive"
      disabled={requestMutation.isPending}
      onClick={() => requestMutation.mutate({ id: recordId })}
    >
      {requestMutation.isPending ? "產生確認連結…" : "申請刪除"}
    </Button>
  );
}
