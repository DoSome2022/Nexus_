"use client";

import type { ReactNode } from "react";
import { useFormContext, type FieldPath } from "react-hook-form";
import { Input } from "@/components/ui/input";
import type { TemplateField } from "@/lib/schemas/template";
import type { RecordFormValues } from "@/lib/template-data";

/**
 * 依範本欄位渲染資料表單（TASK-008）：吃 FormProvider（useFormContext）
 * - text/number/date/list → Input；textarea → 原生 textarea；boolean → checkbox
 * - number step="any"；list 以逗號分隔；date 為 YYYY-MM-DD
 */
const textareaClass =
  "rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800";

function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  );
}

export function RecordDataFields({ fields }: { fields: TemplateField[] }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<RecordFormValues>();

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const path = `data.${field.name}` as FieldPath<RecordFormValues>;
        const inputId = `data.${field.name}`;
        const error = errors.data?.[field.name];
        const message = error && "message" in error ? error.message : undefined;
        const required = field.required && field.type !== "boolean";
        const labelText = required ? `${field.label} *` : field.label;

        const common = {
          id: inputId,
          "aria-invalid": Boolean(error),
          ...register(path),
        };

        let control: ReactNode;
        switch (field.type) {
          case "boolean":
            control = (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...common} />
                {field.label}
              </label>
            );
            break;
          case "textarea":
            control = <textarea rows={4} className={textareaClass} {...common} />;
            break;
          case "number":
            control = <Input type="number" step="any" {...common} />;
            break;
          case "date":
            control = <Input type="date" {...common} />;
            break;
          case "list":
            control = (
              <Input type="text" placeholder="多個值以逗號分隔，例如：甲, 乙" {...common} />
            );
            break;
          default:
            control = <Input type="text" {...common} />;
        }

        if (field.type === "boolean") {
          return (
            <div key={field.name} className="flex flex-col gap-1">
              {control}
              <FieldError>{message}</FieldError>
            </div>
          );
        }
        return (
          <div key={field.name} className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              {labelText}
            </label>
            {control}
            <FieldError>{message}</FieldError>
          </div>
        );
      })}
    </div>
  );
}
