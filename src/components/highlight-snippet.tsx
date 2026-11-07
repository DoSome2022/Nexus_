import { findHighlightRanges } from "@/lib/search-text";

/**
 * 命中片段高亮（TASK-010）：依 findHighlightRanges 分段渲染 <mark>
 * - React 自動 escape（無 dangerouslySetInnerHTML，XSS 安全）
 * - 日期感知：查詢詞 `11月` 會高亮片段中的 `2026-11-02`
 */
export function HighlightSnippet({
  text,
  terms,
}: {
  text: string;
  terms: readonly string[];
}) {
  const ranges = findHighlightRanges(text, terms);
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-800">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
