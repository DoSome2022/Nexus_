"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * 範本刪除按鈕（TASK-008）：硬刪除 + 確認對話框
 * 已建立的資料不受影響（Record.schema 為建立當下的 snapshot）
 */
export function TemplateDeleteButton({ templateId }: { templateId: string }) {
  const router = useRouter();
  const deleteMutation = trpc.template.delete.useMutation({
    onSuccess: () => {
      router.push("/templates");
      router.refresh();
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        刪除範本
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>刪除範本？</AlertDialogTitle>
          <AlertDialogDescription>
            已建立的資料不受影響（資料存的是建立當下的副本）。此操作無法復原。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ id: templateId })}
          >
            {deleteMutation.isPending ? "刪除中…" : "刪除"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {deleteMutation.error ? (
          <p role="alert" className="text-sm text-red-600">
            {deleteMutation.error.message || "刪除失敗，請稍後再試"}
          </p>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
