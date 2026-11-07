"use client";

import { useRouter } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { templateInputSchema, type TemplateInput } from "@/lib/schemas/template";
import { trpc } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TemplateDeleteButton } from "@/components/template-delete-button";
import { TemplateFieldsEditor } from "@/components/template-fields-editor";

/**
 * 範本建立/編輯表單（TASK-008）：僅 Admin 可達（頁面層已擋）
 * 共用 create/edit 兩個 mutation；編輯模式附刪除按鈕
 */
interface TemplateFormProps {
  mode: "create" | "edit";
  templateId?: string;
  initialValues?: TemplateInput;
}

const EMPTY_FIELD = { name: "", label: "", type: "text" as const, required: false };

/** required 有 .default() → z.input（表單值）與 z.output（提交值）型別不同，分開宣告 */
type TemplateFormInput = z.input<typeof templateInputSchema>;
type TemplateFormOutput = z.output<typeof templateInputSchema>;

export function TemplateForm({ mode, templateId, initialValues }: TemplateFormProps) {
  const router = useRouter();
  const createMutation = trpc.template.create.useMutation({
    onSuccess: () => {
      router.push("/templates");
      router.refresh();
    },
  });
  const updateMutation = trpc.template.update.useMutation({
    onSuccess: () => {
      router.push("/templates");
      router.refresh();
    },
  });

  const methods = useForm<TemplateFormInput, unknown, TemplateFormOutput>({
    resolver: zodResolver(templateInputSchema),
    defaultValues: initialValues ?? { name: "", description: "", fields: [EMPTY_FIELD] },
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = methods;

  const isEdit = mode === "edit";
  const mutationError = isEdit ? updateMutation.error : createMutation.error;
  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;

  function onSubmit(values: TemplateFormOutput) {
    if (isEdit && templateId) {
      updateMutation.mutate({ id: templateId, ...values });
    } else {
      createMutation.mutate(values);
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{isEdit ? "編輯範本" : "新增範本"}</CardTitle>
        <CardDescription>
          範本全站共用；資料建立時會存下範本副本，之後修改範本不影響既有資料
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                範本名稱
              </label>
              <Input
                id="name"
                aria-invalid={Boolean(errors.name)}
                placeholder="會議紀錄"
                {...register("name")}
              />
              {errors.name ? (
                <p role="alert" className="text-sm text-red-600">
                  {errors.name.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="description" className="text-sm font-medium">
                描述（選填）
              </label>
              <Input
                id="description"
                aria-invalid={Boolean(errors.description)}
                placeholder="例會與專案會議"
                {...register("description")}
              />
              {errors.description ? (
                <p role="alert" className="text-sm text-red-600">
                  {errors.description.message}
                </p>
              ) : null}
            </div>

            <TemplateFieldsEditor />

            {mutationError ? (
              <p role="alert" className="text-sm text-red-600">
                {mutationError.message || "操作失敗，請稍後再試"}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "儲存中…" : "儲存"}
              </Button>
              {isEdit && templateId ? <TemplateDeleteButton templateId={templateId} /> : null}
            </div>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
