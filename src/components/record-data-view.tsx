import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { TemplateField } from "@/lib/schemas/template";
import type { RecordTemplateSnapshot } from "@/lib/template-data";

/**
 * 友善資料顯示（TASK-008）：依 snapshot 欄位渲染（server 元件可直接使用）
 * - boolean → Badge 是/否；list → Badge chips；textarea → 保留換行；缺值 → —
 * - 值一律經 React 轉義（無 HTML injection）
 */
function renderFieldValue(type: TemplateField["type"], value: unknown): ReactNode {
  if (value === undefined || value === null) {
    return <span className="text-zinc-400">—</span>;
  }
  switch (type) {
    case "boolean":
      return value === true ? (
        <Badge variant="secondary">是</Badge>
      ) : (
        <Badge variant="outline">否</Badge>
      );
    case "list":
      return Array.isArray(value) ? (
        <span className="flex flex-wrap gap-1">
          {value.map((item, i) => (
            <Badge key={i} variant="secondary">
              {String(item)}
            </Badge>
          ))}
        </span>
      ) : (
        <span className="break-words">{String(value)}</span>
      );
    case "textarea":
      return <p className="whitespace-pre-wrap break-words">{String(value)}</p>;
    default:
      return <span className="break-words">{String(value)}</span>;
  }
}

export function RecordDataView({
  snapshot,
  data,
}: {
  snapshot: RecordTemplateSnapshot;
  data: unknown;
}) {
  const record =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500">表單：{snapshot.templateName}</p>
      <dl className="flex flex-col gap-3">
        {snapshot.fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <dt className="text-sm font-medium">{field.label}</dt>
            <dd className="text-sm">{renderFieldValue(field.type, record[field.name])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
