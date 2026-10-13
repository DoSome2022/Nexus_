# TASK-006 近義詞搜尋測試報告

- **日期**：2026-10-13
- **範圍**：synonym/thesaurus dictionary、tsvector generated column、近義詞命中、權限過濾、排序
- **環境**：dev server + Docker db（thesaurus 檔 bind mount）+ 7 筆 seed 資料
- **結論**：**全過**；過程中修正 2 個 PG 字典實作錯誤（見踩坑）

## 測試結果

| # | 類別 | 測試 | 結果 |
|---|---|---|---|
| 1 | 字典 | `ts_lexize('nexus_syn','員工')` | ✅ `{僱員,同事}` 多同義詞展開 |
| 2 | 字典 | `to_tsvector('nexus_zh','員工')` | ✅ `'僱員':1 '同事':2` |
| 3 | 搜尋 | 搜「僱員」→ 命中 title「員工」 | ✅（demo 2 筆、admin 1 筆） |
| 4 | 搜尋 | 搜「同事」→ 命中 title「員工」 | ✅ 雙向命中 |
| 5 | 搜尋 | 搜「員工」→ 直接相符（員工 ×2 + 員工手冊 ILIKE） | ✅ ILIKE 不退化 |
| 6 | 權限 | admin 搜「僱員」看不到 demo 私有「員工」 | ✅ 只回自己公開 1 筆 |
| 7 | 結構 | generated column + GIN index | ✅ `Record_search_vector_idx`、`is_generated=ALWAYS` |
| 8 | 遷移 | migrate status | ✅ up to date、6 個索引無 drift 誤刪 |
| 9 | 回歸 | 66 個單測 + Harness | ✅ 全過 |

## 踩坑記錄（重要，PG 全文檢索實作必讀）

1. **synonym template 的檔案格式不是冒號格式**：`word : synonyms`（冒號）是 **thesaurus template** 的格式；
   synonym template 每行是「主詞 單一同義詞」（只支援一個）。用錯 template 會得到 `{:}` 的怪 lexeme。
   → 改用 `TEMPLATE = thesaurus, DictFile = nexus_syn, Dictionary = simple`。
2. **thesaurus template 讀 `.ths` 副檔名**（synonym 讀 `.syn`）——DictFile 自動加副檔名，
   檔名要對應。migration 1 用 synonym template（讀 `.syn`）→ 保留 `.syn` legacy 檔供 fresh clone 重播，
   實際使用 `.ths`（兩檔內容需同步）。
3. **file-level bind mount 會被編輯器替換檔打斷**（atomic rename 換 inode）：
   改字典檔後必須 `docker compose restart db` 重掛 + `ALTER TEXT SEARCH DICTIONARY` 重載 +
   `UPDATE "Record" SET title = title;` 重建 generated column。
4. **generated column 依賴 TEXT SEARCH CONFIGURATION**（PG 有記錄 dependency）：
   要換 dictionary 必須先 drop column（不是 drop config 就好）。
5. Prisma 不認識 generated column 的 default（`--create-only` 會想產生 `DROP DEFAULT` 的 draft）→ 勿直接套用，
   一律手寫 migration SQL。
6. **中文無分詞**：title「員工手冊」是單一 token，詞典的「員工」詞條不會命中它；
   近義詞只對完整詞組生效（zhparser 需自訂映像，另開 Task）。

## 重現方式（命令摘要）

```bash
# 字典驗證
docker compose exec -T db psql -U nexus -d nexus \
  -c "SELECT * FROM ts_lexize('nexus_syn', '員工');" \
  -c "SELECT to_tsvector('nexus_zh', '員工'), plainto_tsquery('nexus_zh', '僱員');"

# 搜尋（先登入）
curl -b cookies.txt -G http://localhost:3000/api/trpc/record.search \
  --data-urlencode 'input={"q":"僱員"}'
```

## 已知限制（設計上接受）

- 中文無分詞：近義詞僅完整詞組有效（如 title 恰為「員工」；「員工手冊」需另加詞條）
- 詞典更新流程需 restart db（bind mount inode 問題）
