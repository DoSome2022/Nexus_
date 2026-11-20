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
 * 分類刪除按鈕（TASK-012）：確認對話框
 * 有子分類時會被 service 擋下；掛著的資料連結（含垃圾桶）會自動一併解除
 */
export function CategoryDeleteButton({
  categoryId,
  linkCount,
}: {
  categoryId: string;
  linkCount: number;
}) {
  const router = useRouter();
  const deleteMutation = trpc.category.delete.useMutation({
    onSuccess: () => {
      router.push("/categories");
      router.refresh();
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        刪除分類
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>刪除分類？</AlertDialogTitle>
          <AlertDialogDescription>
            {linkCount > 0
              ? `此分類掛著 ${linkCount} 筆資料的連結（含垃圾桶），刪除時將一併解除（資料本身不受影響）。此操作無法復原。`
              : "此操作無法復原。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ id: categoryId })}
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
