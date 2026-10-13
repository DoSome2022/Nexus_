"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createRecordFormSchema, type CreateRecordFormInput } from "@/lib/schemas/record";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * 編輯資料表單（TASK-005）
 * 保密資料：儲存位置與可見性不可變更（radio 停用，僅可改 title/data）
 */
interface RecordEditFormProps {
  id: string;
  initialTitle: string;
  initialDataJson: string;
  isPublic: boolean;
  isEditableByOthers: boolean;
  isConfidential: boolean;
}

export function RecordEditForm({
  id,
  initialTitle,
  initialDataJson,
  isPublic,
  isEditableByOthers,
  isConfidential,
}: RecordEditFormProps) {
  const router = useRouter();
  const updateMutation = trpc.record.update.useMutation({
    onSuccess: () => {
      router.push(`/records/${id}`);
      router.refresh();
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateRecordFormInput>({
    resolver: zodResolver(createRecordFormSchema),
    defaultValues: {
      title: initialTitle,
      dataJson: initialDataJson,
      visibility: isConfidential ? "CONFIDENTIAL" : isPublic ? "PUBLIC" : "PRIVATE",
      isEditableByOthers,
    },
  });

  function onSubmit(values: CreateRecordFormInput) {
    const flags = {
      PUBLIC: { isPublic: true },
      PRIVATE: { isPublic: false },
      CONFIDENTIAL: { isPublic: false },
    }[values.visibility];
    updateMutation.mutate({
      id,
      title: values.title,
      dataJson: values.dataJson,
      isPublic: isConfidential ? undefined : flags.isPublic,
      isEditableByOthers: isConfidential
        ? undefined
        : values.visibility === "CONFIDENTIAL"
          ? false
          : values.isEditableByOthers,
    });
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>編輯資料</CardTitle>
        <CardDescription>
          {isConfidential
            ? "此為保密資料：內容存於本機 localdata，儲存位置與可見性不可變更"
            : "修改標題、內容與可見性"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="title" className="text-sm font-medium">
              標題
            </label>
            <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title")} />
            {errors.title ? (
              <p role="alert" className="text-sm text-red-600">
                {errors.title.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="dataJson" className="text-sm font-medium">
              資料內容（JSON）
            </label>
            <textarea
              id="dataJson"
              rows={8}
              aria-invalid={Boolean(errors.dataJson)}
              className="rounded-md border border-zinc-200 bg-transparent px-3 py-2 font-mono text-sm dark:border-zinc-800"
              {...register("dataJson")}
            />
            {errors.dataJson ? (
              <p role="alert" className="text-sm text-red-600">
                {errors.dataJson.message}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-2" disabled={isConfidential}>
            <legend className="text-sm font-medium">可見性{isConfidential ? "（保密資料不可變更）" : ""}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="PUBLIC" {...register("visibility")} />
              公開（所有人可搜尋到）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="PRIVATE" {...register("visibility")} />
              私有（只有自己可搜尋到）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="CONFIDENTIAL" {...register("visibility")} />
              保密（只存本機 localdata，不進資料庫；僅自己可見）
            </label>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={isConfidential}
              {...register("isEditableByOthers")}
            />
            允許他人編輯{isConfidential ? "（保密資料不可選）" : ""}
          </label>

          {updateMutation.error ? (
            <p role="alert" className="text-sm text-red-600">
              {updateMutation.error.message || "編輯失敗，請稍後再試"}
            </p>
          ) : null}

          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "儲存中…" : "儲存"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
