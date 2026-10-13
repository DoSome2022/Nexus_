import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRecordFile,
  LocaldataCorruptedFileError,
  LocaldataFileNotFoundError,
  LocaldataInvalidIdError,
  moveToTrash,
  readRecordFile,
  recordFilePath,
  updateRecordFile,
  type LocalRecordFile,
} from "@/server/repositories/localdata-repository";

/**
 * localdata 儲存層單元測試（TASK-004）
 * 覆蓋：路徑安全、寫/讀 roundtrip、防覆寫、原子更新、軟刪除 .trash、損毀/遺失錯誤
 * 使用單一暫存目錄（env.ts 的 getEnv 有快取，不能逐 test 換目錄）
 */
const VALID_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public",
  AUTH_SECRET: "a".repeat(32),
  APP_URL: "http://localhost:3000",
};

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "localdata-test-"));
  for (const [k, v] of Object.entries(VALID_ENV)) {
    vi.stubEnv(k, v);
  }
  vi.stubEnv("LOCALDATA_DIR", dir);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

function makeFile(id: string, overrides: Partial<LocalRecordFile> = {}): LocalRecordFile {
  return {
    version: 1,
    id,
    authorId: "u_author",
    schema: { fields: ["note"] },
    data: { note: "機密內容" },
    changes: [],
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("路徑安全", () => {
  it("拒絕路徑穿越的 record id", () => {
    expect(() => recordFilePath("../etc/passwd")).toThrow(LocaldataInvalidIdError);
    expect(() => recordFilePath("a/b")).toThrow(LocaldataInvalidIdError);
    expect(() => recordFilePath("..")).toThrow(LocaldataInvalidIdError);
  });

  it("寫入時拒絕非法 id", async () => {
    await expect(createRecordFile(makeFile("../x"))).rejects.toThrow(LocaldataInvalidIdError);
  });
});

describe("建立 / 讀取", () => {
  it("建立 → 讀取 roundtrip", async () => {
    const f = makeFile("cktest0001");
    await createRecordFile(f);
    expect(await readRecordFile("cktest0001")).toEqual(f);
  });

  it("建立時目標已存在 → 拋錯（不覆寫）", async () => {
    await createRecordFile(makeFile("cktest0002"));
    await expect(createRecordFile(makeFile("cktest0002"))).rejects.toThrow(/EEXIST/);
    // 原內容未被覆寫
    expect((await readRecordFile("cktest0002")).data).toEqual({ note: "機密內容" });
  });

  it("寫入後不殘留 .tmp", async () => {
    await createRecordFile(makeFile("cktest0003"));
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("檔案權限為 0600", async () => {
    await createRecordFile(makeFile("cktest0004"));
    const st = await fs.stat(recordFilePath("cktest0004"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("讀取不存在的檔案 → LocaldataFileNotFoundError", async () => {
    await expect(readRecordFile("cktest0005")).rejects.toThrow(LocaldataFileNotFoundError);
  });

  it("讀取損毀檔案 → LocaldataCorruptedFileError", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "cktest0006.json"), "{ not json", "utf8");
    await expect(readRecordFile("cktest0006")).rejects.toThrow(LocaldataCorruptedFileError);
  });
});

describe("更新", () => {
  it("更新覆寫內容（原子）", async () => {
    await createRecordFile(makeFile("cktest0007"));
    const updated = makeFile("cktest0007", { data: { note: "新版內容" } });
    await updateRecordFile(updated);
    expect(await readRecordFile("cktest0007")).toEqual(updated);
  });

  it("更新不存在的檔案 → LocaldataFileNotFoundError", async () => {
    await expect(updateRecordFile(makeFile("cktest0008"))).rejects.toThrow(
      LocaldataFileNotFoundError,
    );
  });
});

describe("軟刪除", () => {
  it("移入 .trash 且原檔消失", async () => {
    await createRecordFile(makeFile("cktest0009"));
    await moveToTrash("cktest0009");
    await expect(readRecordFile("cktest0009")).rejects.toThrow(LocaldataFileNotFoundError);
    const trashed = JSON.parse(
      await fs.readFile(path.join(dir, ".trash", "cktest0009.json"), "utf8"),
    );
    expect(trashed.id).toBe("cktest0009");
  });

  it("軟刪除不存在的檔案 → LocaldataFileNotFoundError", async () => {
    await expect(moveToTrash("cktest0010")).rejects.toThrow(LocaldataFileNotFoundError);
  });
});
