"use client";

/**
 * 範本選擇器（TASK-008）：dumb 受控元件（值由父表單 state 持有）
 * 選「無範本」維持自由 JSON 流程
 * 型別只收用到的欄位（tRPC client 端 createdAt/updatedAt 為 string，不需在此宣告）
 */
interface TemplateSelectProps {
  templates: Array<{ id: string; name: string; description: string | null }>;
  value: string;
  onChange: (templateId: string) => void;
}

export function TemplateSelect({ templates, value, onChange }: TemplateSelectProps) {
  const selected = templates.find((t) => t.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="template" className="text-sm font-medium">
        表單範本（選用）
      </label>
      <select
        id="template"
        aria-label="選擇表單範本"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
      >
        <option value="">無範本（自由 JSON）</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {selected?.description ? (
        <p className="text-xs text-zinc-500">{selected.description}</p>
      ) : null}
    </div>
  );
}
