import AiTokenCount, {
  AiTokenCountBreakdown,
  AiTokenUsage,
  CACHE_READ_TOKEN_WEIGHT,
  CACHE_WRITE_TOKEN_WEIGHT,
  DEFAULT_CACHE_TOKEN_WEIGHTS,
} from "../../../Types/AI/AiTokenCount";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * How OneUptime counts the tokens of its own AI calls (issue #5073): by what
 * they cost. A fresh token, and every token the model writes, counts as one;
 * a token the provider read from its prompt cache counts as a tenth (that is
 * what it costs at Anthropic and on OpenAI's current models); a token written
 * to the cache counts as one and a quarter (Anthropic's 5-minute cache
 * write). The project's daily token limits, the incident and alert ones, the
 * AI credits of the OneUptime-hosted provider, the AI Logs and every AI run's
 * tokens count this way.
 *
 * Before, every cached token counted as a fresh one: the customer's five-call
 * investigation counted 161,996 tokens for what cost as much as 92,808 fresh
 * ones - and with the conversation cached too, the gap only grows.
 */

// The five calls of the issue's investigation, as its AI Logs showed them.
interface IssueCall {
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
}

const ISSUE_CALLS: Array<IssueCall> = [
  // Call 1 wrote the system prompt and the tools to the cache.
  { totalTokens: 24_117, cachedInputTokens: 0, cacheCreationTokens: 20_654 },
  { totalTokens: 28_496, cachedInputTokens: 20_654, cacheCreationTokens: 0 },
  { totalTokens: 32_712, cachedInputTokens: 20_654, cacheCreationTokens: 0 },
  { totalTokens: 36_260, cachedInputTokens: 20_654, cacheCreationTokens: 0 },
  { totalTokens: 40_411, cachedInputTokens: 20_654, cacheCreationTokens: 0 },
];

describe("the weights", () => {
  test("are whole-number fractions, so a count is exact", () => {
    expect(CACHE_READ_TOKEN_WEIGHT).toEqual({ numerator: 1, denominator: 10 });
    expect(CACHE_WRITE_TOKEN_WEIGHT).toEqual({ numerator: 5, denominator: 4 });
  });

  test("a read is a tenth of a token, and a write one and a quarter", () => {
    expect(
      CACHE_READ_TOKEN_WEIGHT.numerator / CACHE_READ_TOKEN_WEIGHT.denominator,
    ).toBe(0.1);
    expect(
      CACHE_WRITE_TOKEN_WEIGHT.numerator / CACHE_WRITE_TOKEN_WEIGHT.denominator,
    ).toBe(1.25);
  });
});

describe("AiTokenCount.count", () => {
  test("a call that used no cache counts every token it used", () => {
    expect(AiTokenCount.count({ totalTokens: 1_200 })).toBe(1_200);
    expect(
      AiTokenCount.count({
        totalTokens: 1_200,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
      }),
    ).toBe(1_200);
  });

  test("the issue's calls count by what they cost", () => {
    expect(
      ISSUE_CALLS.map((call: IssueCall) => {
        return AiTokenCount.count(call);
      }),
    ).toEqual([
      // 3,463 fresh + 20,654 written × 1.25 (25,817.5, up to 25,818).
      29_281,
      // 7,842 fresh + 20,654 read ÷ 10 (2,065.4, up to 2,066).
      9_908, 14_124, 17_672, 21_823,
    ]);
  });

  test("the issue's investigation counts 92,808 tokens, not the 161,996 it used", () => {
    const raw: number = ISSUE_CALLS.reduce((sum: number, call: IssueCall) => {
      return sum + call.totalTokens;
    }, 0);
    const counted: number = ISSUE_CALLS.reduce(
      (sum: number, call: IssueCall) => {
        return sum + AiTokenCount.count(call);
      },
      0,
    );

    expect(raw).toBe(161_996);
    expect(counted).toBe(92_808);
  });

  test("an OpenAI-wire call: its cached tokens are part of its prompt tokens", () => {
    // prompt_tokens 50 (40 of them cached) + completion_tokens 5.
    expect(AiTokenCount.count({ totalTokens: 55, cachedInputTokens: 40 })).toBe(
      15 + 4,
    );
  });

  test.each([
    [1, 1],
    [9, 1],
    [10, 1],
    [11, 2],
    [20_654, 2_066],
    [1_000_000, 100_000],
  ])(
    "%i tokens read from the cache count as %i: a tenth, rounded up",
    (read: number, counted: number) => {
      expect(
        AiTokenCount.count({ totalTokens: read, cachedInputTokens: read }),
      ).toBe(counted);
    },
  );

  test.each([
    [1, 2],
    [3, 4],
    [4, 5],
    [8, 10],
    [20_654, 25_818],
    [1_000_000, 1_250_000],
  ])(
    "%i tokens written to the cache count as %i: one and a quarter, rounded up",
    (write: number, counted: number) => {
      expect(
        AiTokenCount.count({ totalTokens: write, cacheCreationTokens: write }),
      ).toBe(counted);
    },
  );

  test("a call that read and wrote counts each part by its weight", () => {
    // 3,271 fresh input + 1,571 output, 20,654 read and 4,216 written.
    expect(
      AiTokenCount.count({
        totalTokens: 3_271 + 1_571 + 20_654 + 4_216,
        cachedInputTokens: 20_654,
        cacheCreationTokens: 4_216,
      }),
    ).toBe(3_271 + 1_571 + 2_066 + 5_270);
  });

  test("a report that does not add up never counts fewer than zero fresh tokens", () => {
    // More cached tokens than tokens: the cache counts stand as reported.
    expect(AiTokenCount.count({ totalTokens: 10, cachedInputTokens: 50 })).toBe(
      5,
    );
    expect(AiTokenCount.count({ totalTokens: 0, cacheCreationTokens: 4 })).toBe(
      5,
    );
  });

  test.each([
    ["nothing", {}, 0],
    ["undefined", { totalTokens: undefined }, 0],
    ["null", { totalTokens: null }, 0],
    ["NaN", { totalTokens: Number.NaN }, 0],
    ["Infinity", { totalTokens: Number.POSITIVE_INFINITY }, 0],
    ["a negative count", { totalTokens: -40 }, 0],
    ["a fraction", { totalTokens: 12.9 }, 12],
    [
      "negative cache counts",
      { totalTokens: 100, cachedInputTokens: -5, cacheCreationTokens: -5 },
      100,
    ],
  ])(
    "reads %s as the whole tokens it holds",
    (_name: string, usage: AiTokenUsage, counted: number) => {
      expect(AiTokenCount.count(usage)).toBe(counted);
    },
  );
});

describe("AiTokenCount.getBreakdown", () => {
  test("says what the count is made of", () => {
    const breakdown: AiTokenCountBreakdown = AiTokenCount.getBreakdown({
      totalTokens: 28_496,
      cachedInputTokens: 20_654,
      cacheCreationTokens: 0,
    });

    expect(breakdown).toEqual({
      countedTokens: 9_908,
      totalTokens: 28_496,
      freshTokens: 7_842,
      cacheReadTokens: 20_654,
      countedCacheReadTokens: 2_066,
      cacheWriteTokens: 0,
      countedCacheWriteTokens: 0,
      // A call that names no model counts at the weights of an unpriced one.
      cacheWeights: DEFAULT_CACHE_TOKEN_WEIGHTS,
    });
  });

  test("its parts add up to the count, whatever the call", () => {
    const random: SeededRandom = seededRandom(507301);

    for (let draw: number = 0; draw < 2_000; draw++) {
      const breakdown: AiTokenCountBreakdown = AiTokenCount.getBreakdown({
        totalTokens: random(200_000),
        cachedInputTokens: random(150_000),
        cacheCreationTokens: random(50_000),
      });

      expect(
        breakdown.freshTokens +
          breakdown.countedCacheReadTokens +
          breakdown.countedCacheWriteTokens,
      ).toBe(breakdown.countedTokens);
    }
  });
});

describe("AiTokenCount.toTokenCount", () => {
  test.each([
    [17, 17],
    ["17", 17],
    [" 42 ", 42],
    ["", 0],
    ["  ", 0],
    ["not a number", 0],
    [null, 0],
    [undefined, 0],
    [{}, 0],
    [-3, 0],
    [7.8, 7],
    ["9007199254740991", 9_007_199_254_740_991],
  ])("reads %p as %p", (value: unknown, expected: number) => {
    expect(AiTokenCount.toTokenCount(value)).toBe(expected);
  });
});

describe("a day of calls, added up and then counted", () => {
  test("adds every part of every call", () => {
    expect(AiTokenCount.sumByModel(ISSUE_CALLS)).toEqual([
      {
        totalTokens: 161_996,
        cachedInputTokens: 4 * 20_654,
        cacheCreationTokens: 20_654,
        modelName: null,
      },
    ]);
    expect(AiTokenCount.sumByModel([])).toEqual([]);
    expect(AiTokenCount.countAll([])).toBe(0);
  });

  test("counts what the calls count one by one, give or take the rounding of each", () => {
    const random: SeededRandom = seededRandom(5073);

    for (let day: number = 0; day < 300; day++) {
      const calls: Array<AiTokenUsage> = [];
      const callCount: number = 1 + random(60);

      for (let index: number = 0; index < callCount; index++) {
        const read: number = random(60_000);
        const write: number = random(20_000);
        const fresh: number = random(20_000);

        calls.push({
          totalTokens: read + write + fresh,
          cachedInputTokens: read,
          cacheCreationTokens: write,
        });
      }

      const oneByOne: number = calls.reduce(
        (sum: number, call: AiTokenUsage) => {
          return sum + AiTokenCount.count(call);
        },
        0,
      );
      const together: number = AiTokenCount.countAll(calls);

      // Each call rounds its two weighted parts up: at most two tokens more.
      expect(together).toBeLessThanOrEqual(oneByOne);
      expect(oneByOne - together).toBeLessThan(2 * callCount);
    }
  });
});

describe("the count follows the cost", () => {
  test("never below the fresh tokens, never above every token plus a quarter of the written ones", () => {
    const random: SeededRandom = seededRandom(20_654);

    for (let draw: number = 0; draw < 5_000; draw++) {
      const read: number = random(100_000);
      const write: number = random(100_000);
      const fresh: number = random(100_000);
      const total: number = read + write + fresh;

      const counted: number = AiTokenCount.count({
        totalTokens: total,
        cachedInputTokens: read,
        cacheCreationTokens: write,
      });

      expect(counted).toBeGreaterThanOrEqual(fresh);
      expect(counted).toBeLessThanOrEqual(total + Math.ceil(write / 4) + 1);
    }
  });

  test("the more of the same call the cache serves, the less it counts", () => {
    const random: SeededRandom = seededRandom(5);

    for (let draw: number = 0; draw < 1_000; draw++) {
      const total: number = 1_000 + random(100_000);
      const less: number = random(total);
      const more: number = less + random(total - less + 1);

      expect(
        AiTokenCount.count({ totalTokens: total, cachedInputTokens: more }),
      ).toBeLessThanOrEqual(
        AiTokenCount.count({ totalTokens: total, cachedInputTokens: less }),
      );
    }
  });

  test("writing to the cache counts more than reading it, and never less than the tokens it holds", () => {
    for (const tokens of [1, 4, 10, 999, 20_654, 123_457]) {
      const written: number = AiTokenCount.count({
        totalTokens: tokens,
        cacheCreationTokens: tokens,
      });
      const read: number = AiTokenCount.count({
        totalTokens: tokens,
        cachedInputTokens: tokens,
      });

      expect(written).toBeGreaterThanOrEqual(tokens);
      expect(read).toBeLessThanOrEqual(tokens);
      expect(written).toBeGreaterThan(read);
    }
  });

  /*
   * An agent loop as OneUptime now runs it on Anthropic: each call reads
   * what the previous one sent from the cache and writes what is new. Its
   * count is a fraction of what it used, and a fraction of what the same
   * loop counted when only the system prompt and the tools were cached.
   */
  test("a ten-call loop with its conversation cached counts a fraction of the same loop without", () => {
    const fixedPrefix: number = 20_654;
    const growthPerCall: number = 4_000;
    const outputPerCall: number = 1_500;

    let withHistoryCached: number = 0;
    let withPrefixCached: number = 0;
    let used: number = 0;

    for (let call: number = 0; call < 10; call++) {
      const history: number = call * growthPerCall + 1_000;
      const total: number = fixedPrefix + history + outputPerCall;
      used += total;

      // Before: the prefix read from the cache, the history paid in full.
      withPrefixCached += AiTokenCount.count({
        totalTokens: total,
        cachedInputTokens: call === 0 ? 0 : fixedPrefix,
        cacheCreationTokens: call === 0 ? fixedPrefix : 0,
      });

      // Now: everything the previous call sent read back, the new part written.
      const previousPrompt: number =
        call === 0 ? 0 : fixedPrefix + (call - 1) * growthPerCall + 1_000;
      const prompt: number = fixedPrefix + history;

      withHistoryCached += AiTokenCount.count({
        totalTokens: total,
        cachedInputTokens: previousPrompt,
        cacheCreationTokens: prompt - previousPrompt,
      });
    }

    expect(withHistoryCached).toBeLessThan(withPrefixCached);
    expect(withHistoryCached).toBeLessThan(used / 3);
    expect(withPrefixCached).toBeLessThan(used);
  });
});
