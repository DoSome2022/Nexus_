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
 * 複製分類按鈕（TASK-013）：連同子分類樹與資料連結一起複製；人人可複製
 * 新分類名自動「(副本)」後綴；成功後跳轉到新分類頁
 */
export function CategoryDuplicateButton({
  categoryId,
  categoryName,
  subtreeCategoryCount,
  subtreeLinkCount,
}: {
  categoryId: string;
  categoryName: string;
  subtreeCategoryCount: number;
  subtreeLinkCount: number;
}) {
  const router = useRouter();
  const duplicateMutation = trpc.category.duplicate.useMutation({
    onSuccess: (result) => {
      router.push(`/categories/${result.id}`);
      router.refresh();
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        複製
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>複製分類？</AlertDialogTitle>
          <AlertDialogDescription>
            將產生「{categoryName}(副本)」分類（共 {subtreeCategoryCount} 個分類，含子分類）。
            {subtreeLinkCount > 0
              ? `掛在此分類樹下的 ${subtreeLinkCount} 筆資料連結會一併帶到新分類（資料本身不複製）。`
              : "此分類樹下目前沒有資料連結。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="default"
            disabled={duplicateMutation.isPending}
            onClick={() => duplicateMutation.mutate({ id: categoryId })}
          >
            {duplicateMutation.isPending ? "複製中…" : "複製"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {duplicateMutation.error ? (
          <p role="alert" className="text-sm text-red-600">
            {duplicateMutation.error.message || "複製失敗，請稍後再試"}
          </p>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
