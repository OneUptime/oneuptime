import AiTokenCount, {
  AiTokenCacheWeights,
  AiTokenUsage,
  AiTokenUsageSum,
  AiTokenWeight,
  CACHE_READ_TOKEN_WEIGHT,
  CACHE_WRITE_TOKEN_WEIGHT,
  DEFAULT_CACHE_TOKEN_WEIGHTS,
  FRESH_TOKEN_WEIGHT,
} from "../../../Types/AI/AiTokenCount";
import {
  LlmCostCatalogUtil,
  LlmModelPrice,
  LlmModelPricingCatalog,
} from "../../../Types/Telemetry/LlmCostCatalog";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * Cache weights per model (the follow-up of #5073 that #5273 listed): a
 * cached token counts for what the call's model charges for it next to a
 * fresh token, as the cost catalog of AI / LLM observability lists the
 * model's prices. One fixed tenth and one and a quarter counted gpt-4o's
 * cached reads (half the price of a fresh token) at a fifth of their cost,
 * Claude Opus 5.5's (a twentieth) at twice theirs, and an OpenAI write from
 * GPT-5.6 (a quarter more) as a fresh token - the provider never reported
 * them, and now does.
 */

function ratio(weight: AiTokenWeight): number {
  return weight.numerator / weight.denominator;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

describe("a model's cache weights are its own prices", () => {
  test.each([
    // Anthropic: a read at a tenth, a 5-minute write at a quarter more.
    [
      "claude-sonnet-4-5",
      { numerator: 1, denominator: 10 },
      { numerator: 5, denominator: 4 },
    ],
    [
      "claude-haiku-4-5",
      { numerator: 1, denominator: 10 },
      { numerator: 5, denominator: 4 },
    ],
    // The newest Claude models read for less.
    [
      "claude-opus-5-5",
      { numerator: 1, denominator: 20 },
      { numerator: 5, denominator: 4 },
    ],
    [
      "claude-fable-5-1",
      { numerator: 1, denominator: 40 },
      { numerator: 5, denominator: 4 },
    ],
    // OpenAI from GPT-5.6 charges a write a quarter more.
    [
      "gpt-5.6-terra",
      { numerator: 1, denominator: 10 },
      { numerator: 5, denominator: 4 },
    ],
    [
      "gpt-6.1-sol",
      { numerator: 1, denominator: 20 },
      { numerator: 5, denominator: 4 },
    ],
    // OpenAI's earlier models: no write charge, a read at the model's share.
    [
      "gpt-5.1",
      { numerator: 1, denominator: 10 },
      { numerator: 1, denominator: 1 },
    ],
    [
      "gpt-4.1",
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 1 },
    ],
    [
      "gpt-4o",
      { numerator: 1, denominator: 2 },
      { numerator: 1, denominator: 1 },
    ],
    ["o3", { numerator: 1, denominator: 4 }, { numerator: 1, denominator: 1 }],
    // Amazon Nova writes to its cache for nothing.
    [
      "nova-pro",
      { numerator: 1, denominator: 4 },
      { numerator: 0, denominator: 1 },
    ],
  ])(
    "%s: a read counts %p of a token, a write %p",
    (model: string, read: AiTokenWeight, write: AiTokenWeight) => {
      const weights: AiTokenCacheWeights = AiTokenCount.getCacheWeights(model);

      expect(weights).toEqual({ read, write, isModelPriced: true });
    },
  );

  test.each([
    "anthropic/claude-sonnet-4-5",
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-sonnet-4-5@20250929",
    "CLAUDE-SONNET-4-5",
    "  claude-sonnet-4-5  ",
  ])("%s is the model it names", (model: string) => {
    expect(AiTokenCount.getCacheWeights(model)).toEqual(
      AiTokenCount.getCacheWeights("claude-sonnet-4-5"),
    );
  });

  test("a dated id is the model it dates, not an older one", () => {
    expect(AiTokenCount.getCacheWeights("gpt-4o-2024-08-06").read).toEqual({
      numerator: 1,
      denominator: 2,
    });
    // gpt-4o-mini is its own entry, never gpt-4o's.
    expect(AiTokenCount.getCacheWeights("gpt-4o-mini").read).toEqual({
      numerator: 1,
      denominator: 2,
    });
    expect(AiTokenCount.getCacheWeights("gpt-4.1-mini").read).toEqual({
      numerator: 1,
      denominator: 4,
    });
  });

  test("every model the catalog lists a cache price for counts at exactly its prices", () => {
    let priced: number = 0;

    for (const entry of LlmModelPricingCatalog) {
      if (entry.cacheReadPricePerMillionTokensInUSD === undefined) {
        continue;
      }

      // The model as the catalog itself finds it (the most specific entry).
      const found: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
        entry.modelPrefix,
      );

      expect(found?.modelPrefix).toBe(entry.modelPrefix);

      const weights: AiTokenCacheWeights = AiTokenCount.getCacheWeights(
        entry.modelPrefix,
      );
      const input: number = entry.inputPricePerMillionTokensInUSD;

      expect({
        model: entry.modelPrefix,
        priced: weights.isModelPriced,
      }).toEqual({ model: entry.modelPrefix, priced: true });
      expect(ratio(weights.read)).toBeCloseTo(
        entry.cacheReadPricePerMillionTokensInUSD / input,
        9,
      );
      expect(ratio(weights.write)).toBeCloseTo(
        (entry.cacheWritePricePerMillionTokensInUSD ?? input) / input,
        9,
      );

      priced++;
    }

    // The catalog prices the cache of dozens of models (Anthropic, OpenAI, Google, xAI, Amazon).
    expect(priced).toBeGreaterThan(40);
  });

  test("every weight is a whole-number fraction in lowest terms", () => {
    for (const entry of LlmModelPricingCatalog) {
      const weights: AiTokenCacheWeights = AiTokenCount.getCacheWeights(
        entry.modelPrefix,
      );

      for (const weight of [weights.read, weights.write]) {
        expect(Number.isInteger(weight.numerator)).toBe(true);
        expect(Number.isInteger(weight.denominator)).toBe(true);
        expect(weight.numerator).toBeGreaterThanOrEqual(0);
        expect(weight.denominator).toBeGreaterThan(0);
        expect(
          greatestCommonDivisor(weight.numerator, weight.denominator),
        ).toBe(weight.numerator === 0 ? weight.denominator : 1);
      }
    }
  });

  test("a read never counts more than a fresh token on any listed model", () => {
    for (const entry of LlmModelPricingCatalog) {
      expect(
        ratio(AiTokenCount.getCacheWeights(entry.modelPrefix).read),
      ).toBeLessThanOrEqual(1);
    }
  });
});

describe("a model the catalog lists no cache price for counts as every model did before", () => {
  test.each([
    ["no model", undefined],
    ["a null model", null],
    ["an empty name", ""],
    ["a blank name", "   "],
    // An Azure deployment is named by its operator.
    ["an Azure deployment name", "prod-fast"],
    ["a model OneUptime does not know", "my-fine-tune-v3"],
    ["a local model", "llama3.2:3b"],
    // Listed, but with no cache price.
    ["a listed model with no cache price", "deepseek-chat"],
    ["a retired Claude model with no cache price", "claude-3-5-sonnet"],
  ])("%s", (_name: string, model: string | null | undefined) => {
    expect(AiTokenCount.getCacheWeights(model)).toEqual(
      DEFAULT_CACHE_TOKEN_WEIGHTS,
    );
  });

  test("the default is a tenth for a read and one and a quarter for a write", () => {
    expect(DEFAULT_CACHE_TOKEN_WEIGHTS).toEqual({
      read: CACHE_READ_TOKEN_WEIGHT,
      write: CACHE_WRITE_TOKEN_WEIGHT,
      isModelPriced: false,
    });
    expect(FRESH_TOKEN_WEIGHT).toEqual({ numerator: 1, denominator: 1 });
  });

  test("a model that names no cache price counts exactly as before", () => {
    const random: SeededRandom = seededRandom(5_273);

    for (let draw: number = 0; draw < 1_000; draw++) {
      const read: number = random(80_000);
      const write: number = random(30_000);
      const usage: AiTokenUsage = {
        totalTokens: read + write + random(40_000),
        cachedInputTokens: read,
        cacheCreationTokens: write,
      };

      expect(AiTokenCount.count({ ...usage, modelName: "prod-fast" })).toBe(
        AiTokenCount.count(usage),
      );
    }
  });
});

describe("a call counts at its model's weights", () => {
  test("a gpt-4o call: half of every cached token, every fresh one", () => {
    // prompt_tokens 50 (40 of them cached) + completion_tokens 5.
    expect(
      AiTokenCount.count({
        totalTokens: 55,
        cachedInputTokens: 40,
        modelName: "gpt-4o",
      }),
    ).toBe(15 + 20);
    // At the old fixed tenth it counted 19: a fifth of what it cost.
    expect(AiTokenCount.count({ totalTokens: 55, cachedInputTokens: 40 })).toBe(
      15 + 4,
    );
  });

  test("a Claude Opus 5.5 call reads its cache for a twentieth", () => {
    expect(
      AiTokenCount.count({
        totalTokens: 28_496,
        cachedInputTokens: 20_654,
        modelName: "claude-opus-5-5",
      }),
    ).toBe(7_842 + 1_033);
  });

  test("a GPT-5.6 call that writes to the cache counts the write a quarter more", () => {
    expect(
      AiTokenCount.count({
        totalTokens: 24_117,
        cacheCreationTokens: 20_654,
        modelName: "gpt-5.6-terra",
      }),
    ).toBe(3_463 + 25_818);
  });

  test("an earlier OpenAI model that reported a write counts it as a fresh token", () => {
    expect(
      AiTokenCount.count({
        totalTokens: 1_000,
        cacheCreationTokens: 600,
        modelName: "gpt-5.1",
      }),
    ).toBe(1_000);
  });

  test("a write a model is not charged for counts nothing", () => {
    expect(
      AiTokenCount.count({
        totalTokens: 1_000,
        cacheCreationTokens: 600,
        modelName: "nova-pro",
      }),
    ).toBe(400);
  });

  test("the breakdown names the weights it counted with", () => {
    expect(
      AiTokenCount.getBreakdown({
        totalTokens: 55,
        cachedInputTokens: 40,
        modelName: "gpt-4o",
      }),
    ).toEqual({
      countedTokens: 35,
      totalTokens: 55,
      freshTokens: 15,
      cacheReadTokens: 40,
      countedCacheReadTokens: 20,
      cacheWriteTokens: 0,
      countedCacheWriteTokens: 0,
      cacheWeights: {
        read: { numerator: 1, denominator: 2 },
        write: { numerator: 1, denominator: 1 },
        isModelPriced: true,
      },
    });
  });

  test("whatever the model, the count lies between the fresh tokens and every token plus a quarter of the written ones", () => {
    const random: SeededRandom = seededRandom(2_026);
    const models: Array<string> = LlmModelPricingCatalog.map(
      (entry: LlmModelPrice): string => {
        return entry.modelPrefix;
      },
    );

    for (let draw: number = 0; draw < 3_000; draw++) {
      const read: number = random(100_000);
      const write: number = random(100_000);
      const fresh: number = random(100_000);
      const total: number = read + write + fresh;

      const counted: number = AiTokenCount.count({
        totalTokens: total,
        cachedInputTokens: read,
        cacheCreationTokens: write,
        modelName: models[random(models.length)]!,
      });

      expect(counted).toBeGreaterThanOrEqual(fresh);
      expect(counted).toBeLessThanOrEqual(total + Math.ceil(write / 4) + 1);
    }
  });
});

describe("a day of calls is counted model by model", () => {
  const DAY: Array<AiTokenUsage> = [
    {
      totalTokens: 28_496,
      cachedInputTokens: 20_654,
      cacheCreationTokens: 0,
      modelName: "claude-sonnet-4-5",
    },
    {
      totalTokens: 55,
      cachedInputTokens: 40,
      cacheCreationTokens: 0,
      modelName: "gpt-4o",
    },
    {
      totalTokens: 32_712,
      cachedInputTokens: 24_117,
      cacheCreationTokens: 4_216,
      modelName: "claude-sonnet-4-5",
    },
    // A row with no model: an older AI Logs row.
    { totalTokens: 1_200 },
    {
      totalTokens: 45,
      cachedInputTokens: 30,
      cacheCreationTokens: 0,
      modelName: "gpt-4o",
    },
  ];

  test("one sum for each model, in the order each first appears", () => {
    expect(AiTokenCount.sumByModel(DAY)).toEqual([
      {
        totalTokens: 28_496 + 32_712,
        cachedInputTokens: 20_654 + 24_117,
        cacheCreationTokens: 4_216,
        modelName: "claude-sonnet-4-5",
      },
      {
        totalTokens: 100,
        cachedInputTokens: 70,
        cacheCreationTokens: 0,
        modelName: "gpt-4o",
      },
      {
        totalTokens: 1_200,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        modelName: null,
      },
    ]);
  });

  test("a model's name is trimmed, and a blank one is no model", () => {
    const sums: Array<AiTokenUsageSum> = AiTokenCount.sumByModel([
      { totalTokens: 10, modelName: " gpt-4o " },
      { totalTokens: 20, modelName: "gpt-4o" },
      { totalTokens: 30, modelName: "  " },
      { totalTokens: 40, modelName: null },
    ]);

    expect(sums).toEqual([
      {
        totalTokens: 30,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        modelName: "gpt-4o",
      },
      {
        totalTokens: 70,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        modelName: null,
      },
    ]);
  });

  test("each model's day counts at its own weights", () => {
    // Claude: 12,221 fresh + 4,478 read (44,771 ÷ 10) + 5,270 written (4,216 × 1.25).
    const claude: number = 12_221 + 4_478 + 5_270;
    // gpt-4o: 30 fresh + 35 read (70 ÷ 2).
    const openai: number = 30 + 35;

    expect(AiTokenCount.countAll(DAY)).toBe(claude + openai + 1_200);
  });

  test("counts what the calls count one by one, give or take the rounding of each", () => {
    const random: SeededRandom = seededRandom(51_111);
    const models: Array<string | undefined> = [
      "claude-opus-5-5",
      "gpt-4o",
      "gpt-5.6-terra",
      "nova-pro",
      "prod-fast",
      undefined,
    ];

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
          modelName: models[random(models.length)],
        });
      }

      const oneByOne: number = calls.reduce(
        (sum: number, call: AiTokenUsage) => {
          return sum + AiTokenCount.count(call);
        },
        0,
      );
      const together: number = AiTokenCount.countAll(calls);

      expect(together).toBeLessThanOrEqual(oneByOne);
      expect(oneByOne - together).toBeLessThan(2 * callCount);
    }
  });
});
