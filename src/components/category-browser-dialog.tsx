"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  buildCategoryIndex,
  findAncestors,
  type FlatCategory,
} from "@/lib/category-tree";

/**
 * 檔案對話框式分類選擇器（TASK-012 後續，取代搜尋下拉）
 * - 上方：路徑列（根目錄 / 服務商 / 阿里雲…），點擊可跳轉
 * - 下方：目前位置下的子分類清單，滑鼠/方向鍵瀏覽
 * - 滑鼠/觸控：**單擊即進入**（行動裝置友善）；鍵盤：↑↓ 移動高亮；
 *   Enter 進入高亮資料夾（空資料夾 Enter = 確認此位置）；Backspace 回上一層；
 *   Space 選取（高亮優先，否則選目前位置）；Esc 取消
 * - excludeIds：不顯示（也不可進入）的分類（編輯表單排除自己與子孫）
 */
export function CategoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  excludeIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (categoryId: string) => void;
  excludeIds?: ReadonlySet<string>;
}) {
  const list = trpc.category.list.useQuery(undefined, { enabled: open });
  const index = useMemo(
    () => buildCategoryIndex(list.data ?? []),
    [list.data],
  );

  // 位置於關閉後保留（Finder 式：連續加多個同分支分類更方便；點路徑列「根目錄」可回頂）
  const [currentId, setCurrentId] = useState<string | null>(null);
  // highlight = -1 表示「沒有高亮項目」（滑鼠單擊進入後），Space 選目前位置
  const [highlight, setHighlight] = useState(-1);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const children = useMemo(() => {
    const rows = (list.data ?? []).filter(
      (c) => c.parentId === currentId && !excludeIds?.has(c.id),
    );
    const collator = new Intl.Collator("zh-Hant-TW");
    return rows.sort((a, b) => collator.compare(a.name, b.name));
  }, [list.data, currentId, excludeIds]);

  const ancestors = useMemo(
    () => (currentId ? findAncestors(currentId, index) : []),
    [currentId, index],
  );
  const current = currentId ? index.get(currentId) : undefined;

  // 高亮變更時捲入視野
  useEffect(() => {
    if (highlight >= 0) {
      rowRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  function enter(node: FlatCategory) {
    setCurrentId(node.id);
    setHighlight(-1);
  }

  function goUp() {
    const parentId = currentId ? (index.get(currentId)?.parentId ?? null) : null;
    setCurrentId(parentId);
    setHighlight(-1);
  }

  function confirm() {
    // Space/選取按鈕：高亮優先，否則選目前位置（根目錄不可選）
    const target =
      highlight >= 0 && children[highlight] ? children[highlight] : currentId ? current : undefined;
    if (!target) return;
    onSelect(target.id);
    onOpenChange(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (children.length === 0 ? -1 : (h + 1) % children.length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => {
          if (children.length === 0) return -1;
          return h <= 0 ? children.length - 1 : h - 1;
        });
        break;
      case "Enter":
        e.preventDefault();
        if (highlight >= 0 && children[highlight]) {
          enter(children[highlight]);
        } else if (currentId) {
          // 空資料夾：Enter 確認目前位置
          onSelect(currentId);
          onOpenChange(false);
        }
        break;
      case "Backspace":
        e.preventDefault();
        goUp();
        break;
      case " ":
        e.preventDefault();
        confirm();
        break;
      default:
        break;
    }
  }

  const canConfirm = (highlight >= 0 && children.length > 0) || currentId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>選擇分類</DialogTitle>
          <DialogDescription>
            單擊進入、↑↓ 移動、Enter 進入、Backspace 上一層、Space 選取
          </DialogDescription>
        </DialogHeader>

        <div
          ref={listRef}
          tabIndex={0}
          autoFocus
          onKeyDown={onKeyDown}
          className="flex flex-col gap-3 outline-none"
        >
          {/* 路徑列（檔案管理員式） */}
          <nav
            aria-label="目前路徑"
            className="flex flex-wrap items-center gap-1 rounded-md bg-zinc-100 px-2 py-1.5 text-sm dark:bg-zinc-900"
          >
            <button
              type="button"
              className={currentId === null ? "font-medium" : "hover:underline"}
              onClick={() => {
                setCurrentId(null);
                setHighlight(-1);
              }}
            >
              根目錄
            </button>
            {ancestors.map((a) => (
              <span key={a.id} className="flex items-center gap-1">
                <span className="text-zinc-400">/</span>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => {
                    setCurrentId(a.id);
                    setHighlight(-1);
                  }}
                >
                  {a.name}
                </button>
              </span>
            ))}
            {current ? (
              <span className="flex items-center gap-1">
                <span className="text-zinc-400">/</span>
                <span className="font-medium">{current.name}</span>
              </span>
            ) : null}
          </nav>

          {/* 子分類清單 */}
          <div className="max-h-64 min-h-24 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {children.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">
                {currentId
                  ? "此分類下沒有子分類（Enter/Space 選取此位置）"
                  : "沒有分類"}
              </p>
            ) : (
              <ul role="listbox" aria-label="子分類">
                {children.map((c, i) => (
                  <li key={c.id} role="option" aria-selected={i === highlight}>
                    <button
                      ref={(el) => {
                        rowRefs.current[i] = el;
                      }}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                        i === highlight
                          ? "bg-zinc-100 dark:bg-zinc-800"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => enter(c)} // 單擊即進入（行動裝置友善）
                    >
                      <span className="break-all">▸ {c.name}</span>
                      <span className="shrink-0 text-xs text-zinc-400">資料夾</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消（Esc）
          </Button>
          <Button disabled={!canConfirm} onClick={confirm}>
            {highlight >= 0 && children[highlight]
              ? `選取：${children[highlight].name}`
              : "選取此位置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
