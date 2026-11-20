import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createCallerFactory } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { getDb } from "@/server/db";
import { DeleteRequestButton } from "@/components/delete-request-button";
import { RelationDeleteButton } from "@/components/relation-delete-button";
import { RelationPicker } from "@/components/relation-picker";
import { RelationSuggestions } from "@/components/relation-suggestions";
import { CategoryManager } from "@/components/category-manager";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecordDataView } from "@/components/record-data-view";
import { parseRecordTemplateSnapshot, schemaMatchesData } from "@/lib/template-data";

/**
 * 檢視頁（TASK-003 / TASK-008）：canRead 檢查在 service；保密內容從 localdata 檔案載入
 * 範本相符 → 友善欄位顯示；無範本/不符 → 原始 JSON
 */
const createCaller = createCallerFactory(appRouter);

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hl?: string }>;
}) {
  const { id } = await params;
  const { hl } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const caller = createCaller({ db: getDb(), headers: new Headers(), session });

  let record;
  try {
    record = await caller.record.get({ id });
  } catch {
    notFound(); // 無權限/不存在一律 404（不洩漏存在性）
  }

  const snapshot = parseRecordTemplateSnapshot(record.schema);
  const dataMatches = snapshot !== null && schemaMatchesData(snapshot, record.data);

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-black">
      <Link href="/" className="self-start text-sm text-zinc-500 hover:text-zinc-700">
        ← 回首頁
      </Link>
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="break-all">{record.title}</CardTitle>
            <span className="flex shrink-0 gap-1">
              {record.isConfidential ? (
                <Badge variant="destructive">保密</Badge>
              ) : record.isPublic ? (
                <Badge variant="secondary">公開</Badge>
              ) : (
                <Badge variant="outline">私有</Badge>
              )}
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            更新於 {record.updatedAt.toLocaleString("zh-Hant-TW")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {dataMatches && snapshot ? (
            <RecordDataView snapshot={snapshot} data={record.data} />
          ) : (
            <>
              {snapshot ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  此資料格式與範本不相符，以下顯示原始 JSON
                </p>
              ) : null}
              <pre className="overflow-x-auto rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
                {JSON.stringify(record.data, null, 2)}
              </pre>
            </>
          )}

          <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="text-sm font-medium">分類</h2>
            <CategoryManager
              recordId={record.id}
              canManage={record.canEdit || session.user.role === "ADMIN"}
              initialCategories={record.categories}
            />
          </section>

          {record.categorySiblings.length > 0 ? (
            <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <h2 className="text-sm font-medium">同分類資料</h2>
              <ul className="flex flex-col gap-1">
                {record.categorySiblings.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      href={`/records/${s.id}`}
                      className="break-all underline-offset-2 hover:underline"
                    >
                      {s.title}
                    </Link>
                    {s.isConfidential ? <Badge variant="destructive">保密</Badge> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="text-sm font-medium">關聯資料</h2>
            {record.relations.length === 0 ? (
              <p className="text-sm text-zinc-500">尚無關聯</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {record.relations.map((rel) => (
                  <li
                    key={rel.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      href={`/records/${rel.related.id}`}
                      className="flex items-center gap-2 underline-offset-2 hover:underline"
                    >
                      <span aria-hidden>{rel.direction === "out" ? "→" : "←"}</span>
                      <span>{rel.related.title}</span>
                      {rel.label ? (
                        <span className="text-zinc-500">（{rel.label}）</span>
                      ) : null}
                      {rel.related.isConfidential ? (
                        <Badge variant="destructive">保密</Badge>
                      ) : null}
                    </Link>
                    {record.canEdit || session.user.role === "ADMIN" ? (
                      <RelationDeleteButton relationId={rel.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <RelationSuggestions
              key={`${id}:${hl ?? ""}`}
              recordId={id}
              autoExpand={hl === "suggestions"}
            />
            <RelationPicker fromId={id} />
          </section>

          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {record.canEdit ? (
              <Link href={`/records/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
                編輯
              </Link>
            ) : null}
            {record.canDelete ? <DeleteRequestButton recordId={id} /> : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
