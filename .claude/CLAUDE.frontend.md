# CLAUDE.frontend.md — 前端專業編碼風格

## 原則

可讀性 > 聰明；元件純粹；狀態最小化。

## 檔案與命名

- 元件檔：`kebab-case.tsx`（例：`search-bar.tsx`）
- 工具檔：`camelCase.ts`（例：`format-date.ts`）
- 型別：`PascalCase`
- 常數：`SCREAMING_SNAKE_CASE`

## 元件結構（固定順序）

```tsx
// 1. imports：外部 → @/ 別名 → 相對 → 型別
// 2. 型別 / zod schema
// 3. 元件本體
// 4. 子元件（如有）
```

## Server vs Client

- 預設 Server Component
- 僅互動處才 `"use client"`
- 禁止用 useEffect 做資料獲取 → 改用 RSC 或 tRPC hooks

## 資料獲取

- Server Component：tRPC server caller 或 service
- Client Component：tRPC React hooks
- 禁止在元件內直接呼叫 Prisma

## 表單

- React Hook Form + zodResolver
- Zod schema 與後端共用（放 `src/lib/schemas/`）
- 錯誤顯示用 Shadcn FormMessage

## UI / 樣式

- Shadcn UI 為主
- Tailwind，禁止 inline style（除動態值）
- 禁止自幹重複元件

## 狀態管理

- 本地：useState / useReducer
- 跨頁：URL searchParams（搜尋條件優先走 URL）
- 全域：避免；必要時 Zustand

## 搜尋 UI 專屬規則

- 輸入 debounce 300ms
- 用 useTransition 避免阻塞
- 首頁：搜尋條置中
- 結果頁：搜尋條置頂，下方列表
- 無結果：顯示「沒有數據」

## 效能

- 大列表用虛擬化
- 圖片用 next/image
- 重型元件 dynamic import

## 錯誤處理

- 每路由必備 error.tsx + not-found.tsx
- 錯誤訊息不可洩漏內部細節

## 無障礙

- 互動元素需 aria-*
- 鍵盤可操作

## 禁止

- ❌ `any`
- ❌ useEffect 做資料獲取
- ❌ 元件內直接 fetch DB
- ❌ 把 secret 傳到 client
- ❌ 在 client 直接用 Prisma
