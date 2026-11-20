import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DB_OVERVIEW_LIMITS, dbOverviewLimitParam, type DbOverviewCell } from "@/lib/db-overview";
import type { DbOverviewTableData } from "@/server/services/db-overview-service";

/**
 * /admin/db 單一資料表區塊（TASK-011）
 * Server component：無互動狀態；筆數 select + 套用按鈕提交同一個 GET form
 * 敏感欄位（passwordHash/tokenHash）依需求完全顯示，不加遮罩
 */
function DbCell({ cell }: { cell: DbOverviewCell }) {
  if (cell.kind === "json") {
    return (
      <pre className="max-h-72 max-w-md overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
        {cell.text}
      </pre>
    );
  }
  if (cell.kind === "error") {
    return (
      <pre className="max-w-md overflow-auto whitespace-pre-wrap break-all rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
        {cell.text}
      </pre>
    );
  }
  if (cell.kind === "null") {
    return <span className="text-zinc-400">—</span>;
  }
  return <span className="break-all font-mono text-xs">{cell.text}</span>;
}

export function DbOverviewTableCard({ table }: { table: DbOverviewTableData }) {
  const limitParam = dbOverviewLimitParam(table.key);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{table.label}</CardTitle>
          <span className="font-mono text-xs text-zinc-500">{table.key}</span>
          <CardDescription className="flex-1">
            總筆數 {table.total}（顯示 {table.rows.length} 筆）
          </CardDescription>
          <label htmlFor={limitParam} className="text-sm text-zinc-500">
            筆數
          </label>
          <select
            id={limitParam}
            name={limitParam}
            defaultValue={table.limit}
            className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-sm dark:border-zinc-800"
          >
            {DB_OVERVIEW_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            套用
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {table.rows.length === 0 ? (
          <p className="py-8 text-center text-zinc-500">沒有資料</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {table.columns.map((col) => (
                  <TableHead key={col} className="align-top font-mono text-xs">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((cells, rowIndex) => (
                <TableRow key={cells[0]?.text ?? rowIndex}>
                  {cells.map((cell, cellIndex) => (
                    <TableCell key={table.columns[cellIndex]} className="align-top">
                      <DbCell cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
