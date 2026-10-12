import {
  LlmCallPrices,
  LlmCostCatalogUtil,
  LlmModelPrice,
  LlmModelPricingCatalog,
} from "../../../Types/Telemetry/LlmCostCatalog";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AI spend prices current models at their own rate.
 *
 * Two things were wrong (PR #4695's audit, approved as "AI cost - yes"):
 * the catalog knew no Claude 5 model, and a prefix like "claude-opus-4"
 * matched every id that BEGAN with it, so Claude Opus 4.5, 4.6, 4.7 and 4.8
 * were charged Opus 4's $15 / $75 instead of their own $5 / $25. The same
 * prefix rule priced gpt-5.5 as gpt-5 and grok-4.7 as grok-4.
 *
 * What this suite holds:
 *
 *  - every price of Anthropic's official table, as it was copied;
 *  - every shape a Claude id comes in (dated, Bedrock, cross-region, Google
 *    Cloud, OpenRouter, LiteLLM, Foundry) reaching its own model's price;
 *  - a later version never taking an older entry's price, for any provider,
 *    and a model nobody priced yet getting no price at all (the caller
 *    stores 0, as the docs promise: "never guessed");
 *  - prompt-cache reads and writes and long-prompt tiers in the arithmetic;
 *  - a project's own prices still winning, as plain prefixes.
 */

const ANTHROPIC_PRICING_PAGE: string =
  "https://platform.claude.com/docs/en/about-claude/pricing";

interface OfficialClaudePrice {
  // The model as the page names it.
  model: string;
  // The id Anthropic's API gives it, and the catalog's prefix.
  id: string;
  // The date of its snapshot, for models before the dateless 4.6 generation.
  snapshot?: string;
  input: number;
  // "5m cache writes".
  cacheWrite: number;
  // "Cache hits and refreshes".
  cacheRead: number;
  output: number;
}

/*
 * The "Model pricing" table of the page above, copied on 2026-10-12, row by
 * row. Claude Haiku 5.5's second row (prompts over 100,000 tokens) is held
 * by the long-prompt tests below. When Anthropic reprices, change the
 * catalog AND this table from the page - never one from the other.
 */
const ANTHROPIC_MODEL_PRICING: Array<OfficialClaudePrice> = [
  {
    model: "Claude Fable 5.1",
    id: "claude-fable-5-1",
    input: 10,
    cacheWrite: 12.5,
    cacheRead: 0.25,
    output: 50,
  },
  {
    model: "Claude Mythos 5.1",
    id: "claude-mythos-5-1",
    input: 10,
    cacheWrite: 12.5,
    cacheRead: 0.25,
    output: 50,
  },
  {
    model: "Claude Fable 5",
    id: "claude-fable-5",
    input: 10,
    cacheWrite: 12.5,
    cacheRead: 1,
    output: 50,
  },
  {
    model: "Claude Mythos 5",
    id: "claude-mythos-5",
    input: 10,
    cacheWrite: 12.5,
    cacheRead: 1,
    output: 50,
  },
  {
    model: "Claude Opus 5.5",
    id: "claude-opus-5-5",
    input: 4,
    cacheWrite: 5,
    cacheRead: 0.2,
    output: 20,
  },
  {
    model: "Claude Opus 5",
    id: "claude-opus-5",
    input: 5,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    output: 25,
  },
  {
    model: "Claude Opus 4.8",
    id: "claude-opus-4-8",
    input: 5,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    output: 25,
  },
  {
    model: "Claude Opus 4.7",
    id: "claude-opus-4-7",
    input: 5,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    output: 25,
  },
  {
    model: "Claude Opus 4.6",
    id: "claude-opus-4-6",
    input: 5,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    output: 25,
  },
  {
    model: "Claude Opus 4.5",
    id: "claude-opus-4-5",
    snapshot: "20251101",
    input: 5,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    output: 25,
  },
  {
    model: "Claude Opus 4.1",
    id: "claude-opus-4-1",
    snapshot: "20250805",
    input: 15,
    cacheWrite: 18.75,
    cacheRead: 1.5,
    output: 75,
  },
  {
    model: "Claude Opus 4",
    id: "claude-opus-4",
    snapshot: "20250514",
    input: 15,
    cacheWrite: 18.75,
    cacheRead: 1.5,
    output: 75,
  },
  {
    model: "Claude Sonnet 5.5",
    id: "claude-sonnet-5-5",
    input: 2,
    cacheWrite: 2.5,
    cacheRead: 0.1,
    output: 10,
  },
  {
    model: "Claude Sonnet 5",
    id: "claude-sonnet-5",
    input: 2,
    cacheWrite: 2.5,
    cacheRead: 0.2,
    output: 10,
  },
  {
    model: "Claude Sonnet 4.6",
    id: "claude-sonnet-4-6",
    input: 3,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15,
  },
  {
    model: "Claude Sonnet 4.5",
    id: "claude-sonnet-4-5",
    snapshot: "20250929",
    input: 3,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15,
  },
  {
    model: "Claude Sonnet 4",
    id: "claude-sonnet-4",
    snapshot: "20250514",
    input: 3,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15,
  },
  {
    model: "Claude Haiku 5.5 (for prompts up to 100,000 tokens)",
    id: "claude-haiku-5-5",
    input: 0.1,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    output: 0.5,
  },
  {
    model: "Claude Haiku 4.5",
    id: "claude-haiku-4-5",
    snapshot: "20251001",
    input: 1,
    cacheWrite: 1.25,
    cacheRead: 0.1,
    output: 5,
  },
];

// Claude Haiku 3.5 is retired except on Google Cloud, which dates it with "@".
const CLAUDE_HAIKU_3_5: OfficialClaudePrice = {
  model: "Claude Haiku 3.5",
  id: "claude-3-5-haiku",
  snapshot: "20241022",
  input: 0.8,
  cacheWrite: 1,
  cacheRead: 0.08,
  output: 4,
};

/*
 * OpenRouter writes the minor version with a dot: anthropic/claude-opus-4.5.
 * A whole major version is written as it is: anthropic/claude-opus-5.
 */
const MAJOR_AND_MINOR_VERSION: RegExp = /-(\d+)-(\d+)$/;

function openRouterId(id: string): string {
  return `anthropic/${id.replace(MAJOR_AND_MINOR_VERSION, "-$1.$2")}`;
}

/*
 * Every id a model reaches OneUptime under: the Claude API's, Microsoft
 * Foundry's and Claude Platform on AWS's (the same), Amazon Bedrock's with
 * each inference profile, Google Cloud's, OpenRouter's, LiteLLM's model
 * groups, and Claude Code's 1M-context suffix.
 */
function everyIdOf(model: OfficialClaudePrice): Array<string> {
  const ids: Array<string> = [model.id, model.id.toUpperCase()];

  if (model.snapshot) {
    const dated: string = `${model.id}-${model.snapshot}`;
    const bedrock: string = `anthropic.${dated}-v1:0`;

    ids.push(
      dated,
      bedrock,
      `us.${bedrock}`,
      `eu.${bedrock}`,
      `apac.${bedrock}`,
      `jp.${bedrock}`,
      `au.${bedrock}`,
      `global.${bedrock}`,
      `${model.id}@${model.snapshot}`,
      `bedrock/us.${bedrock}`,
      `vertex_ai/${model.id}@${model.snapshot}`,
    );
  } else {
    // Opus 4.6 is the last Bedrock id with a "-v1" suffix.
    const bedrock: string =
      model.id === "claude-opus-4-6"
        ? `anthropic.${model.id}-v1`
        : `anthropic.${model.id}`;

    ids.push(
      bedrock,
      `us.${bedrock}`,
      `jp.${bedrock}`,
      `global.${bedrock}`,
      `bedrock/global.${bedrock}`,
      `vertex_ai/${model.id}`,
    );
  }

  ids.push(
    openRouterId(model.id),
    `${openRouterId(model.id)}:batch`,
    `${model.id}[1m]`,
  );

  return ids;
}

function priceOf(modelName: string): LlmModelPrice | null {
  return LlmCostCatalogUtil.findPriceForModel(modelName);
}

function prefixOf(modelName: string): string | null {
  return priceOf(modelName)?.modelPrefix ?? null;
}

function catalogEntry(prefix: string): LlmModelPrice {
  const entry: LlmModelPrice | undefined = LlmModelPricingCatalog.find(
    (candidate: LlmModelPrice): boolean => {
      return candidate.modelPrefix === prefix;
    },
  );

  expect({ prefix, inCatalog: entry !== undefined }).toEqual({
    prefix,
    inCatalog: true,
  });

  return entry as LlmModelPrice;
}

function costOf(data: {
  model: string;
  inputTokens: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  projectPriceOverrides?: Array<LlmModelPrice>;
}): number | null {
  return LlmCostCatalogUtil.computeCostInUSD({
    model: data.model,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens ?? 0,
    cacheReadTokens: data.cacheReadTokens,
    cacheWriteTokens: data.cacheWriteTokens,
    projectPriceOverrides: data.projectPriceOverrides,
  });
}

describe("the Anthropic prices are the official table's", () => {
  test.each(ANTHROPIC_MODEL_PRICING)(
    "$model: input, 5-minute cache write, cache hit and output",
    (model: OfficialClaudePrice) => {
      const entry: LlmModelPrice = catalogEntry(model.id);

      expect({
        input: entry.inputPricePerMillionTokensInUSD,
        cacheWrite: entry.cacheWritePricePerMillionTokensInUSD,
        cacheRead: entry.cacheReadPricePerMillionTokensInUSD,
        output: entry.outputPricePerMillionTokensInUSD,
      }).toEqual({
        input: model.input,
        cacheWrite: model.cacheWrite,
        cacheRead: model.cacheRead,
        output: model.output,
      });
    },
  );

  test("Claude Haiku 3.5, retired except on Google Cloud, keeps the page's price", () => {
    const entry: LlmModelPrice = catalogEntry(CLAUDE_HAIKU_3_5.id);

    expect([
      entry.inputPricePerMillionTokensInUSD,
      entry.cacheWritePricePerMillionTokensInUSD,
      entry.cacheReadPricePerMillionTokensInUSD,
      entry.outputPricePerMillionTokensInUSD,
    ]).toEqual([0.8, 1, 0.08, 4]);
  });

  test("the catalog prices no Claude model of the current scheme the table does not", () => {
    /*
     * A Claude entry of the current scheme (family first) that is not a row
     * of the page would be a guessed price: Mythos Preview, for one, has no
     * public price and is left out.
     */
    const officialIds: Array<string> = ANTHROPIC_MODEL_PRICING.map(
      (model: OfficialClaudePrice): string => {
        return model.id;
      },
    );
    const familyFirst: RegExp = /^claude-(?:opus|sonnet|haiku|fable|mythos)/;

    const claudeEntries: Array<string> = LlmModelPricingCatalog.map(
      (entry: LlmModelPrice): string => {
        return entry.modelPrefix;
      },
    ).filter((prefix: string): boolean => {
      return familyFirst.test(prefix);
    });

    expect([...claudeEntries].sort()).toEqual([...officialIds].sort());
  });

  test("only Claude Haiku 5.5 has a long-prompt price among the Claude models", () => {
    const withLongPrompt: Array<string> = LlmModelPricingCatalog.filter(
      (entry: LlmModelPrice): boolean => {
        return (
          entry.modelPrefix.startsWith("claude-") &&
          entry.longPrompt !== undefined
        );
      },
    ).map((entry: LlmModelPrice): string => {
      return entry.modelPrefix;
    });

    expect(withLongPrompt).toEqual(["claude-haiku-5-5"]);
  });

  test("the page this table was copied from is the one the catalog cites", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Telemetry/LlmCostCatalog.ts"),
      "utf8",
    );

    expect(citedSources(source)["Anthropic"]).toEqual([ANTHROPIC_PRICING_PAGE]);
  });
});

describe("every shape of a Claude id finds its own model's price", () => {
  for (const model of [...ANTHROPIC_MODEL_PRICING, CLAUDE_HAIKU_3_5]) {
    const ids: Array<string> =
      model === CLAUDE_HAIKU_3_5
        ? [
            "claude-3-5-haiku-20241022",
            "claude-3-5-haiku@20241022",
            "claude-3-5-haiku-latest",
            "anthropic.claude-3-5-haiku-20241022-v1:0",
            "us.anthropic.claude-3-5-haiku-20241022-v1:0",
          ]
        : everyIdOf(model);

    test.each(ids)(`${model.model}: %p`, (modelName: string) => {
      expect(prefixOf(modelName)).toBe(model.id);
      expect(priceOf(modelName)?.inputPricePerMillionTokensInUSD).toBe(
        model.input,
      );
      expect(priceOf(modelName)?.outputPricePerMillionTokensInUSD).toBe(
        model.output,
      );
    });
  }
});

describe("Claude Opus 4.5 and later are no longer charged Opus 4's rate", () => {
  const laterOpus: Array<OfficialClaudePrice> = ANTHROPIC_MODEL_PRICING.filter(
    (model: OfficialClaudePrice): boolean => {
      return [
        "claude-opus-4-5",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8",
      ].includes(model.id);
    },
  );

  test("there are four of them, each at $5 in and $25 out", () => {
    expect(
      laterOpus.map((model: OfficialClaudePrice): string => {
        return `${model.id} ${model.input}/${model.output}`;
      }),
    ).toEqual([
      "claude-opus-4-8 5/25",
      "claude-opus-4-7 5/25",
      "claude-opus-4-6 5/25",
      "claude-opus-4-5 5/25",
    ]);
  });

  for (const model of laterOpus) {
    test.each(everyIdOf(model))(
      `${model.model} as %p is not priced as Claude Opus 4`,
      (modelName: string) => {
        expect(prefixOf(modelName)).not.toBe("claude-opus-4");
        // A million input and a million output tokens: $30, not Opus 4's $90.
        expect(
          costOf({
            model: modelName,
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
          }),
        ).toBe(30);
      },
    );
  }

  test.each([
    "claude-opus-4-20250514",
    "claude-opus-4-0",
    "claude-opus-4@20250514",
    "anthropic.claude-opus-4-20250514-v1:0",
    "anthropic/claude-opus-4",
  ])("Claude Opus 4 itself (%p) still costs $15 / $75", (modelName: string) => {
    expect(prefixOf(modelName)).toBe("claude-opus-4");
    expect(
      costOf({
        model: modelName,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(90);
  });

  test.each([
    "claude-opus-4-1-20250805",
    "claude-opus-4-1",
    "anthropic/claude-opus-4.1",
    "us.anthropic.claude-opus-4-1-20250805-v1:0",
  ])(
    "Claude Opus 4.1 (%p) is its own entry, at Opus 4's price",
    (modelName: string) => {
      expect(prefixOf(modelName)).toBe("claude-opus-4-1");
      expect(priceOf(modelName)?.inputPricePerMillionTokensInUSD).toBe(15);
    },
  );

  test("Sonnet 4.5 and 4.6 and Haiku 4.5 have their own entries too", () => {
    expect(prefixOf("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
    expect(prefixOf("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(prefixOf("claude-sonnet-4-20250514")).toBe("claude-sonnet-4");
    expect(prefixOf("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });
});

describe("a model nobody has priced yet gets no price, never an older model's", () => {
  /*
   * The code's intent since the catalog was written (a94fa35ec4): "Unknown
   * models stay at 0; the catalog never guesses." findPriceForModel answers
   * null, computeCostInUSD answers null, and ingest stores a cost of 0 until
   * the project prices the model on the Pricing tab.
   */
  test.each([
    "claude-opus-4-9",
    "claude-opus-4-10",
    "claude-opus-6",
    "claude-opus-5-6",
    "claude-sonnet-5-6",
    "claude-sonnet-6",
    "claude-haiku-6",
    "claude-haiku-4-6",
    "claude-fable-5-2",
    "claude-fable-6",
    "anthropic/claude-opus-4.9",
    "us.anthropic.claude-opus-4-9-v1",
    "claude-opus-4-9@20270101",
    // Names that place no version.
    "claude-opus-latest",
    "claude-mythos-preview",
    "claude-sonnet",
    // Later versions of other providers' models.
    "gpt-5.9",
    "gpt-4.5-preview",
    "gpt-7",
    "grok-4.9",
    "grok-4-1-fast-reasoning",
    "grok-5",
    "gemini-2.6-pro",
    "gemini-3.8-flash",
  ])("%p", (modelName: string) => {
    expect(prefixOf(modelName)).toBeNull();
    expect(
      costOf({
        model: modelName,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeNull();
  });
});

describe("a name that only contains a Claude id is not read as that model", () => {
  test("a gateway's own name for a Claude model gets no built-in price", () => {
    /*
     * A gateway charges its own way (Databricks in DBUs), so its names are
     * left to the project's prices rather than read as Anthropic's.
     */
    expect(prefixOf("databricks-claude-sonnet-4-5")).toBeNull();
    expect(prefixOf("my-gateway-claude-opus-4-8")).toBeNull();
  });

  test("a project price for the gateway's names keeps winning, as it did before", () => {
    // A 6-character project prefix: no built-in Claude entry outbids it by length.
    expect(
      costOf({
        model: "my-gw-claude-sonnet-4-5",
        inputTokens: 1_000_000,
        projectPriceOverrides: [
          {
            modelPrefix: "my-gw-",
            inputPricePerMillionTokensInUSD: 1,
            outputPricePerMillionTokensInUSD: 2,
          },
        ],
      }),
    ).toBe(1);
  });

  test("OpenRouter's dotted ids of the retired Claude 3 models are not read", () => {
    // The family-first parser leaves the older, version-first scheme alone.
    expect(prefixOf("anthropic/claude-3.5-haiku")).toBeNull();
    expect(prefixOf("anthropic/claude-3.7-sonnet")).toBeNull();
    // Their dashed ids still find their entries.
    expect(prefixOf("anthropic/claude-3-5-haiku")).toBe("claude-3-5-haiku");
  });
});

describe("a later version never falls into an older entry, for any provider", () => {
  test.each([
    // OpenAI's dotted versions.
    ["gpt-5.2", "gpt-5.2"],
    ["gpt-5.2-2025-12-11", "gpt-5.2"],
    ["gpt-5.1", "gpt-5.1"],
    ["gpt-5.4-mini", "gpt-5.4-mini"],
    ["gpt-5.5", "gpt-5.5"],
    ["gpt-5.5-pro", "gpt-5.5-pro"],
    ["gpt-5.6-sol", "gpt-5.6-sol"],
    ["gpt-5.3-codex", "gpt-5.3-codex"],
    ["gpt-6.1-sol", "gpt-6.1-sol"],
    ["gpt-6-sol", "gpt-6-sol"],
    // A variant priced apart from its base model.
    ["gpt-5-pro", "gpt-5-pro"],
    ["gpt-5-pro-2025-10-06", "gpt-5-pro"],
    ["gpt-4o-2024-05-13", "gpt-4o-2024-05-13"],
    ["gpt-3.5-turbo-1106", "gpt-3.5-turbo-1106"],
    // xAI's.
    ["grok-4.7", "grok-4.7"],
    ["grok-4.20-0309-reasoning", "grok-4.20"],
    ["grok-4.20-multi-agent-0309", "grok-4.20"],
    // Cohere's model one word longer, and its dated legacy models.
    ["command-r7b-12-2024", "command-r7b"],
    ["command-r-plus-04-2024", "command-r-plus-04-2024"],
    ["command-r-03-2024", "command-r-03-2024"],
  ])("%p is priced as %p", (modelName: string, prefix: string) => {
    expect(prefixOf(modelName)).toBe(prefix);
  });

  test.each([
    // Dates and snapshot numbers name the same model.
    ["gpt-4-0613", "gpt-4"],
    ["gpt-4-32k", "gpt-4"],
    ["gpt-5-2025-08-07", "gpt-5"],
    ["gpt-5-chat-latest", "gpt-5"],
    ["gpt-4.1-2025-04-14", "gpt-4.1"],
    ["o3-2025-04-16", "o3"],
    ["o1-2024-12-17", "o1"],
    ["grok-4-0709", "grok-4"],
    ["gemini-2.0-flash-001", "gemini-2.0-flash"],
    ["gemini-2.5-flash-preview-05-20", "gemini-2.5-flash"],
    ["command-a-03-2025", "command-a"],
    ["command-r-08-2024", "command-r"],
    ["command-r-plus-08-2024", "command-r-plus"],
    ["mistral-large-latest", "mistral-large"],
    ["claude-3-5-sonnet-v2@20241022", "claude-3-5-sonnet"],
    ["claude-3-7-sonnet-20250219", "claude-3-7-sonnet"],
    // Bedrock's ids for the models it prices.
    ["amazon.nova-pro-v1:0", "nova-pro"],
    ["us.amazon.nova-lite-v1:0", "nova-lite"],
    ["meta.llama3-3-70b-instruct-v1:0", "llama3-3-70b"],
    ["us.meta.llama3-1-405b-instruct-v1:0", "llama3-1-405b"],
    ["meta-llama/llama-3.3-70b-instruct", "llama-3.3-70b"],
  ])("%p is still the %p model", (modelName: string, prefix: string) => {
    expect(prefixOf(modelName)).toBe(prefix);
  });
});

describe("LlmCostCatalogUtil.builtInPrefixMatches", () => {
  test.each([
    // The id is the model, or the model with a date, snapshot or suffix.
    ["claude-opus-4", "claude-opus-4", true],
    ["claude-opus-4", "claude-opus-4-20250514", true],
    ["claude-opus-4", "claude-opus-4-0", true],
    ["claude-opus-4", "claude-opus-4@20250514", true],
    ["claude-opus-4", "claude-opus-4-20250514-v1:0", true],
    ["claude-opus-4", "claude-opus-4[1m]", true],
    ["gpt-4", "gpt-4-0613", true],
    ["gpt-4", "gpt-4-32k", true],
    ["gpt-4", "gpt-4-turbo-2024-04-09", true],
    ["gpt-5", "gpt-5-2025-08-07", true],
    ["grok-4.20", "grok-4.20-0309-reasoning", true],
    ["command-a", "command-a-03-2025", true],
    ["gpt-4o", "gpt-4o-mini", true],
    // A later version.
    ["claude-opus-4", "claude-opus-4-5", false],
    ["claude-opus-4", "claude-opus-4-5-20251101", false],
    ["claude-opus-4", "claude-opus-4-12", false],
    ["claude-opus-4", "claude-opus-4.5", false],
    ["claude-sonnet-4", "claude-sonnet-4-6", false],
    ["gpt-5", "gpt-5.2", false],
    ["gpt-5", "gpt-5.2-pro", false],
    ["gpt-4", "gpt-4.5-preview", false],
    ["grok-4", "grok-4.7", false],
    ["grok-4", "grok-4-1-fast-reasoning", false],
    ["grok-4.20", "grok-4.20.1", false],
    // The prefix stops in the middle of a word.
    ["gpt-4", "gpt-4o", false],
    ["gpt-4", "gpt-40", false],
    ["command-r", "command-r7b", false],
    ["o1", "o10", false],
    ["claude-opus-4-5", "claude-opus-4-50", false],
    // Not the prefix at all.
    ["gpt-4o", "gpt-4", false],
    ["claude-opus-4", "anthropic.claude-opus-4", false],
    ["", "gpt-4o", false],
  ])(
    "%p names %p: %p",
    (prefix: string, candidate: string, matches: boolean) => {
      expect(LlmCostCatalogUtil.builtInPrefixMatches(prefix, candidate)).toBe(
        matches,
      );
    },
  );
});

describe("prompt-cache reads and writes are priced at their own rates", () => {
  test("a Claude Opus 4.5 call that mostly reads its cache", () => {
    /*
     * 100,000 input tokens, of which 80,000 came from the cache and 10,000
     * were written to it, and 2,000 output tokens:
     * 10,000 x $5 + 80,000 x $0.50 + 10,000 x $6.25 + 2,000 x $25 per million.
     */
    expect(
      costOf({
        model: "claude-opus-4-5-20251101",
        inputTokens: 100_000,
        cacheReadTokens: 80_000,
        cacheWriteTokens: 10_000,
        outputTokens: 2_000,
      }),
    ).toBe(0.2025);

    // Without the cache counts every input token pays the input price.
    expect(
      costOf({
        model: "claude-opus-4-5-20251101",
        inputTokens: 100_000,
        outputTokens: 2_000,
      }),
    ).toBe(0.55);
  });

  test.each(ANTHROPIC_MODEL_PRICING)(
    "$model: 100,000 cache reads cost a tenth of its cache-hit price, and writes of its write price",
    (model: OfficialClaudePrice) => {
      // 100,000 tokens: no prompt past Claude Haiku 5.5's long-prompt line.
      expect(
        costOf({
          model: model.id,
          inputTokens: 100_000,
          cacheReadTokens: 100_000,
        }),
      ).toBe(Math.round(model.cacheRead * 1e7) / 1e8);
      expect(
        costOf({
          model: model.id,
          inputTokens: 100_000,
          cacheWriteTokens: 100_000,
        }),
      ).toBe(Math.round(model.cacheWrite * 1e7) / 1e8);
    },
  );

  test("a model the page gives no cache price prices cached tokens as input", () => {
    // Claude 3.5 Sonnet is retired and has no cache price in the catalog.
    expect(
      costOf({
        model: "claude-3-5-sonnet-20241022",
        inputTokens: 100_000,
        cacheReadTokens: 60_000,
        cacheWriteTokens: 20_000,
        outputTokens: 2_000,
      }),
    ).toBe(0.33);
  });

  test("OpenAI's cached input, and Bedrock's free Nova cache writes", () => {
    // gpt-4o: 400,000 cached of 1,000,000 input at $1.25, the rest at $2.50.
    expect(
      costOf({
        model: "gpt-4o-2024-08-06",
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
      }),
    ).toBe(2);
    // Nova Pro writes its cache for nothing and reads it at $0.20.
    expect(
      costOf({
        model: "us.amazon.nova-pro-v1:0",
        inputTokens: 1_000_000,
        cacheReadTokens: 500_000,
        cacheWriteTokens: 300_000,
      }),
    ).toBe(0.26);
  });

  test("a prompt is never smaller than the cache traffic it is made of", () => {
    // A caller that left the cached tokens out of the input is still priced for them.
    expect(
      costOf({
        model: "claude-opus-4-5",
        inputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBe(0.5);
  });

  test("negative, fractional-free garbage cache counts are ignored", () => {
    expect(
      costOf({
        model: "claude-opus-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: -5,
        cacheWriteTokens: NaN,
      }),
    ).toBe(5);
    expect(
      costOf({
        model: "claude-opus-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: Infinity,
      }),
    ).toBe(5);
  });

  test("cache counts alone, with no input or output, are still priced", () => {
    expect(
      costOf({
        model: "claude-sonnet-4-5",
        inputTokens: 0,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBe(3.75);
  });
});

describe("a long prompt pays the long-prompt price, from the first token past the line", () => {
  test("Claude Haiku 5.5: up to 100,000 prompt tokens, then five times the price", () => {
    expect(
      costOf({
        model: "claude-haiku-5-5",
        inputTokens: 100_000,
        outputTokens: 1_000,
      }),
    ).toBe(0.0105);
    expect(
      costOf({
        model: "claude-haiku-5-5",
        inputTokens: 100_001,
        outputTokens: 1_000,
      }),
    ).toBe(0.0525005);
  });

  test("Claude Haiku 5.5's prompt counts its cached tokens, and they pay the long cache prices", () => {
    // 100,001 prompt tokens, 100,000 of them cache reads at $0.05.
    expect(
      costOf({
        model: "anthropic/claude-haiku-5.5",
        inputTokens: 100_001,
        cacheReadTokens: 100_000,
        outputTokens: 1_000,
      }),
    ).toBe(0.0075005);
  });

  test("Claude Haiku 5.5's long-prompt row is the official table's second row", () => {
    const longPrompt: LlmModelPrice["longPrompt"] =
      catalogEntry("claude-haiku-5-5").longPrompt;

    expect(longPrompt).toEqual({
      fromPromptTokens: 100_001,
      inputPricePerMillionTokensInUSD: 0.5,
      cacheWritePricePerMillionTokensInUSD: 0.625,
      cacheReadPricePerMillionTokensInUSD: 0.05,
      outputPricePerMillionTokensInUSD: 2.5,
    });
  });

  test("OpenAI: a prompt over 272K tokens", () => {
    expect(costOf({ model: "gpt-5.4", inputTokens: 272_000 })).toBe(0.68);
    expect(costOf({ model: "gpt-5.4", inputTokens: 272_001 })).toBe(1.360005);
  });

  test("xAI: a prompt that reaches 200K tokens", () => {
    expect(costOf({ model: "grok-4.7", inputTokens: 199_999 })).toBe(0.399998);
    expect(costOf({ model: "grok-4.7", inputTokens: 200_000 })).toBe(0.8);
  });

  test("Gemini 2.5 Pro: a prompt over 200K tokens", () => {
    expect(costOf({ model: "gemini-2.5-pro", inputTokens: 200_000 })).toBe(
      0.25,
    );
    expect(costOf({ model: "gemini-2.5-pro", inputTokens: 200_001 })).toBe(
      0.5000025,
    );
  });

  test("a long tier with no cache price charges cached tokens its own input price", () => {
    // gpt-5.5-pro takes no cache discount: over 272K every input token is $60.
    expect(
      costOf({
        model: "gpt-5.5-pro",
        inputTokens: 1_000_000,
        cacheReadTokens: 900_000,
      }),
    ).toBe(60);
  });
});

describe("LlmCostCatalogUtil.callPrices", () => {
  test("the short tier, with cache prices falling back to the input price", () => {
    const prices: LlmCallPrices = LlmCostCatalogUtil.callPrices(
      catalogEntry("gpt-5-pro"),
      1_000,
    );

    expect(prices).toEqual({
      inputPricePerMillionTokensInUSD: 15,
      outputPricePerMillionTokensInUSD: 120,
      cacheReadPricePerMillionTokensInUSD: 15,
      cacheWritePricePerMillionTokensInUSD: 15,
    });
  });

  test("the long tier from its first prompt token", () => {
    const entry: LlmModelPrice = catalogEntry("gpt-5.6-sol");

    expect(LlmCostCatalogUtil.callPrices(entry, 272_000)).toEqual({
      inputPricePerMillionTokensInUSD: 4,
      outputPricePerMillionTokensInUSD: 20,
      cacheReadPricePerMillionTokensInUSD: 0.4,
      cacheWritePricePerMillionTokensInUSD: 5,
    });
    expect(LlmCostCatalogUtil.callPrices(entry, 272_001)).toEqual({
      inputPricePerMillionTokensInUSD: 8,
      outputPricePerMillionTokensInUSD: 30,
      cacheReadPricePerMillionTokensInUSD: 0.8,
      cacheWritePricePerMillionTokensInUSD: 10,
    });
  });
});

describe("a project's own prices still win", () => {
  const negotiatedOpus: Array<LlmModelPrice> = [
    {
      modelPrefix: "claude-opus-4-5",
      inputPricePerMillionTokensInUSD: 4,
      outputPricePerMillionTokensInUSD: 20,
    },
  ];

  test.each(everyIdOf(ANTHROPIC_MODEL_PRICING[9] as OfficialClaudePrice))(
    "a negotiated Claude Opus 4.5 price wins the tie for %p",
    (modelName: string) => {
      expect(
        costOf({
          model: modelName,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          projectPriceOverrides: negotiatedOpus,
        }),
      ).toBe(24);
    },
  );

  test("a project's price is charged for every input token, cached or not", () => {
    expect(
      costOf({
        model: "claude-opus-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: 800_000,
        cacheWriteTokens: 100_000,
        projectPriceOverrides: negotiatedOpus,
      }),
    ).toBe(4);
  });

  test("a project price carries no cache or long-prompt prices, whatever it is handed", () => {
    expect(
      costOf({
        model: "claude-opus-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        projectPriceOverrides: [
          {
            modelPrefix: "claude-opus-4-5",
            inputPricePerMillionTokensInUSD: 4,
            outputPricePerMillionTokensInUSD: 20,
            cacheReadPricePerMillionTokensInUSD: 0.01,
            longPrompt: {
              fromPromptTokens: 1,
              inputPricePerMillionTokensInUSD: 100,
              outputPricePerMillionTokensInUSD: 100,
            },
          },
        ],
      }),
    ).toBe(4);
  });

  test("a project price matches as the plain prefix its owner wrote", () => {
    // A price for "claude-opus-4" covers a model the built-in list does not know...
    const opusFour: Array<LlmModelPrice> = [
      {
        modelPrefix: "claude-opus-4",
        inputPricePerMillionTokensInUSD: 12,
        outputPricePerMillionTokensInUSD: 60,
      },
    ];

    expect(
      costOf({
        model: "claude-opus-4-9",
        inputTokens: 1_000_000,
        projectPriceOverrides: opusFour,
      }),
    ).toBe(12);
    expect(
      costOf({
        model: "claude-opus-4-20250514",
        inputTokens: 1_000_000,
        projectPriceOverrides: opusFour,
      }),
    ).toBe(12);
    // ...while a longer built-in entry, Opus 4.5's own, still beats it.
    expect(
      costOf({
        model: "claude-opus-4-5-20251101",
        inputTokens: 1_000_000,
        projectPriceOverrides: opusFour,
      }),
    ).toBe(5);
  });

  test("a project can price a model the built-in list does not know yet", () => {
    expect(
      costOf({
        model: "anthropic/claude-opus-6",
        inputTokens: 1_000_000,
        projectPriceOverrides: [
          {
            modelPrefix: "anthropic/claude-opus-6",
            inputPricePerMillionTokensInUSD: 6,
            outputPricePerMillionTokensInUSD: 30,
          },
        ],
      }),
    ).toBe(6);
  });
});

describe("the catalog's prices hold together", () => {
  test("cache prices, long-prompt prices and thresholds are non-negative numbers", () => {
    for (const entry of LlmModelPricingCatalog) {
      const tiers: Array<
        LlmModelPrice | NonNullable<LlmModelPrice["longPrompt"]>
      > = entry.longPrompt ? [entry, entry.longPrompt] : [entry];

      for (const tier of tiers) {
        for (const price of [
          tier.inputPricePerMillionTokensInUSD,
          tier.outputPricePerMillionTokensInUSD,
          tier.cacheReadPricePerMillionTokensInUSD ?? 0,
          tier.cacheWritePricePerMillionTokensInUSD ?? 0,
        ]) {
          expect({ prefix: entry.modelPrefix, price }).toEqual({
            prefix: entry.modelPrefix,
            price: expect.any(Number),
          });
          expect(isFinite(price) && price >= 0).toBe(true);
        }
      }

      if (entry.longPrompt) {
        expect(Number.isInteger(entry.longPrompt.fromPromptTokens)).toBe(true);
        expect(entry.longPrompt.fromPromptTokens).toBeGreaterThan(1_000);
      }
    }
  });

  test("a cache read never costs more than an input token", () => {
    for (const entry of LlmModelPricingCatalog) {
      for (const tier of entry.longPrompt
        ? [entry, entry.longPrompt]
        : [entry]) {
        expect({
          prefix: entry.modelPrefix,
          cheaper:
            (tier.cacheReadPricePerMillionTokensInUSD ?? 0) <=
            tier.inputPricePerMillionTokensInUSD,
        }).toEqual({ prefix: entry.modelPrefix, cheaper: true });
      }
    }
  });

  test("a long prompt never costs less than a short one", () => {
    for (const entry of LlmModelPricingCatalog) {
      if (!entry.longPrompt) {
        continue;
      }

      expect({
        prefix: entry.modelPrefix,
        input:
          entry.longPrompt.inputPricePerMillionTokensInUSD >=
          entry.inputPricePerMillionTokensInUSD,
        output:
          entry.longPrompt.outputPricePerMillionTokensInUSD >=
          entry.outputPricePerMillionTokensInUSD,
      }).toEqual({ prefix: entry.modelPrefix, input: true, output: true });
    }
  });

  test("no built-in entry is shadowed: every prefix finds itself", () => {
    for (const entry of LlmModelPricingCatalog) {
      expect({
        prefix: entry.modelPrefix,
        found: prefixOf(entry.modelPrefix),
      }).toEqual({ prefix: entry.modelPrefix, found: entry.modelPrefix });
    }
  });

  test("moving input tokens into the cache never raises the cost of a read, for any model", () => {
    const random: SeededRandom = seededRandom(4695);

    for (const entry of LlmModelPricingCatalog) {
      for (let draw: number = 0; draw < 20; draw++) {
        const inputTokens: number = 1 + random(400_000);
        const cacheReadTokens: number = random(inputTokens + 1);
        const outputTokens: number = random(50_000);

        const uncached: number = costOf({
          model: entry.modelPrefix,
          inputTokens: inputTokens,
          outputTokens: outputTokens,
        }) as number;
        const cached: number = costOf({
          model: entry.modelPrefix,
          inputTokens: inputTokens,
          cacheReadTokens: cacheReadTokens,
          outputTokens: outputTokens,
        }) as number;

        // Within the 8th decimal place both costs are rounded to.
        expect({
          prefix: entry.modelPrefix,
          cheaper: cached <= uncached + 1e-8,
        }).toEqual({ prefix: entry.modelPrefix, cheaper: true });
        expect(cached).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/*
 * The source each provider's section of the catalog cites: the URLs in the
 * comment block right under its "// ---- Provider ----" line.
 */
const SECTION_LINE: RegExp = /^\s*\/\/ ---- ([^-]+?)(?: \([^)]*\))? ----$/;
// A URL, without the punctuation of the sentence it ends.
const URL_IN_TEXT: RegExp = /https:\/\/[^\s)"]*[^\s)".,:;]/g;

function citedSources(source: string): Record<string, Array<string>> {
  const cited: Record<string, Array<string>> = {};
  const lines: Array<string> = source.split("\n");

  for (let index: number = 0; index < lines.length; index++) {
    const section: RegExpMatchArray | null = (lines[index] as string).match(
      SECTION_LINE,
    );

    if (!section) {
      continue;
    }

    const urls: Array<string> = [];

    // The comment block that follows the section line.
    for (let next: number = index + 1; next < lines.length; next++) {
      const line: string = (lines[next] as string).trim();

      if (!line.startsWith("/*") && !line.startsWith("*")) {
        break;
      }

      urls.push(
        ...Array.from(line.matchAll(URL_IN_TEXT)).map(
          (match: RegExpMatchArray): string => {
            return match[0];
          },
        ),
      );
    }

    cited[section[1] as string] = urls;
  }

  return cited;
}

describe("every provider's prices cite the provider's own pricing page", () => {
  /*
   * A price nobody can trace to a page is a guess. Each section of the
   * catalog names the official page its prices were copied from, on the
   * provider's own site (Amazon's for the models it prices on Bedrock).
   */
  const OFFICIAL_HOSTS: Record<string, string> = {
    OpenAI: "developers.openai.com",
    Anthropic: "platform.claude.com",
    "Google Gemini": "ai.google.dev",
    Mistral: "mistral.ai",
    DeepSeek: "api-docs.deepseek.com",
    xAI: "docs.x.ai",
    Cohere: "cohere.com",
    "Amazon Nova": "aws.amazon.com",
    "Meta Llama": "aws.amazon.com",
  };

  const source: string = fs.readFileSync(
    path.join(__dirname, "../../../Types/Telemetry/LlmCostCatalog.ts"),
    "utf8",
  );

  test("the sections are the providers the docs name, in their order", () => {
    expect(Object.keys(citedSources(source))).toEqual(
      Object.keys(OFFICIAL_HOSTS),
    );
  });

  test.each(Object.entries(OFFICIAL_HOSTS))(
    "%s cites a page on %s",
    (provider: string, host: string) => {
      const urls: Array<string> = citedSources(source)[provider] || [];

      expect(urls.length).toBeGreaterThan(0);

      for (const url of urls) {
        expect(new URL(url).host).toBe(host);
      }
    },
  );
});
