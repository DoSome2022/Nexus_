/**
 * 分類樹純函式（TASK-012，可單元測試）
 * - FlatCategory 為 DB 扁平表示；巢狀樹與 path 皆在記憶體計算（分類是小表）
 * - 所有向上/向下走訪都有 visited guard（資料異常成環時不 hang）
 */

export interface FlatCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CategoryTreeNode extends FlatCategory {
  children: CategoryTreeNode[];
}

export function buildCategoryIndex(
  categories: readonly FlatCategory[],
): Map<string, FlatCategory> {
  return new Map(categories.map((c) => [c.id, c]));
}

/** 祖先鏈：root → 直接父層（不含自己）；id 不存在回 []；成環防護 */
export function findAncestors(
  id: string,
  index: ReadonlyMap<string, FlatCategory>,
): FlatCategory[] {
  const ancestors: FlatCategory[] = [];
  const seen = new Set<string>([id]);
  let cursor = index.get(id)?.parentId ?? null;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node = index.get(cursor);
    if (!node) break;
    ancestors.push(node);
    cursor = node.parentId;
  }
  return ancestors.reverse();
}

/** root → 自身的名稱序列 */
export function getCategoryNamePath(
  id: string,
  index: ReadonlyMap<string, FlatCategory>,
): string[] {
  const self = index.get(id);
  if (!self) return [];
  return [...findAncestors(id, index).map((c) => c.name), self.name];
}

/** 可讀路徑："食物 / 水果 / 橙"（分類名稱本身含分隔符時仍正確，此為名稱陣列 join） */
export function buildCategoryPath(
  id: string,
  index: ReadonlyMap<string, FlatCategory>,
  separator = " / ",
): string {
  return getCategoryNamePath(id, index).join(separator);
}

/** flat → 巢狀樹；children 依 name zh-Hant-TW collation 排序；parent 遺失視為 root；環→未造訪節點提升 root */
export function buildCategoryTree(
  categories: readonly FlatCategory[],
): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const c of categories) {
    nodes.set(c.id, { ...c, children: [] });
  }
  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (!parent || parent === node) {
      roots.push(node);
      continue;
    }
    // 防環：parent 指向已在自己的子孫鏈上（此處用 visited 檢查 parent 是否為 descendant）
    if (isDescendant(parent, node, nodes)) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }
  // 環狀資料可能使節點互相掛接而無 root：DFS 後未造訪者提升為 root（不遺失、不 hang）
  const visited = new Set<string>();
  const visit = (list: CategoryTreeNode[]): void => {
    for (const n of list) {
      if (visited.has(n.id)) continue;
      visited.add(n.id);
      visit(n.children);
    }
  };
  visit(roots);
  for (const node of nodes.values()) {
    if (!visited.has(node.id)) roots.push(node);
  }
  const collator = new Intl.Collator("zh-Hant-TW");
  const sortedSeen = new Set<string>();
  const sortRec = (list: CategoryTreeNode[]): void => {
    list.sort((a, b) => collator.compare(a.name, b.name));
    for (const n of list) {
      if (sortedSeen.has(n.id)) continue; // 環狀資料防護
      sortedSeen.add(n.id);
      sortRec(n.children);
    }
  };
  sortRec(roots);
  return roots;
}

function isDescendant(
  candidate: CategoryTreeNode,
  ancestor: CategoryTreeNode,
  nodes: ReadonlyMap<string, CategoryTreeNode>,
): boolean {
  const seen = new Set<string>([ancestor.id]);
  let cursor: CategoryTreeNode | undefined = candidate;
  while (cursor && cursor !== ancestor) {
    if (seen.has(cursor.id)) return true; // 成環視為異常，避免掛成環狀
    seen.add(cursor.id);
    cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
  }
  return false;
}

/** 前序攤平（供 select 縮排選項） */
export function flattenCategoryTree(
  nodes: readonly CategoryTreeNode[],
  depth = 0,
): Array<{ node: CategoryTreeNode; depth: number }> {
  const out: Array<{ node: CategoryTreeNode; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (list: readonly CategoryTreeNode[], d: number): void => {
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth: d });
      visit(n.children, d + 1);
    }
  };
  visit(nodes, depth);
  return out;
}

/** 把 id 移到 newParentId 下是否成環（newParentId null → false）；missing 節點視為無父 */
export function wouldCreateCycle(
  id: string,
  newParentId: string | null,
  index: ReadonlyMap<string, FlatCategory>,
): boolean {
  if (!newParentId || newParentId === id) return newParentId === id;
  const seen = new Set<string>([id]);
  let cursor: string | null = newParentId;
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true; // 既有環，保守回 true
    seen.add(cursor);
    cursor = index.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** 子孫 id 集合（含自己）；環防護 */
export function getDescendantIds(
  id: string,
  index: ReadonlyMap<string, FlatCategory>,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of index.values()) {
    if (!c.parentId) continue;
    const list = childrenOf.get(c.parentId) ?? [];
    list.push(c.id);
    childrenOf.set(c.parentId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    for (const child of childrenOf.get(current) ?? []) stack.push(child);
  }
  return out;
}
