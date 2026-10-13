import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getEnv } from "@/env";

/**
 * localdata 儲存層（保密資料，TASK-004）
 * - 檔案：localdata/<recordId>.json（路徑僅由 cuid id + basename() 產生，禁止使用者輸入拼路徑）
 * - 原子寫：寫 .tmp → rename / hard link；新檔防覆寫
 * - 軟刪除：移入 localdata/.trash/
 * - 一律經本 repository 存取，禁止元件直接讀寫檔案（.claude/CLAUDE.backend.md）
 */

/** 檔案格式 Zod（寫入前與讀取後都驗證，輸入永不信任） */
const changeEntrySchema = z.object({
  field: z.string(),
  oldValue: z.unknown().nullable().optional(),
  newValue: z.unknown().nullable().optional(),
  actorId: z.string(),
  createdAt: z.string(),
});

export const localRecordFileSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  authorId: z.string(),
  schema: z.unknown(),
  data: z.unknown(),
  changes: z.array(changeEntrySchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ChangeEntry = z.infer<typeof changeEntrySchema>;
export type LocalRecordFile = z.infer<typeof localRecordFileSchema>;

export class LocaldataFileNotFoundError extends Error {
  constructor(recordId: string) {
    super(`localdata 檔案不存在: record=${recordId}`);
    this.name = "LocaldataFileNotFoundError";
  }
}

export class LocaldataInvalidIdError extends Error {
  constructor(recordId: string) {
    super(`非法的 record id（僅允許字母/數字/底線/連字號）: ${recordId}`);
    this.name = "LocaldataInvalidIdError";
  }
}

export class LocaldataCorruptedFileError extends Error {
  constructor(recordId: string, cause: unknown) {
    super(`localdata 檔案格式不符或損毀: record=${recordId}`, { cause });
    this.name = "LocaldataCorruptedFileError";
  }
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertSafeId(recordId: string): void {
  if (!SAFE_ID_PATTERN.test(recordId) || recordId !== path.basename(recordId)) {
    throw new LocaldataInvalidIdError(recordId);
  }
}

function localdataDir(): string {
  return getEnv().LOCALDATA_DIR;
}

/** 檔案絕對路徑（export 供測試驗證路徑安全） */
export function recordFilePath(recordId: string): string {
  assertSafeId(recordId);
  return path.join(localdataDir(), `${recordId}.json`);
}

function tmpPath(target: string): string {
  return `${target}.${process.pid}.${Date.now().toString(36)}.tmp`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function serialize(file: LocalRecordFile): string {
  // 寫入前先過 Zod，順帶剝除未知欄位（changes 缺省補 []）
  return JSON.stringify(localRecordFileSchema.parse(file), null, 2);
}

/** 建立新檔案：目標已存在時失敗（防誤覆寫）；hard link 保證不殘留半寫檔案 */
export async function createRecordFile(file: LocalRecordFile): Promise<void> {
  const target = recordFilePath(file.id);
  const tmp = tmpPath(target);
  await ensureDir(path.dirname(target));
  await fs.writeFile(tmp, serialize(file), { mode: 0o600, flag: "wx" });
  try {
    await fs.link(tmp, target); // 目標已存在 → EEXIST，不會覆寫
  } finally {
    await fs.unlink(tmp).catch(() => {
      // tmp 殘留無害（檔名含 pid+時間戳，下次不會撞名）；不掩蓋主錯誤
    });
  }
}

/** 更新既有檔案（.tmp + rename 原子覆寫）；檔案不存在時失敗 */
export async function updateRecordFile(file: LocalRecordFile): Promise<void> {
  const target = recordFilePath(file.id);
  try {
    await fs.access(target);
  } catch {
    throw new LocaldataFileNotFoundError(file.id);
  }
  const tmp = tmpPath(target);
  await fs.writeFile(tmp, serialize(file), { mode: 0o600 });
  await fs.rename(tmp, target);
}

/** 讀取檔案並驗證格式；遺失 → LocaldataFileNotFoundError、損毀 → LocaldataCorruptedFileError */
export async function readRecordFile(recordId: string): Promise<LocalRecordFile> {
  const target = recordFilePath(recordId);
  let raw: string;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LocaldataFileNotFoundError(recordId);
    }
    throw err;
  }
  try {
    return localRecordFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new LocaldataCorruptedFileError(recordId, err);
  }
}

/** 軟刪除：檔案移入 localdata/.trash/（DB 的 deletedAt 由 service 層同步處理） */
export async function moveToTrash(recordId: string): Promise<void> {
  const target = recordFilePath(recordId);
  const trashDir = path.join(localdataDir(), ".trash");
  await ensureDir(trashDir);
  try {
    await fs.rename(target, path.join(trashDir, `${path.basename(recordId)}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LocaldataFileNotFoundError(recordId);
    }
    throw err;
  }
}
