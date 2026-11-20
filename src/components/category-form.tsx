"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { categoryFormSchema, type CategoryFormValues } from "@/lib/schemas/category";
import { buildCategoryIndex, buildCategoryPath, getDescendantIds } from "@/lib/category-tree";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CategoryBrowserDialog } from "@/components/category-browser-dialog";

/**
 * 分類建立/編輯表單（TASK-012）：人人可建（作者或 Admin 可編輯）
 * 上層分類：檔案對話框式瀏覽器選取（單擊進入、Space 選取）；
 * 編輯模式排除自己與子孫（防環）；× 可清除回根
 */
interface CategoryFormProps {
  mode: "create" | "edit";
  categoryId?: string;
  initialValues?: { name: string; parentId: string };
  /** 建立頁可由 ?parent= 預選上層 */
  parentHint?: string;
}

export function CategoryForm({ mode, categoryId, initialValues, parentHint }: CategoryFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [pickerOpen, setPickerOpen] = useState(false);

  const list = trpc.category.list.useQuery();
  const createMutation = trpc.category.create.useMutation({
    onSuccess: (result) => {
      router.push(`/categories/${result.id}`);
      router.refresh();
    },
  });
  const updateMutation = trpc.category.update.useMutation({
    onSuccess: () => {
      router.push(`/categories/${categoryId}`);
      router.refresh();
    },
  });

  const methods = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: initialValues ?? { name: "", parentId: parentHint ?? "" },
  });
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = methods;

  const parentId = useWatch({ control: methods.control, name: "parentId" });

  const mutationError = isEdit ? updateMutation.error : createMutation.error;
  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;

  function onSubmit(values: CategoryFormValues) {
    if (isEdit && categoryId) {
      // parentId 空字串＝移到根（null）
      updateMutation.mutate({
        id: categoryId,
        name: values.name,
        parentId: values.parentId === "" ? null : values.parentId,
      });
    } else {
      createMutation.mutate({
        name: values.name,
        parentId: values.parentId === "" ? undefined : values.parentId,
      });
    }
  }

  // 路徑顯示 + 編輯模式排除自己與子孫（防環）
  const categories = list.data ?? [];
  const index = buildCategoryIndex(categories);
  const excluded = new Set(
    isEdit && categoryId ? getDescendantIds(categoryId, index) : [],
  );
  const parentPath =
    parentId && parentId !== "" ? buildCategoryPath(parentId, index) || parentId : "";

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>{isEdit ? "編輯分類" : "新增分類"}</CardTitle>
        <CardDescription>
          分類全站可見；同層不可重名，不可移到自己或子分類之下
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                分類名稱
              </label>
              <Input
                id="name"
                aria-invalid={Boolean(errors.name)}
                placeholder="例如：水果"
                {...register("name")}
              />
              {errors.name ? (
                <p role="alert" className="text-sm text-red-600">
                  {errors.name.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">上層分類（可選）</label>
              <input type="hidden" {...register("parentId")} />
              <div className="flex items-center gap-2">
                <span className="min-h-6 flex-1 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {parentPath || "（無，作為最上層）"}
                </span>
                {parentPath ? (
                  <button
                    type="button"
                    aria-label="清除上層分類"
                    className="text-sm text-zinc-400 hover:text-red-600"
                    onClick={() => setValue("parentId", "")}
                  >
                    ×
                  </button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                >
                  選擇上層分類
                </Button>
              </div>
            </div>

            {mutationError ? (
              <p role="alert" className="text-sm text-red-600">
                {mutationError.message || "操作失敗，請稍後再試"}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </FormProvider>
      </CardContent>

      <CategoryBrowserDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludeIds={excluded}
        onSelect={(id) => {
          setValue("parentId", id);
        }}
      />
    </Card>
  );
}
