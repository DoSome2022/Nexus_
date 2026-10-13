"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";

/** 垃圾桶恢復（TASK-005）：清 deletedAt + 保密檔案移回主目錄 */
export function RestoreButton({ recordId }: { recordId: string }) {
  const router = useRouter();
  const restoreMutation = trpc.record.restore.useMutation({
    onSuccess: () => router.refresh(),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={restoreMutation.isPending}
      onClick={() => restoreMutation.mutate({ id: recordId })}
    >
      {restoreMutation.isPending ? "恢復中…" : "恢復"}
    </Button>
  );
}
