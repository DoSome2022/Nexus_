"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";

/** 刪除關聯（TASK-007 / TASK-009）：service 層驗證任一端 canEdit 或 Admin；刪除後同步建議清單 */
export function RelationDeleteButton({ relationId }: { relationId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const deleteMutation = trpc.relation.delete.useMutation({
    onSuccess: () => {
      void utils.relation.suggest.invalidate();
      router.refresh();
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={deleteMutation.isPending}
      onClick={() => deleteMutation.mutate({ id: relationId })}
      aria-label="刪除關聯"
    >
      移除
    </Button>
  );
}
