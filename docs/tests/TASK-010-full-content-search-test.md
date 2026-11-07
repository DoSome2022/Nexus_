# TASK-010 實測報告：全欄位內容搜尋（Google 式）

日期：2026-11-02
帳密：`測試AC.md`（demo `demo@nexus.local / demo123456`、admin `admin@admin.com / 12345678`）

## 單元測試（vitest）

```
Test Files  15 passed (15)
     Tests  163 passed (163)
```

新增/更新 33 案：

| 檔案 | 涵蓋 |
|---|---|
| `search-text.test.ts`（新，26 案） | flattenSearchValues（巢狀/陣列/數字/跳過 boolean·null·NaN/深度守衛/控制字元剝除）、deriveDateTokens（`-`/`/`/`年` 三格式、衍生詞、去重、年月無日、無效日期）、buildSearchContent/getDisplayText 往返、tokenizeQuery（全形空白/去重/上限 10）、escapeLikePattern、matchesAllTerms/countTitleMatches（AND、日期詞命中）、findHighlightRanges（case-insensitive、日期感知、重疊合併、年/日精確）、makeSnippet（開窗/省略號/前導摘錄/null/日期高亮）、buildDisplayText |
| `record-service.test.ts`（+6） | 作者保密檔案內容命中並合併排序（標題命中優先）、withSnippet 片段（含保密檔案內容）、非作者保密不掃（canRead 先擋不讀檔）、檔案損毀跳過 + logger.error、DTO 不含 data/schema/searchContent、create 非保密含 searchContent 保密不含 |
| `record-update.test.ts`（+5） | data 變更重建、僅 title 變更重建（title 日期詞）、legacy NULL 補值不寫 ChangeLog 仍寫 OperationLog、無變更零寫入、保密 payload 永不含 searchContent |
| `record-schema.test.ts`（+1） | withSnippet 預設 false / true 接受 / 非 boolean 拒絕 |

`./harness/scripts/check.sh`（lint → typecheck → test → build）✅ 全過。

## Migration 與 Backfill

- `prisma migrate dev` 套用 `20261102121320_add_search_content` ✅；
  `\d+ "Record"`：searchVector 表達式含 `searchContent`、`Record_search_content_trgm_idx`、
  CHECK `Record_confidential_no_search_content` 皆在
- `npm run backfill:search`：掃描 14 筆非保密、更新 14 筆、保密防禦清除 0 筆 ✅
- 不變式：`isConfidential=false AND searchContent IS NULL` = **0**；
  `isConfidential=true AND searchContent IS NOT NULL` = **0** ✅

## 搜尋整合實測（tsx 對真實 DB，走 service 層）

| # | 使用者 | 查詢 | 預期 | 結果 |
|---|---|---|---|---|
| 1 | admin2（hangs 作者） | `網頁` | 找到 hangs，snippet 含「網頁」 | ✅ |
| 2 | admin2 | `11月` | hangs（修改日子 2026-11-02）+ Q4 產品例會（meeting_date） | ✅ |
| 3 | admin2 | `網頁 工程師` | hangs（多詞 AND） | ✅ |
| 4 | admin2 | `網頁 不存在詞` | 空 | ✅ |
| 5 | demo | `體檢` | 找到自己的保密「機密：甲君體檢報告」（localdata 內容） | ✅ |
| 6 | admin1 | `體檢` | 看不到 demo 的保密 | ✅ |
| 7 | demo | `11月` | 含「驗證：週會 2026-11-02」（title 日期衍生詞） | ✅ |
| 8 | admin2 | `%` | 空（無 LIKE 萬用字注入） | ✅ |
| 9 | admin2 | `_` | 只命中內容真的含 `_` 的記錄（hangs 內有 Hangs_v2） | ✅ |

## 頁面 SSR 實測（curl 登入 demo）

| # | 頁面 | 預期 | 結果 |
|---|---|---|---|
| 10 | `/search?q=網頁` | 200；hangs 卡片下方片段；`<mark>網頁</mark>` | ✅（見 HTML：`2026-11-02 Johnny # 今日 Code 改動總結… <mark class="rounded-sm bg-yellow-200 …">網頁</mark> ## 背景…`） |
| 11 | suggest 下拉 / 關聯選取器 | 同一 procedure、內容命中、標題式顯示（withSnippet 預設 false） | ✅（共用 query，未開片段） |

## 重現方式

```bash
npm run backfill:search                       # migration 後回填既有資料
npm run test                                  # 163 案
./harness/scripts/check.sh                    # lint + typecheck + test + build
# 手測：登入後 /search?q=網頁、q=11月、q=網頁 工程師；demo 搜「體檢」
```

## 已知限制

- 保密資料僅字面 + 日期衍生詞比對，**不做同義詞**（送 PG 會讓保密內容進 DB，違反 TASK-004）
- 保密檔案掃描每次搜尋讀作者全部保密檔（debounce 300ms + 60/min rate limit 內；量大可加快取）
- 中文同義詞仍受限 PG 無分詞：`員工` 查詢經 thesaurus 展開、`員工手冊` 為單一 token（TASK-006 已知）
- 日期格式支援 `Y-M-D` / `Y/M/D` / `Y年M月D日` / `Y年M月`；全形數字未支援
- snippet 以第一個命中開窗（120 字元），無段落欄位對應
