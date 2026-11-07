/**
 * 關聯建議純函式（TASK-009，可單元測試）
 * - 掃描記錄的標題 + data 文字值，找出「其他記錄標題」的完整子字串提及
 * - 只建議、不自動建立；加入走既有 relation.create
 */

export interface RelationSuggestionCandidate {
  id: string;
  title: string;
  isConfidential: boolean;
}

export type RelationSuggestionDTO = RelationSuggestionCandidate;

/** 單一候選標題最短長度（避免單字中文如「王」的雜訊） */
export const MIN_TITLE_LENGTH = 2;

/** 建議上限 */
export const MAX_SUGGESTIONS = 10;

/** 文字提取預算：總字元數（data 上限 1MB，防呆） */
export const TEXT_BUDGET = 100_000;

/** 遞迴深度守衛 */
export const MAX_DEPTH = 8;

/** 收集標題 + data 內所有字串值（物件/陣列遞迴；超預算或超深度即停） */
export function flattenText(title: string, data: unknown): string[] {
  const texts: string[] = [];
  let budget = TEXT_BUDGET;

  function push(s: string): void {
    if (budget <= 0) return;
    const trimmed = s.trim();
    if (trimmed === "") return;
    budget -= trimmed.length;
    texts.push(trimmed);
  }

  function walk(value: unknown, depth: number): void {
    if (budget <= 0 || depth > MAX_DEPTH) return;
    if (typeof value === "string") {
      push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
    } else if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
    // number/boolean/null 不參與比對（不是「提及」）
  }

  push(title);
  walk(data, 0);
  return texts;
}

/**
 * title 是否以「完整子字串」出現在 text 中
 * ASCII 標題加邊界守衛（`IT` 不會配到 `WHITE`；`Net` 不會配到 `Network`）
 * 中文無分詞 → 純 substring（誤配靠 ≥2 字 + 手動加入兜底，文件已註明）
 */
export function containsTitle(text: string, title: string): boolean {
  const index = text.indexOf(title);
  if (index === -1) return false;

  const isAsciiTitle = /^[A-Za-z0-9_]+$/.test(title);
  if (!isAsciiTitle) return true;

  const before = text[index - 1];
  const after = text[index + title.length];
  const isBoundary = (ch: string | undefined): boolean =>
    ch === undefined || !/[A-Za-z0-9_]/.test(ch);
  return isBoundary(before) && isBoundary(after);
}

/** 找出記錄（標題 + data）中提及的候選標題；排除 excludeIds；較具體（長）者優先，cap 10 */
export function findTitleMentions(
  title: string,
  data: unknown,
  candidates: RelationSuggestionCandidate[],
  excludeIds: ReadonlySet<string>,
): RelationSuggestionDTO[] {
  const texts = flattenText(title, data);
  const matches = candidates
    .filter((c) => !excludeIds.has(c.id))
    .filter((c) => c.title.trim().length >= MIN_TITLE_LENGTH)
    .filter((c) => texts.some((text) => containsTitle(text, c.title.trim())));

  return matches
    .sort((a, b) => {
      const byLength = b.title.length - a.title.length; // 長標題（較具體）優先
      if (byLength !== 0) return byLength;
      return a.title.localeCompare(b.title, "zh-Hant");
    })
    .slice(0, MAX_SUGGESTIONS)
    .map((c) => ({ id: c.id, title: c.title, isConfidential: c.isConfidential }));
}
