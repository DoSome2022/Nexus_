import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * db-overview-service 單元測試（TASK-011）
 * - 僅 ADMIN；rate limit 擋下不觸 DB、不寫 log
 * - 全部表並行載入、各自 take=limit、count/findMany 各一次
 * - record 表只 select title/searchContent（需求調整）
 * - 成功載入寫一筆 OperationLog(VIEW, DB_OVERVIEW)
 */
const mocks = vi.hoisted(() => {
  const model = () => ({ count: vi.fn(), findMany: vi.fn() });
  return {
    user: model(),
    record: model(),
    recordTemplate: model(),
    recordRelation: model(),
    operationLog: model(),
    changeLog: model(),
    passwordResetToken: model(),
    deletionRequest: model(),
    category: model(),
    recordCategory: model(),
    logOperation: vi.fn(),
    checkRateLimit: vi.fn(),
  };
});

vi.mock("@/server/db", () => ({
  getDb: () => ({
    user: mocks.user,
    record: mocks.record,
    recordTemplate: mocks.recordTemplate,
    recordRelation: mocks.recordRelation,
    operationLog: mocks.operationLog,
    changeLog: mocks.changeLog,
    passwordResetToken: mocks.passwordResetToken,
    deletionRequest: mocks.deletionRequest,
    category: mocks.category,
    recordCategory: mocks.recordCategory,
  }),
}));
vi.mock("@/server/audit/operation-log", () => ({
  logOperation: mocks.logOperation,
}));
vi.mock("@/server/security/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { getDbOverview } from "@/server/services/db-overview-service";
import { DB_OVERVIEW_TABLES } from "@/lib/db-overview";

const admin = { id: "admin1", role: "ADMIN" as const };
const user = { id: "user1", role: "USER" as const };

const ALL_MODELS = [
  mocks.user,
  mocks.record,
  mocks.recordTemplate,
  mocks.recordRelation,
  mocks.operationLog,
  mocks.changeLog,
  mocks.passwordResetToken,
  mocks.deletionRequest,
  mocks.category,
  mocks.recordCategory,
];

function recordRow(overrides: Record<string, unknown> = {}) {
  return { title: "標題", searchContent: "內容", ...overrides };
}

function defaultLimits() {
  return Object.fromEntries(DB_OVERVIEW_TABLES.map((t) => [t, 20])) as Parameters<
    typeof getDbOverview
  >[0]["limits"];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of ALL_MODELS) {
    model.count.mockResolvedValue(0);
    model.findMany.mockResolvedValue([]);
  }
  mocks.checkRateLimit.mockReturnValue(true);
  mocks.logOperation.mockResolvedValue(undefined);
});

describe("權限與 rate limit", () => {
  it("非 ADMIN → FORBIDDEN，不觸 DB/rate limit/log", async () => {
    await expect(getDbOverview({ actor: user, limits: defaultLimits() })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.logOperation).not.toHaveBeenCalled();
    for (const model of ALL_MODELS) {
      expect(model.count).not.toHaveBeenCalled();
      expect(model.findMany).not.toHaveBeenCalled();
    }
  });

  it("rate limit 擋下 → TOO_MANY_REQUESTS，不查 DB 不寫 log", async () => {
    mocks.checkRateLimit.mockReturnValue(false);
    await expect(getDbOverview({ actor: admin, limits: defaultLimits() })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("db-overview:admin1", {
      limit: 10,
      windowMs: 60_000,
    });
    expect(mocks.logOperation).not.toHaveBeenCalled();
    for (const model of ALL_MODELS) {
      expect(model.count).not.toHaveBeenCalled();
      expect(model.findMany).not.toHaveBeenCalled();
    }
  });
});

describe("成功載入", () => {
  it("回傳全部表（順序固定）、label/columns/total/limit/rows；count 與 findMany 各一次", async () => {
    mocks.user.count.mockResolvedValue(3);
    mocks.user.findMany.mockResolvedValue([
      {
        id: "u1",
        email: "admin@nexus.local",
        passwordHash: "$2a$12$hash",
        name: null,
        role: "ADMIN",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);
    const result = await getDbOverview({ actor: admin, limits: defaultLimits() });
    expect(result.tables.map((t) => t.key)).toEqual([...DB_OVERVIEW_TABLES]);
    expect(result.tables[0]).toMatchObject({
      key: "user",
      label: "使用者",
      total: 3,
      limit: 20,
    });
    expect(result.tables[0]?.rows).toHaveLength(1);
    // passwordHash 完全顯示（需求指定不遮罩）
    const passwordCell = result.tables[0]?.rows[0]?.[
      result.tables[0].columns.indexOf("passwordHash")
    ];
    expect(passwordCell).toEqual({ kind: "text", text: "$2a$12$hash" });
    for (const model of ALL_MODELS) {
      expect(model.count).toHaveBeenCalledTimes(1);
      expect(model.findMany).toHaveBeenCalledTimes(1);
    }
    expect(result.loadedAt).toEqual(expect.any(String));
    expect(result.durationMs).toEqual(expect.any(Number));
  });

  it("每表 findMany 的 take 等於各自 limit（互不影響）", async () => {
    const limits = defaultLimits();
    limits.record = 500;
    limits.operationLog = 100;
    await getDbOverview({ actor: admin, limits });
    expect(mocks.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(mocks.operationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
    expect(mocks.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });

  it("findMany 不設 where（含軟刪除）；空表 → total 0、rows 空、仍回傳全部表", async () => {
    const result = await getDbOverview({ actor: admin, limits: defaultLimits() });
    expect(mocks.user.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
    expect(result.tables).toHaveLength(DB_OVERVIEW_TABLES.length);
    for (const table of result.tables) {
      expect(table.total).toBe(0);
      expect(table.rows).toEqual([]);
    }
  });

  it("成功載入寫一筆 OperationLog(VIEW, DB_OVERVIEW, all) 帶 ip/userAgent/durationMs", async () => {
    await getDbOverview({
      actor: admin,
      limits: defaultLimits(),
      request: { ip: "1.2.3.4", userAgent: "curl/8" },
    });
    expect(mocks.logOperation).toHaveBeenCalledTimes(1);
    expect(mocks.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin1",
        action: "VIEW",
        targetType: "DB_OVERVIEW",
        targetId: "all",
        ip: "1.2.3.4",
        userAgent: "curl/8",
        durationMs: expect.any(Number),
      }),
    );
  });
});

describe("record 表（需求調整：只顯示 title 與 searchContent）", () => {
  it("record 表 select 只含 title/searchContent，cells 對應渲染", async () => {
    mocks.record.count.mockResolvedValue(2);
    mocks.record.findMany.mockResolvedValue([
      recordRow(),
      recordRow({ title: "保密標題", searchContent: null }),
    ]);
    const result = await getDbOverview({ actor: admin, limits: defaultLimits() });
    const recordTable = result.tables.find((t) => t.key === "record");
    expect(recordTable?.columns).toEqual(["title", "searchContent"]);
    expect(mocks.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { title: true, searchContent: true },
      }),
    );
    expect(recordTable?.rows[0]).toEqual([
      { kind: "text", text: "標題" },
      { kind: "text", text: "內容" },
    ]);
    expect(recordTable?.rows[1]).toEqual([
      { kind: "text", text: "保密標題" },
      { kind: "null", text: "—" },
    ]);
  });
});
