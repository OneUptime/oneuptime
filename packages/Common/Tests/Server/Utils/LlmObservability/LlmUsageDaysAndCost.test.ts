import { describe, expect, test } from "@jest/globals";
import LlmUsageCost from "../../../../Server/Utils/LlmObservability/LlmUsageCost";
import LlmUsageDays, {
  LLM_USAGE_REOPEN_DAYS,
} from "../../../../Server/Utils/LlmObservability/LlmUsageDays";
import { LlmUsageWindow } from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";

/*
 * The days a provider account read covers - the backfill, the days read
 * again while the provider may still change them, the catch-up after a
 * pause that never reaches past the backfill - and a day's cost at list
 * price for the providers that report tokens and no money.
 */

const NOW: Date = new Date("2026-10-19T15:30:00Z");

function iso(window: LlmUsageWindow): [string, string] {
  return [window.startDay.toISOString(), window.endDay.toISOString()];
}

describe("LlmUsageDays.nextWindow", () => {
  test("the first read goes back the backfill, today included, and ends after today", () => {
    expect(
      iso(LlmUsageDays.nextWindow({ now: NOW, state: {}, backfillDays: 30 })),
    ).toEqual(["2026-09-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
  });

  test("a later read starts again a few days before its last read", () => {
    expect(LLM_USAGE_REOPEN_DAYS).toBe(3);
    expect(
      iso(
        LlmUsageDays.nextWindow({
          now: NOW,
          state: { cursor: "2026-10-19T00:00:00.000Z" },
          backfillDays: 30,
        }),
      ),
    ).toEqual(["2026-10-17T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
  });

  test("a connection that was off catches up, but never past the backfill", () => {
    expect(
      iso(
        LlmUsageDays.nextWindow({
          now: NOW,
          state: { cursor: "2026-10-10T00:00:00.000Z" },
          backfillDays: 30,
        }),
      ),
    ).toEqual(["2026-10-08T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
    expect(
      iso(
        LlmUsageDays.nextWindow({
          now: NOW,
          state: { cursor: "2025-01-01T00:00:00.000Z" },
          backfillDays: 30,
        }),
      ),
    ).toEqual(["2026-09-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
  });

  test("a cursor that is not a time, or is in the future, reads like a first read", () => {
    for (const cursor of ["yesterday", "2027-01-01T00:00:00.000Z"]) {
      expect(
        iso(
          LlmUsageDays.nextWindow({
            now: NOW,
            state: { cursor },
            backfillDays: 7,
          }),
        ),
      ).toEqual(["2026-10-13T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
    }
  });

  test("a backfill of zero still reads today", () => {
    expect(
      iso(LlmUsageDays.nextWindow({ now: NOW, state: {}, backfillDays: 0 })),
    ).toEqual(["2026-10-19T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
  });
});

describe("LlmUsageDays helpers", () => {
  test("days are UTC days", () => {
    expect(
      LlmUsageDays.startOfUtcDay(
        new Date("2026-10-19T23:59:59.999-05:00"),
      ).toISOString(),
    ).toBe("2026-10-20T00:00:00.000Z");
    expect(LlmUsageDays.toIsoDate(NOW)).toBe("2026-10-19");
    expect(
      LlmUsageDays.listDays(
        new Date("2026-10-17T00:00:00Z"),
        new Date("2026-10-20T00:00:00Z"),
      ).map((day: Date) => {
        return day.toISOString();
      }),
    ).toEqual([
      "2026-10-17T00:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
      "2026-10-19T00:00:00.000Z",
    ]);
    expect(
      LlmUsageDays.daysBetween(
        new Date("2026-10-17T00:00:00Z"),
        new Date("2026-10-20T00:00:00Z"),
      ),
    ).toBe(3);
  });

  test("provider times are read back as day starts, and anything else as nothing", () => {
    expect(LlmUsageDays.fromUnixSeconds(1760832000)?.toISOString()).toBe(
      "2025-10-19T00:00:00.000Z",
    );
    expect(LlmUsageDays.fromUnixSeconds("1760835600")?.toISOString()).toBe(
      "2025-10-19T00:00:00.000Z",
    );
    expect(
      LlmUsageDays.fromIsoTime("2026-10-19T08:00:00+02:00")?.toISOString(),
    ).toBe("2026-10-19T00:00:00.000Z");

    for (const value of [0, -5, "soon", null, undefined, Number.NaN]) {
      expect(LlmUsageDays.fromUnixSeconds(value)).toBeNull();
    }

    for (const value of ["", "soon", 42, null]) {
      expect(LlmUsageDays.fromIsoTime(value)).toBeNull();
    }
  });
});

describe("LlmUsageCost.estimateDailyCostUsd", () => {
  test("a day of tokens at list price: uncached input, cache reads, cache writes and output", () => {
    // gpt-6-astra: $10 input, $1 cache read, $12.50 cache write, $50 output.
    expect(
      LlmUsageCost.estimateDailyCostUsd({
        model: "gpt-6-astra",
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 100_000,
      }),
    ).toBe(13.45);
  });

  test("a day's total is never charged the long-prompt price", () => {
    /*
     * 300,000 tokens is past gpt-6-astra's long-prompt threshold (272,001)
     * for ONE prompt; a day of many prompts is charged the ordinary price.
     */
    expect(
      LlmUsageCost.estimateDailyCostUsd({
        model: "gpt-6-astra",
        inputTokens: 300_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(3);
  });

  test("a project's own price wins, for every input token", () => {
    expect(
      LlmUsageCost.estimateDailyCostUsd({
        model: "gpt-4o",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 500_000,
        cacheWriteTokens: 0,
        projectPriceOverrides: [
          {
            modelPrefix: "gpt-4o",
            inputPricePerMillionTokensInUSD: 1,
            outputPricePerMillionTokensInUSD: 2,
          },
        ],
      }),
    ).toBe(3);
  });

  test("cache counts larger than the input are read as part of it, never as a negative", () => {
    // gpt-4o: $2.50 input, $1.25 cache read, $10 output.
    expect(
      LlmUsageCost.estimateDailyCostUsd({
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      }),
    ).toBe(1.25);
  });

  test("an unknown model, no model or no tokens is no estimate, never a guess", () => {
    const tokens: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    } = {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    expect(
      LlmUsageCost.estimateDailyCostUsd({
        model: "my-internal-model-x",
        ...tokens,
      }),
    ).toBeNull();
    expect(
      LlmUsageCost.estimateDailyCostUsd({ model: "", ...tokens }),
    ).toBeNull();
    expect(
      LlmUsageCost.estimateDailyCostUsd({
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: Number.NaN,
        cacheReadTokens: -5,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });
});
