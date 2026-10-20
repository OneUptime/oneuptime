import { describe, expect, test } from "@jest/globals";
import LlmCostAllocation, {
  LlmCostLine,
  tokenTypeOfCostLine,
} from "../../../../Server/Utils/LlmObservability/LlmCostAllocation";
import { LlmUsageRecord } from "../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmProviderTokenType } from "../../../../Types/LlmObservability/LlmProviderUsageMetrics";

/*
 * Who spent the money when the bill says only what it was spent on: each
 * cost line is shared among the same day's usage of the same model in the
 * same project, by the tokens the line charges for, and the shares add up
 * to the line exactly. A line no usage matches is kept whole.
 */

const DAY: Date = new Date("2026-10-18T00:00:00Z");
const NEXT_DAY: Date = new Date("2026-10-19T00:00:00Z");

function usage(overrides: Partial<LlmUsageRecord>): LlmUsageRecord {
  return {
    day: DAY,
    model: "gpt-4o",
    person: "",
    project: "proj_web",
    apiKey: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: null,
    costUsd: null,
    ...overrides,
  };
}

function line(overrides: Partial<LlmCostLine>): LlmCostLine {
  return {
    day: DAY,
    project: "proj_web",
    model: "gpt-4o",
    tokenType: LlmProviderTokenType.Output,
    costUsd: 1,
    description: "",
    ...overrides,
  };
}

function totalCost(records: Array<LlmUsageRecord>): number {
  return records.reduce((sum: number, record: LlmUsageRecord) => {
    return sum + (record.costUsd || 0);
  }, 0);
}

describe("tokenTypeOfCostLine", () => {
  test.each([
    ["gpt-4o-2024-08-06, output", LlmProviderTokenType.Output],
    ["Claude Opus 5.5 Usage - Output Tokens", LlmProviderTokenType.Output],
    ["gpt-4o, cached input", LlmProviderTokenType.CacheRead],
    ["cache_read", LlmProviderTokenType.CacheRead],
    ["Cache Read Input Tokens", LlmProviderTokenType.CacheRead],
    ["cache_creation", LlmProviderTokenType.CacheWrite],
    ["Cache write (1h)", LlmProviderTokenType.CacheWrite],
    ["gpt-4o, input", LlmProviderTokenType.Input],
    ["uncached_input_tokens", LlmProviderTokenType.Input],
    [
      "Claude Opus 5.5 Usage - Input Tokens (non-cached)",
      LlmProviderTokenType.Input,
    ],
  ])("%s charges %s tokens", (text: string, type: LlmProviderTokenType) => {
    expect(tokenTypeOfCostLine(text)).toBe(type);
  });

  test.each([["web search"], [""], [null], [undefined]])(
    "%s charges no tokens",
    (text: string | null | undefined) => {
      expect(tokenTypeOfCostLine(text)).toBeNull();
    },
  );
});

describe("LlmCostAllocation.allocate", () => {
  test("an output line is shared by output tokens", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        usage({
          person: "ana@example.com",
          outputTokens: 300,
          inputTokens: 10,
        }),
        usage({
          person: "bob@example.com",
          outputTokens: 100,
          inputTokens: 990,
        }),
      ],
      costLines: [line({ costUsd: 4 })],
    });

    expect(
      records.map((record: LlmUsageRecord) => {
        return record.costUsd;
      }),
    ).toEqual([3, 1]);
  });

  test("an input line is shared by the input that was not cached", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        // 1,000 input, 900 of them read from the cache: 100 uncached.
        usage({ person: "ana", inputTokens: 1000, cacheReadTokens: 900 }),
        usage({ person: "bob", inputTokens: 300 }),
      ],
      costLines: [line({ tokenType: LlmProviderTokenType.Input, costUsd: 4 })],
    });

    expect(records[0]!.costUsd).toBeCloseTo(1, 10);
    expect(records[1]!.costUsd).toBeCloseTo(3, 10);
  });

  test("cache lines are shared by cache reads and cache writes", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        usage({ person: "ana", inputTokens: 500, cacheReadTokens: 400 }),
        usage({ person: "bob", inputTokens: 500, cacheWriteTokens: 100 }),
      ],
      costLines: [
        line({ tokenType: LlmProviderTokenType.CacheRead, costUsd: 0.2 }),
        line({ tokenType: LlmProviderTokenType.CacheWrite, costUsd: 0.5 }),
      ],
    });

    expect(records[0]!.costUsd).toBeCloseTo(0.2, 10);
    expect(records[1]!.costUsd).toBeCloseTo(0.5, 10);
  });

  test("a line for tokens nobody reported is shared by all tokens", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        usage({ person: "ana", inputTokens: 75, outputTokens: 25 }),
        usage({ person: "bob", inputTokens: 300 }),
      ],
      costLines: [
        line({ tokenType: LlmProviderTokenType.CacheRead, costUsd: 0.8 }),
      ],
    });

    expect(records[0]!.costUsd).toBeCloseTo(0.2, 10);
    expect(records[1]!.costUsd).toBeCloseTo(0.6, 10);
  });

  test("shares add up to the line exactly, however it divides", () => {
    const people: Array<LlmUsageRecord> = [1, 2, 3, 4, 5, 6, 7].map(
      (index: number) => {
        return usage({ person: `p${index}`, outputTokens: 1 + index * 7 });
      },
    );

    for (const costUsd of [0.1, 1 / 3, 1234.5678, 0.000007]) {
      const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
        usage: people,
        costLines: [line({ costUsd })],
      });

      // The last share takes what the others left: nothing lost to rounding.
      expect(totalCost(records)).toBeCloseTo(costUsd, 12);
      expect(
        records.every((record: LlmUsageRecord) => {
          return (record.costUsd || 0) > 0;
        }),
      ).toBe(true);
    }
  });

  test("a line is shared only within its day, model and project", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        usage({ person: "same", outputTokens: 10 }),
        usage({ person: "other-day", day: NEXT_DAY, outputTokens: 10 }),
        usage({
          person: "other-model",
          model: "gpt-4o-mini",
          outputTokens: 10,
        }),
        usage({
          person: "other-project",
          project: "proj_ops",
          outputTokens: 10,
        }),
      ],
      costLines: [line({ costUsd: 2 })],
    });

    expect(
      records.map((record: LlmUsageRecord) => {
        return [record.person, record.costUsd];
      }),
    ).toEqual([
      ["same", 2],
      ["other-day", null],
      ["other-model", null],
      ["other-project", null],
    ]);
  });

  test("a line that names no project is shared across the day's projects", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        usage({ project: "proj_web", outputTokens: 10 }),
        usage({ project: "proj_ops", outputTokens: 30 }),
      ],
      costLines: [line({ project: "", costUsd: 4 })],
    });

    expect(records[0]!.costUsd).toBeCloseTo(1, 10);
    expect(records[1]!.costUsd).toBeCloseTo(3, 10);
  });

  test("models match whatever their case or spacing", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [usage({ model: "GPT-4o", outputTokens: 10 })],
      costLines: [line({ model: " gpt-4o ", costUsd: 1 })],
    });

    expect(records).toHaveLength(1);
    expect(records[0]!.costUsd).toBe(1);
  });

  test("a line no usage matches is kept whole, with no person or key", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [usage({ person: "ana", outputTokens: 10 })],
      costLines: [
        line({
          model: "",
          tokenType: null,
          description: "Web search",
          costUsd: 0.5,
        }),
        line({ model: "o3-deep-research", costUsd: 0.25 }),
      ],
    });

    expect(records).toHaveLength(3);
    expect(records[1]).toMatchObject({
      model: "Web search",
      person: "",
      apiKey: "",
      project: "proj_web",
      inputTokens: 0,
      outputTokens: 0,
      requests: null,
      costUsd: 0.5,
    });
    expect(records[2]).toMatchObject({
      model: "o3-deep-research",
      costUsd: 0.25,
    });
    expect(totalCost(records)).toBe(0.75);
  });

  test("zero and broken lines change nothing, and the records passed in are left as they were", () => {
    const original: LlmUsageRecord = usage({ outputTokens: 10, costUsd: 9 });

    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [original],
      costLines: [line({ costUsd: 0 }), line({ costUsd: Number.NaN })],
    });

    expect(records[0]!.costUsd).toBeNull();
    expect(original.costUsd).toBe(9);
  });

  test("negative lines (credits) are shared like any other", () => {
    const records: Array<LlmUsageRecord> = LlmCostAllocation.allocate({
      usage: [
        usage({ outputTokens: 10 }),
        usage({ person: "b", outputTokens: 30 }),
      ],
      costLines: [line({ costUsd: 4 }), line({ costUsd: -2 })],
    });

    expect(totalCost(records)).toBeCloseTo(2, 10);
    expect(records[0]!.costUsd).toBeCloseTo(0.5, 10);
  });
});
