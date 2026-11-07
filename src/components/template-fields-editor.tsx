"use client";

import { useFieldArray, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TEMPLATE_FIELD_TYPES,
  MAX_TEMPLATE_FIELDS,
  type TemplateInput,
} from "@/lib/schemas/template";

/**
 * 範本欄位編輯器（TASK-008）：動態欄位列（RHF useFieldArray）
 * - 每列：欄位名稱（JSON key）/ 顯示標籤 / 型別 / 必填 / 刪除
 * - boolean 欄位的「必填」停用（checkbox 必有值，required 對其無意義）
 */
const FIELD_TYPE_LABELS: Record<(typeof TEMPLATE_FIELD_TYPES)[number], string> = {
  text: "文字（單行）",
  textarea: "文字（多行）",
  number: "數字",
  boolean: "布林（是/否）",
  list: "清單（逗號分隔）",
  date: "日期",
};

const inputClass =
  "rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800";

export function TemplateFieldsEditor() {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<TemplateInput>();
  const { fields, append, remove } = useFieldArray({ control, name: "fields" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">欄位定義（資料填寫時依此產生表單）</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= MAX_TEMPLATE_FIELDS}
          onClick={() => append({ name: "", label: "", type: "text", required: false })}
        >
          ＋ 新增欄位
        </Button>
      </div>

      {fields.map((field, index) => {
        const type = watch(`fields.${index}.type`);
        const rowErrors = errors.fields?.[index];
        return (
          <div
            key={field.id}
            className="flex flex-wrap items-start gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <label htmlFor={`fields.${index}.name`} className="text-xs text-zinc-500">
                欄位名稱（JSON key，英文）
              </label>
              <Input
                id={`fields.${index}.name`}
                aria-invalid={Boolean(rowErrors?.name)}
                placeholder="topic"
                {...register(`fields.${index}.name`)}
              />
              {rowErrors?.name ? (
                <p role="alert" className="text-xs text-red-600">
                  {rowErrors.name.message}
                </p>
              ) : null}
            </div>

            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <label htmlFor={`fields.${index}.label`} className="text-xs text-zinc-500">
                顯示標籤（給填表者看）
              </label>
              <Input
                id={`fields.${index}.label`}
                aria-invalid={Boolean(rowErrors?.label)}
                placeholder="會議主題"
                {...register(`fields.${index}.label`)}
              />
              {rowErrors?.label ? (
                <p role="alert" className="text-xs text-red-600">
                  {rowErrors.label.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`fields.${index}.type`} className="text-xs text-zinc-500">
                型別
              </label>
              <select
                id={`fields.${index}.type`}
                aria-invalid={Boolean(rowErrors?.type)}
                className={inputClass}
                {...register(`fields.${index}.type`)}
              >
                {TEMPLATE_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {rowErrors?.type ? (
                <p role="alert" className="text-xs text-red-600">
                  {rowErrors.type.message}
                </p>
              ) : null}
            </div>

            <label
              className="flex items-center gap-2 pt-6 text-sm"
              title={type === "boolean" ? "布林欄位不需要必填設定" : undefined}
            >
              <input
                type="checkbox"
                disabled={type === "boolean"}
                {...register(`fields.${index}.required`)}
              />
              必填
            </label>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-5"
              aria-label={`刪除第 ${index + 1} 個欄位`}
              onClick={() => remove(index)}
            >
              ✕
            </Button>
          </div>
        );
      })}

      {errors.fields?.root ? (
        <p role="alert" className="text-sm text-red-600">
          {errors.fields.root.message}
        </p>
      ) : null}
    </div>
  );
}
