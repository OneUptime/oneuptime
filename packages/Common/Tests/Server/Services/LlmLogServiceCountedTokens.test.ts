import LlmLogService from "../../../Server/Services/LlmLogService";
import { AUTONOMOUS_AI_FEATURES } from "../../../Server/Services/AIService";
import AiTokenCount from "../../../Types/AI/AiTokenCount";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5073: the daily AI token limits counted every token a call used,
 * the ones the provider read from its prompt cache at full weight - so an
 * agent loop, which sends its whole conversation again on every call, used
 * its limit several times faster than it spent. Both usage aggregates now
 * sum the cached parts of the day apart and count the sums the way the AI
 * Logs count each call (AiTokenCount): a cache read is a tenth of a token, a
 * cache write one and a quarter.
 *
 *  - getProjectUsageSince: the project's own daily limits (Project Settings
 *    → AI → AI Features), every call of the day.
 *  - getTotalTokensUsedSince: the incident and alert daily token limits.
 *
 * A row written before the cache columns existed holds 0 in both (NOT NULL
 * DEFAULT 0), so it counts every one of its tokens, as it always did. The
 * statements are pinned here without a database; LlmLogDailyUsageIndexPostgres
 * runs them against a migrated Postgres.
 */

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SINCE: Date = new Date("2026-10-20T00:00:00.000Z");

function mockQuery(rows: Array<Record<string, unknown>>): Array<CapturedQuery> {
  const captured: Array<CapturedQuery> = [];

  jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        captured.push({ sql, params });
        return rows;
      },
    },
  } as unknown as ReturnType<typeof LlmLogService.getRepository>);

  return captured;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the project's own daily limits count the day's tokens by what they cost", () => {
  test("the statement sums the cached parts of the day beside the tokens", async () => {
    const captured: Array<CapturedQuery> = mockQuery([
      {
        totalTokens: "0",
        cacheRead: "0",
        cacheWrite: "0",
        billedCostInUSDCents: "0",
      },
    ]);

    await LlmLogService.getProjectUsageSince({
      projectId: PROJECT_ID,
      since: SINCE,
    });

    const sql: string = captured[0]!.sql;

    expect(sql).toContain(
      'COALESCE(SUM("log"."totalTokens"), 0) AS "totalTokens"',
    );
    expect(sql).toContain(
      'COALESCE(SUM("log"."cachedInputTokens"), 0) AS "cacheRead"',
    );
    expect(sql).toContain(
      'COALESCE(SUM("log"."cacheCreationTokens"), 0) AS "cacheWrite"',
    );
    // Still one statement, bound to the project and the time alone.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.params).toEqual([PROJECT_ID.toString(), SINCE]);
  });

  test("a day of calls that read from the cache counts a fraction of what they used", async () => {
    // The issue's five calls: 161,996 tokens, 82,616 read from the cache, 20,654 written.
    mockQuery([
      {
        totalTokens: "161996",
        cacheRead: "82616",
        cacheWrite: "20654",
        billedCostInUSDCents: "17",
      },
    ]);

    const usage: { totalTokens: number; billedCostInUSDCents: number } =
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      });

    // 58,726 fresh + 8,262 (82,616 ÷ 10) + 25,818 (20,654 × 1.25).
    expect(usage).toEqual({
      totalTokens: 58_726 + 8_262 + 25_818,
      billedCostInUSDCents: 17,
    });
    expect(usage.totalTokens).toBe(
      AiTokenCount.count({
        totalTokens: 161_996,
        cachedInputTokens: 82_616,
        cacheCreationTokens: 20_654,
      }),
    );
  });

  test("a day without cache traffic - or of rows from before the cache columns - counts every token, as before", async () => {
    mockQuery([
      {
        totalTokens: "45210",
        cacheRead: "0",
        cacheWrite: "0",
        billedCostInUSDCents: "0",
      },
    ]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 45_210, billedCostInUSDCents: 0 });
  });

  test("an empty day is zero, never NULL, and numbers come as numbers or strings alike", async () => {
    mockQuery([
      {
        totalTokens: null,
        cacheRead: null,
        cacheWrite: null,
        billedCostInUSDCents: null,
      },
    ]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 0, billedCostInUSDCents: 0 });

    jest.restoreAllMocks();
    mockQuery([
      {
        totalTokens: 1_000,
        cacheRead: 500,
        cacheWrite: 0,
        billedCostInUSDCents: 2,
      },
    ]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 500 + 50, billedCostInUSDCents: 2 });
  });

  test("no row at all is zero", async () => {
    mockQuery([]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 0, billedCostInUSDCents: 0 });
  });
});

describe("the incident and alert daily token limits count the same way", () => {
  async function lane(
    rows: Array<Record<string, unknown>>,
  ): Promise<{ captured: Array<CapturedQuery>; total: number }> {
    const captured: Array<CapturedQuery> = mockQuery(rows);

    const total: number = await LlmLogService.getTotalTokensUsedSince({
      projectId: PROJECT_ID,
      since: SINCE,
      features: AUTONOMOUS_AI_FEATURES,
      incidentId: ObjectID.generate(),
    });

    return { captured, total };
  }

  test("the statement sums the cached parts of the lane's day beside the tokens", async () => {
    const { captured } = await lane([{ total: "0" }]);
    const sql: string = captured[0]!.sql;

    expect(sql).toContain('COALESCE(SUM("log"."totalTokens"), 0) AS "total"');
    expect(sql).toContain(
      'COALESCE(SUM("log"."cachedInputTokens"), 0) AS "cacheRead"',
    );
    expect(sql).toContain(
      'COALESCE(SUM("log"."cacheCreationTokens"), 0) AS "cacheWrite"',
    );
  });

  test("an investigation that reads its conversation from the cache uses its lane's limit by what it cost", async () => {
    const { total } = await lane([
      { total: "161996", cacheRead: "82616", cacheWrite: "20654" },
    ]);

    expect(total).toBe(58_726 + 8_262 + 25_818);
  });

  test("a lane with no cache traffic counts every token, as before", async () => {
    const { total } = await lane([{ total: "99999" }]);

    expect(total).toBe(99_999);
  });

  test.each([
    [[{ total: null, cacheRead: null, cacheWrite: null }], 0],
    [[], 0],
    [[{ total: 30, cacheRead: 30, cacheWrite: 0 }], 3],
    [[{ total: "8", cacheRead: "0", cacheWrite: "8" }], 10],
  ])(
    "reads %p as %p tokens",
    async (rows: Array<Record<string, unknown>>, expected: number) => {
      const { total } = await lane(rows);

      expect(total).toBe(expected);
    },
  );
});
