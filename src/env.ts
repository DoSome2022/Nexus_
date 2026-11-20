import { z } from "zod";

/**
 * 環境變數 Zod 驗證（依 .claude/CLAUDE.security.md Secret 管理）
 * - 只從 process.env 讀取，啟動時 fail-fast
 * - 新增環境變數請同步更新 .env.example
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.string().default("true"),
  APP_URL: z.string().url(),
  // 保密資料檔案儲存目錄（TASK-004）；容器內 bind mount 為 /app/localdata
  LOCALDATA_DIR: z.string().default("./localdata"),
  // 隱藏資料庫總覽頁 /admin/db 的 URL token（TASK-011）；未設定時該頁一律 404
  ADMIN_DB_TOKEN: z.string().min(32, "ADMIN_DB_TOKEN must be at least 32 chars").optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`環境變數驗證失敗（請對照 .env.example）: ${issues}`);
  }
  return parsed.data;
}

let cached: Env | null = null;

/** 懶載入 singleton：首次存取才驗證並快取（避免 next build 階段無 .env 被擋） */
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
