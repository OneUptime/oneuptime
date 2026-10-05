import LlmLogService from "../../../Server/Services/LlmLogService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * LlmLogService.getProjectUsageSince: what a project's AI used since a time,
 * for its own daily AI limits (Project Settings → AI Features → More
 * settings). One aggregate over the project's AI Logs:
 *
 *   - tokens of EVERY call - every feature, every provider, Ask AI included
 *     (the incident and alert budgets count autonomous features only);
 *   - spend: the cost of the calls that were billed to the project's AI
 *     credits, never the cost a row merely records;
 *   - only this project, only since the given time, never a deleted row.
 *
 * The same statement was run against a migrated PostgreSQL 15 with rows of
 * every kind (billed and not, deleted, yesterday, another project): it
 * returned exactly the sums these tests expect, and zeros - never NULL -
 * for a project with no rows. Here it is pinned without a database.
 */

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SINCE: Date = new Date("2026-10-05T00:00:00.000Z");

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

// Postgres's rule: a statement needs exactly the parameters it references.
function referencedPlaceholders(sql: string): Array<number> {
  return Array.from(sql.matchAll(/\$(\d+)/g)).map(
    (match: RegExpMatchArray): number => {
      return Number(match[1]);
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LlmLogService.getProjectUsageSince", () => {
  test("binds exactly the project and the time it references", async () => {
    const captured: Array<CapturedQuery> = mockQuery([
      { totalTokens: "0", billedCostInUSDCents: "0" },
    ]);

    await LlmLogService.getProjectUsageSince({
      projectId: PROJECT_ID,
      since: SINCE,
    });

    expect(captured).toHaveLength(1);
    const query: CapturedQuery = captured[0]!;
    expect(query.params).toEqual([PROJECT_ID.toString(), SINCE]);
    expect(
      Array.from(new Set(referencedPlaceholders(query.sql))).sort(),
    ).toEqual([1, 2]);
  });

  test("sums this project's rows since the time, never a deleted one", async () => {
    const captured: Array<CapturedQuery> = mockQuery([
      { totalTokens: "0", billedCostInUSDCents: "0" },
    ]);

    await LlmLogService.getProjectUsageSince({
      projectId: PROJECT_ID,
      since: SINCE,
    });

    const sql: string = captured[0]!.sql;
    expect(sql).toContain('FROM "LlmLog" AS "log"');
    expect(sql).toContain('"log"."projectId" = $1');
    expect(sql).toContain('"log"."createdAt" >= $2');
    expect(sql).toContain('"log"."deletedAt" IS NULL');
  });

  /*
   * The project's ceiling covers everything its AI does, so no feature,
   * subject or provider narrows the sum - unlike the incident and alert
   * budgets, which count only their own autonomous lanes.
   */
  test("counts every call, whatever the feature, subject or provider", async () => {
    const captured: Array<CapturedQuery> = mockQuery([
      { totalTokens: "0", billedCostInUSDCents: "0" },
    ]);

    await LlmLogService.getProjectUsageSince({
      projectId: PROJECT_ID,
      since: SINCE,
    });

    const sql: string = captured[0]!.sql;
    expect(sql).not.toContain('"feature"');
    expect(sql).not.toContain('"incidentId"');
    expect(sql).not.toContain('"alertId"');
    expect(sql).not.toContain('"llmProviderId"');
    expect(sql).not.toContain('"isGlobalProvider"');
    expect(sql).toContain('SUM("log"."totalTokens")');
  });

  test("spend is the cost of billed calls only", async () => {
    const captured: Array<CapturedQuery> = mockQuery([
      { totalTokens: "0", billedCostInUSDCents: "0" },
    ]);

    await LlmLogService.getProjectUsageSince({
      projectId: PROJECT_ID,
      since: SINCE,
    });

    expect(captured[0]!.sql).toContain(
      'SUM(CASE WHEN "log"."wasBilled" = true THEN "log"."costInUSDCents" ELSE 0 END)',
    );
  });

  test("never hands back NULL: an empty day is zero", async () => {
    const captured: Array<CapturedQuery> = mockQuery([
      { totalTokens: null, billedCostInUSDCents: null },
    ]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 0, billedCostInUSDCents: 0 });
    expect(captured[0]!.sql).toContain('COALESCE(SUM("log"."totalTokens"), 0)');
  });

  // Postgres hands SUM of an integer column back as a bigint string.
  test("reads the bigint strings Postgres answers with as numbers", async () => {
    mockQuery([{ totalTokens: "5200", billedCostInUSDCents: "2" }]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 5200, billedCostInUSDCents: 2 });
  });

  test("reads no rows as zero", async () => {
    mockQuery([]);

    expect(
      await LlmLogService.getProjectUsageSince({
        projectId: PROJECT_ID,
        since: SINCE,
      }),
    ).toEqual({ totalTokens: 0, billedCostInUSDCents: 0 });
  });
});
