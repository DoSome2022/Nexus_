import Link from "next/link";
import type { CategoryTreeNode } from "@/lib/category-tree";

/**
 * 分類樹縮排列表（TASK-012，Server Component）
 * 遞迴渲染：每節點連結到 /categories/[id]；縮排用巢狀 pl-4
 */
export function CategoryTreeView({ nodes }: { nodes: readonly CategoryTreeNode[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            href={`/categories/${node.id}`}
            className="inline-block rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {node.name}
          </Link>
          {node.children.length > 0 ? (
            <div className="pl-4">
              <CategoryTreeView nodes={node.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
