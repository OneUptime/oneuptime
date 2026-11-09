import LlmLogService from "../../../Server/Services/LlmLogService";
import AiTokenCount from "../../../Types/AI/AiTokenCount";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * LlmLogService.getRunCompletionUsage: what one run of the code agent has
 * used, read by the server before every completion it serves (issue #6440):
 * its model calls (one AI Log row per call), the output tokens they wrote,
 * and all its tokens as OneUptime counts them - the count the project's
 * limit of tokens per run is held to, cached tokens weighted by each
 * model's own prices, as the daily limits count them. Pinned here without a
 * database.
 */

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

const RUN_ID: ObjectID = new ObjectID("5e1c2d3e-1111-4222-8333-944455556666");

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

describe("LlmLogService.getRunCompletionUsage", () => {
  test("reads only the run's own rows, never a deleted one, one sum per model", async () => {
    const captured: Array<CapturedQuery> = mockQuery([]);

    await LlmLogService.getRunCompletionUsage({ aiRunId: RUN_ID });

    expect(captured).toHaveLength(1);
    const query: CapturedQuery = captured[0]!;

    expect(query.params).toEqual([RUN_ID.toString()]);
    expect(query.sql).toContain('"log"."aiRunId" = $1');
    expect(query.sql).toContain('"log"."deletedAt" IS NULL');
    expect(query.sql).toContain('GROUP BY "log"."modelName"');
    expect(query.sql).not.toMatch(/\$2/);
  });

  test("a run with no calls has used nothing", async () => {
    mockQuery([]);

    await expect(
      LlmLogService.getRunCompletionUsage({ aiRunId: RUN_ID }),
    ).resolves.toEqual({ completionCalls: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("adds up every model's calls and output tokens, as SQL hands them back", async () => {
    mockQuery([
      {
        modelName: "gpt-4o",
        calls: "41",
        outputTokens: "60000",
        total: "900000",
        cacheRead: "0",
        cacheWrite: "0",
      },
      {
        modelName: null,
        calls: 9,
        outputTokens: 5000,
        total: 100000,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ]);

    await expect(
      LlmLogService.getRunCompletionUsage({ aiRunId: RUN_ID }),
    ).resolves.toEqual({
      completionCalls: 50,
      outputTokens: 65_000,
      // No cached tokens: every token counts as one.
      totalTokens: 1_000_000,
    });
  });

  test("counts tokens as OneUptime counts them: cached ones at their model's weights", async () => {
    const row: Record<string, unknown> = {
      modelName: "claude-sonnet-4-5",
      calls: "12",
      outputTokens: "8000",
      total: "400000",
      cacheRead: "300000",
      cacheWrite: "20000",
    };
    mockQuery([row]);

    const usage: {
      completionCalls: number;
      outputTokens: number;
      totalTokens: number;
    } = await LlmLogService.getRunCompletionUsage({ aiRunId: RUN_ID });

    expect(usage.totalTokens).toBe(
      AiTokenCount.count({
        totalTokens: 400_000,
        cachedInputTokens: 300_000,
        cacheCreationTokens: 20_000,
        modelName: "claude-sonnet-4-5",
      }),
    );
    // Cache reads are cheap: far fewer than the raw 400,000.
    expect(usage.totalTokens).toBeLessThan(400_000);
    expect(usage.completionCalls).toBe(12);
  });

  test("a sum that is not a number counts as nothing, never as NaN", async () => {
    mockQuery([
      {
        modelName: "gpt-4o",
        calls: null,
        outputTokens: "not a number",
        total: null,
        cacheRead: null,
        cacheWrite: null,
      },
    ]);

    await expect(
      LlmLogService.getRunCompletionUsage({ aiRunId: RUN_ID }),
    ).resolves.toEqual({ completionCalls: 0, outputTokens: 0, totalTokens: 0 });
  });
});
