import { describe, expect, it } from "vitest";
import {
  buildCategoryIndex,
  buildCategoryPath,
  buildCategoryTree,
  findAncestors,
  flattenCategoryTree,
  getCategoryNamePath,
  getDescendantIds,
  wouldCreateCycle,
  type FlatCategory,
} from "@/lib/category-tree";

/**
 * 分類樹純函式（TASK-012）
 * 核心：巢狀建樹、祖先鏈、path、cycle 防護、環狀資料不 hang
 */

/** 食物 > 水果 > {橙, 蘋果, 香蕉}；食物 > {菜, 肉, 魚} */
const TREE: FlatCategory[] = [
  { id: "food", name: "食物", parentId: null },
  { id: "fruit", name: "水果", parentId: "food" },
  { id: "orange", name: "橙", parentId: "fruit" },
  { id: "apple", name: "蘋果", parentId: "fruit" },
  { id: "banana", name: "香蕉", parentId: "fruit" },
  { id: "veg", name: "菜", parentId: "food" },
  { id: "meat", name: "肉", parentId: "food" },
  { id: "fish", name: "魚", parentId: "food" },
];

describe("buildCategoryTree", () => {
  it("三層樹正確巢狀、children 依 zh-Hant-TW collation 排序", () => {
    const tree = buildCategoryTree(TREE);
    expect(tree).toHaveLength(1);
    const food = tree[0];
    expect(food?.name).toBe("食物");
    const foodChildren = food?.children.map((c) => c.name) ?? [];
    expect(foodChildren).toHaveLength(4);
    expect(new Set(foodChildren)).toEqual(new Set(["菜", "水果", "肉", "魚"]));
    // 排序與實作同一 collator 一致（不硬編 locale 順序）
    const collator = new Intl.Collator("zh-Hant-TW");
    expect(foodChildren).toEqual([...foodChildren].sort((a, b) => collator.compare(a, b)));
    const fruit = food?.children.find((c) => c.id === "fruit");
    const fruitChildren = fruit?.children.map((c) => c.name) ?? [];
    expect(new Set(fruitChildren)).toEqual(new Set(["橙", "蘋果", "香蕉"]));
    expect(fruitChildren).toEqual([...fruitChildren].sort((a, b) => collator.compare(a, b)));
  });

  it("空輸入回 []", () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it("parent 不存在視為 root", () => {
    const tree = buildCategoryTree([{ id: "a", name: "孤兒", parentId: "missing" }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe("a");
  });

  it("資料成環不 hang、不遺失節點、不重複渲染", () => {
    const cyclic: FlatCategory[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    const tree = buildCategoryTree(cyclic);
    const flat = flattenCategoryTree(tree);
    expect(flat.map((f) => f.node.id).sort()).toEqual(["a", "b"]);
  });
});

describe("findAncestors / getCategoryNamePath / buildCategoryPath", () => {
  const index = buildCategoryIndex(TREE);

  it("root → parent 順序（不含自己）", () => {
    expect(findAncestors("orange", index).map((c) => c.name)).toEqual(["食物", "水果"]);
  });

  it("root 節點祖先為空", () => {
    expect(findAncestors("food", index)).toEqual([]);
  });

  it("missing id 回 []", () => {
    expect(findAncestors("nope", index)).toEqual([]);
  });

  it("namePath 為 root → self", () => {
    expect(getCategoryNamePath("orange", index)).toEqual(["食物", "水果", "橙"]);
  });

  it("path 預設分隔符與自訂分隔符", () => {
    expect(buildCategoryPath("orange", index)).toBe("食物 / 水果 / 橙");
    expect(buildCategoryPath("orange", index, " > ")).toBe("食物 > 水果 > 橙");
  });

  it("名稱含分隔符也不被切割", () => {
    const idx = buildCategoryIndex([
      { id: "p", name: "食/物", parentId: null },
      { id: "c", name: "水 果", parentId: "p" },
    ]);
    expect(buildCategoryPath("c", idx)).toBe("食/物 / 水 果");
  });

  it("成環不 hang", () => {
    const idx = buildCategoryIndex([
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);
    expect(() => findAncestors("a", idx)).not.toThrow();
  });
});

describe("wouldCreateCycle", () => {
  const index = buildCategoryIndex(TREE);

  it("移到自己的子孫下 → true", () => {
    expect(wouldCreateCycle("food", "orange", index)).toBe(true);
  });

  it("移到自己 → true", () => {
    expect(wouldCreateCycle("fruit", "fruit", index)).toBe(true);
  });

  it("移到無關節點 / 根 → false", () => {
    expect(wouldCreateCycle("veg", "fruit", index)).toBe(false);
    expect(wouldCreateCycle("orange", null, index)).toBe(false);
  });

  it("newParentId null → false", () => {
    expect(wouldCreateCycle("fruit", null, index)).toBe(false);
  });
});

describe("getDescendantIds", () => {
  const index = buildCategoryIndex(TREE);

  it("子樹完整（含自己）", () => {
    expect(getDescendantIds("fruit", index).sort()).toEqual(
      ["fruit", "orange", "apple", "banana"].sort(),
    );
  });

  it("葉節點只有自己", () => {
    expect(getDescendantIds("orange", index)).toEqual(["orange"]);
  });

  it("成環不 hang", () => {
    const idx = buildCategoryIndex([
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);
    expect(() => getDescendantIds("a", idx)).not.toThrow();
  });
});

describe("flattenCategoryTree", () => {
  it("depth 正確（前序）", () => {
    const flat = flattenCategoryTree(buildCategoryTree(TREE));
    expect(flat.find((f) => f.node.id === "food")?.depth).toBe(0);
    expect(flat.find((f) => f.node.id === "fruit")?.depth).toBe(1);
    expect(flat.find((f) => f.node.id === "orange")?.depth).toBe(2);
  });
});
