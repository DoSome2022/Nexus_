"use client";

import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createRecordFormSchema, type CreateRecordFormInput } from "@/lib/schemas/record";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * 建立資料表單（TASK-003 / TASK-004）
 * 可見性三選項：公開 / 私有 / 保密（選保密時「允許他人編輯」停用並強制為否）
 * data 以 JSON textarea 貼入（自由格式）
 */
export function CreateRecordForm() {
  const router = useRouter();
  const createMutation = trpc.record.create.useMutation({
    onSuccess: (result) => {
      router.push(`/records/${result.id}`);
    },
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreateRecordFormInput>({
    resolver: zodResolver(createRecordFormSchema),
    defaultValues: { visibility: "PRIVATE", isEditableByOthers: false },
  });

  const visibility = useWatch({ control, name: "visibility" });

  function onSubmit(values: CreateRecordFormInput) {
    const flags = {
      PUBLIC: { isPublic: true, isConfidential: false },
      PRIVATE: { isPublic: false, isConfidential: false },
      CONFIDENTIAL: { isPublic: false, isConfidential: true },
    }[values.visibility];
    createMutation.mutate({
      title: values.title,
      dataJson: values.dataJson,
      isEditableByOthers:
        values.visibility === "CONFIDENTIAL" ? false : values.isEditableByOthers,
      ...flags,
    });
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>新增資料</CardTitle>
        <CardDescription>資料內容為自由格式 JSON；「保密」資料只存於本機 localdata、不進資料庫</CardDescription>
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
              placeholder='{ "note": "自由格式", "tags": ["範例"] }'
              className="rounded-md border border-zinc-200 bg-transparent px-3 py-2 font-mono text-sm dark:border-zinc-800"
              {...register("dataJson")}
            />
            {errors.dataJson ? (
              <p role="alert" className="text-sm text-red-600">
                {errors.dataJson.message}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">可見性</legend>
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
              disabled={visibility === "CONFIDENTIAL"}
              {...register("isEditableByOthers")}
            />
            允許他人編輯{visibility === "CONFIDENTIAL" ? "（保密資料不可選）" : ""}
          </label>

          {createMutation.error ? (
            <p role="alert" className="text-sm text-red-600">
              {createMutation.error.message || "建立失敗，請稍後再試"}
            </p>
          ) : null}

          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "建立中…" : "建立"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
