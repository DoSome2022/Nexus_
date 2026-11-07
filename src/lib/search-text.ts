/**
 * 全欄位內容搜尋純函式（TASK-010，可單元測試）
 * - searchContent 佈局：`<data 扁平文字，\n 連接>` + U+001F + `<日期衍生詞（data + title）>`
 *   （U+001F 分隔讓 snippet 只取顯示段；控制字元在 extraction 時剝除）
 * - 查詢：空白切詞、每詞 AND、LIKE 萬用字 escape（SQL ESCAPE '\'）
 * - 日期衍生詞：`2026-11-02` → 同時可被 `11月` 命中（含 highlight 日期感知）
 */

export const SEARCH_TEXT_BUDGET = 100_000;
export const SEARCH_TEXT_MAX_DEPTH = 8;
export const SEARCH_CONTENT_SEPARATOR = "\u001F";
export const MAX_SEARCH_TERMS = 10;
export const SNIPPET_MAX_LENGTH = 120;
export const MAX_DATE_TOKENS = 2000;

/** 剝除的控制字元（保留 \n \t \r；含 U+001F 分隔符本身） */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** raw 日期掃描（TASK-010 支援的格式） */
const DATE_TEXT_RES: readonly RegExp[] = [
  /(?<!\d)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g,
  /(?<!\d)(\d{4})年(\d{1,2})月(\d{1,2})日(?!\d)/g,
  /(?<!\d)(\d{4})年(\d{1,2})月(?!\d)/g,
];

/** 日期查詢詞：`M月` / `M月D日` / `Y年M月` / `Y年M月D日` */
const DATE_QUERY_RE = /^(?:(\d{4})年)?(\d{1,2})月(?:(\d{1,2})日)?$/;

function isRealDate(year: number, month: number, day: number): boolean {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * 收集 data 內所有字串值（trim、非空）+ 有限數字（String(v)）
 * 物件/陣列遞迴；跳過 boolean/null/NaN/Infinity；深度/預算守衛
 * 與 relation-suggest.flattenText 差異：數字也參與（搜尋需可搜數字）
 */
export function flattenSearchValues(value: unknown): string[] {
  const texts: string[] = [];
  let budget = SEARCH_TEXT_BUDGET;

  function push(raw: string): void {
    if (budget <= 0) return;
    const cleaned = raw.replace(CONTROL_CHARS_RE, "").trim();
    if (cleaned === "") return;
    budget -= cleaned.length;
    texts.push(cleaned);
  }

  function walk(v: unknown, depth: number): void {
    if (budget <= 0 || depth > SEARCH_TEXT_MAX_DEPTH) return;
    if (typeof v === "string") {
      push(v);
    } else if (typeof v === "number" && Number.isFinite(v)) {
      push(String(v));
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else if (typeof v === "object" && v !== null) {
      for (const item of Object.values(v)) walk(item, depth + 1);
    }
    // boolean/null 不參與（非內容）
  }

  walk(value, 0);
  return texts;
}

/** data 顯示段（snippet 來源） */
export function buildDisplayText(data: unknown): string {
  return flattenSearchValues(data).join("\n");
}

/** 掃描文字內的日期，產出衍生詞（M月 / M月D日 / Y年M月 / Y年M月D日 / Y-M-D / Y/M/D）；去重、上限守衛 */
export function deriveDateTokens(text: string): string[] {
  if (text.length === 0) return [];
  const tokens = new Set<string>();

  for (const re of DATE_TEXT_RES) {
    for (const m of text.matchAll(re)) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = m[3] === undefined ? null : Number(m[3]);
      if (d !== null && !isRealDate(y, mo, d)) continue;
      if (d !== null) {
        tokens.add(`${mo}月`);
        tokens.add(`${mo}月${d}日`);
        tokens.add(`${y}年${mo}月`);
        tokens.add(`${y}年${mo}月${d}日`);
        tokens.add(`${y}-${mo}-${d}`);
        tokens.add(`${y}/${mo}/${d}`);
      } else {
        tokens.add(`${mo}月`);
        tokens.add(`${y}年${mo}月`);
      }
      if (tokens.size >= MAX_DATE_TOKENS) break;
    }
    if (tokens.size >= MAX_DATE_TOKENS) break;
  }
  return [...tokens];
}

/** 建 searchContent（顯示段 + SEP + 日期衍生詞）；兩者皆空回 "" */
export function buildSearchContent(title: string, data: unknown): string {
  const display = buildDisplayText(data);
  const tokens = new Set<string>();
  for (const t of deriveDateTokens(display)) tokens.add(t);
  for (const t of deriveDateTokens(title)) tokens.add(t);
  const suffix = [...tokens].join(" ");
  if (display === "" && suffix === "") return "";
  return `${display}${SEARCH_CONTENT_SEPARATOR}${suffix}`;
}

/** searchContent 的顯示段（SEP 之前） */
export function getDisplayText(searchContent: string | null | undefined): string {
  if (!searchContent) return "";
  const idx = searchContent.indexOf(SEARCH_CONTENT_SEPARATOR);
  return idx === -1 ? searchContent : searchContent.slice(0, idx);
}

/** 查詢切詞：空白（含全形 U+3000）切分、剝控制字元、case-insensitive 去重、上限 10 */
export function tokenizeQuery(q: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of q.split(/\s+/u)) {
    const t = raw.replace(CONTROL_CHARS_RE, "").trim();
    if (t === "") continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
    if (terms.length >= MAX_SEARCH_TERMS) break;
  }
  return terms;
}

/** LIKE pattern 萬用字 escape（先 \ 再 % _；SQL 側用 ESCAPE '\'） */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/** 每詞是否都命中標題或索引文字（保密檔案 JS 比對用；日期詞靠衍生詞已在 indexText 內） */
export function matchesAllTerms(
  title: string,
  indexText: string,
  terms: readonly string[],
): boolean {
  const titleLower = title.toLowerCase();
  const textLower = indexText.toLowerCase();
  return terms.every((t) => {
    const lower = t.toLowerCase();
    return titleLower.includes(lower) || textLower.includes(lower);
  });
}

/** 命中標題的詞數（排序訊號：標題命中 > 內容命中） */
export function countTitleMatches(terms: readonly string[], title: string): number {
  const titleLower = title.toLowerCase();
  let count = 0;
  for (const t of terms) {
    if (titleLower.includes(t.toLowerCase())) count += 1;
  }
  return count;
}

export interface HighlightRange {
  start: number;
  end: number;
}

interface DateQuery {
  year?: number;
  month: number;
  day?: number;
}

function parseDateQuery(term: string): DateQuery | null {
  const m = DATE_QUERY_RE.exec(term);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const year = m[1] === undefined ? undefined : Number(m[1]);
  const day = m[3] === undefined ? undefined : Number(m[3]);
  if (day !== undefined && !isRealDate(year ?? 2000, month, day)) return null;
  return { year, month, day };
}

function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * 命中區間：字面比對 + 日期感知（`11月` 會高亮文字中的 `2026-11-02`）；重疊/相鄰合併
 */
export function findHighlightRanges(
  text: string,
  terms: readonly string[],
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const lowerText = text.toLowerCase();

  for (const term of terms) {
    if (term === "") continue;
    const lower = term.toLowerCase();

    // 1) 字面比對（case-insensitive）
    let idx = lowerText.indexOf(lower);
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + term.length });
      idx = lowerText.indexOf(lower, idx + term.length);
    }

    // 2) 日期感知：查詢詞像日期（11月 等）→ 標記文字中的 raw 日期
    const query = parseDateQuery(term);
    if (query) {
      for (const re of DATE_TEXT_RES) {
        for (const m of text.matchAll(re)) {
          const y = Number(m[1]);
          const mo = Number(m[2]);
          const d = m[3] === undefined ? null : Number(m[3]);
          if (query.year !== undefined && y !== query.year) continue;
          if (mo !== query.month) continue;
          if (query.day !== undefined && (d === null || d !== query.day)) continue;
          ranges.push({ start: m.index, end: m.index + m[0].length });
        }
      }
    }
  }
  return mergeRanges(ranges);
}

/**
 * 命中片段：塌縮空白 → 以第一個命中為中心開窗（前 1/3）→ 前後 `…`
 * 無字面命中（如向量同義詞命中）→ 前導摘錄；空文字回 null
 */
export function makeSnippet(
  text: string,
  terms: readonly string[],
  maxLength: number = SNIPPET_MAX_LENGTH,
): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;

  const ranges = findHighlightRanges(collapsed, terms);
  if (ranges.length > 0) {
    const first = ranges[0];
    let start = Math.max(0, first.start - Math.floor(maxLength / 3));
    const end = Math.min(collapsed.length, start + maxLength);
    if (end - start < maxLength) start = Math.max(0, end - maxLength); // 命中靠尾時補滿
    const prefix = start > 0 ? "…" : "";
    const suffix = end < collapsed.length ? "…" : "";
    return `${prefix}${collapsed.slice(start, end)}${suffix}`;
  }

  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength)}…`;
}
