"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RecordDataFields } from "@/components/record-data-fields";
import { CategoryPicker } from "@/components/category-picker";
import {
  buildRecordFormSchema,
  serializeTemplateValues,
  toTemplateFormValues,
  type RecordFormValues,
  type RecordTemplateSnapshot,
} from "@/lib/template-data";

/**
 * 編輯資料表單（TASK-005 / TASK-008 / TASK-012 後續）
 * - 保密資料：儲存位置與可見性不可變更（radio 停用，僅可改 title/data）
 * - 範本相符 → 依 snapshot 欄位回填表單；不相符/無範本 → JSON textarea（不切換範本）
 * - 分類多選：儲存時「取代整組」連結
 */
interface RecordEditFormProps {
  id: string;
  initialTitle: string;
  initialDataJson: string;
  initialData: unknown;
  isPublic: boolean;
  isEditableByOthers: boolean;
  isConfidential: boolean;
  /** 相符的範本 snapshot（null = JSON 模式） */
  template: RecordTemplateSnapshot | null;
  /** 有 snapshot 但資料不符 → JSON 模式 + 提示 */
  templateMismatch: boolean;
  /** 目前的分類 id 清單（TASK-012 後續） */
  initialCategoryIds: string[];
}

export function RecordEditForm({
  id,
  initialTitle,
  initialDataJson,
  initialData,
  isPublic,
  isEditableByOthers,
  isConfidential,
  template,
  templateMismatch,
  initialCategoryIds,
}: RecordEditFormProps) {
  const router = useRouter();
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCategoryIds);
  const updateMutation = trpc.record.update.useMutation({
    onSuccess: () => {
      router.push(`/records/${id}?hl=suggestions`); // TASK-009：跳轉後自動展開關聯建議
      router.refresh();
    },
  });

  const useTemplate = template !== null;
  const schema = useMemo(() => buildRecordFormSchema(template?.fields ?? null), [template]);
  const methods = useForm<RecordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initialTitle,
      dataJson: initialDataJson,
      data: useTemplate ? toTemplateFormValues(template.fields, initialData) : {},
      visibility: isConfidential ? "CONFIDENTIAL" : isPublic ? "PUBLIC" : "PRIVATE",
      isEditableByOthers,
    },
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = methods;

  function onSubmit(values: RecordFormValues) {
    const flags = {
      PUBLIC: { isPublic: true },
      PRIVATE: { isPublic: false },
      CONFIDENTIAL: { isPublic: false },
    }[values.visibility];
    const dataJson = useTemplate
      ? JSON.stringify(serializeTemplateValues(template.fields, values.data))
      : values.dataJson;
    updateMutation.mutate({
      id,
      title: values.title,
      dataJson,
      isPublic: isConfidential ? undefined : flags.isPublic,
      isEditableByOthers: isConfidential
        ? undefined
        : values.visibility === "CONFIDENTIAL"
          ? false
          : values.isEditableByOthers,
      categoryIds,
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
        <FormProvider {...methods}>
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

            {useTemplate ? (
              <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-sm font-medium">使用表單：{template.templateName}</p>
                <RecordDataFields fields={template.fields} />
                <input type="hidden" {...register("dataJson")} />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="dataJson" className="text-sm font-medium">
                  資料內容（JSON）
                </label>
                {templateMismatch ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    此資料格式與範本不相符，改以 JSON 編輯
                  </p>
                ) : null}
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
            )}

            <fieldset className="flex flex-col gap-2" disabled={isConfidential}>
              <legend className="text-sm font-medium">
                可見性{isConfidential ? "（保密資料不可變更）" : ""}
              </legend>
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

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">分類（儲存時取代整組）</label>
              <CategoryPicker value={categoryIds} onChange={setCategoryIds} />
            </div>

            {updateMutation.error ? (
              <p role="alert" className="text-sm text-red-600">
                {updateMutation.error.message || "編輯失敗，請稍後再試"}
              </p>
            ) : null}

            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "儲存中…" : "儲存"}
            </Button>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
