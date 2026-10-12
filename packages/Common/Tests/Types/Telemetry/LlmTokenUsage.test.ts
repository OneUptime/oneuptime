import LlmTokenUsageUtil, {
  LlmAttributeNumberReader,
  LlmTokenUsage,
} from "../../../Types/Telemetry/LlmTokenUsage";
import {
  ClaudeCodeUsageAttributeKeys,
  LlmCacheReadTokenAttributeKeys,
  LlmCacheWriteTokenAttributeKeys,
  LlmInputTokenAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmTotalTokenAttributeKeys,
} from "../../../Types/Telemetry/LlmConventions";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * LlmTokenUsage reads a call's tokens the way the OpenTelemetry GenAI
 * conventions count them: the input count is every token the model read,
 * cached ones included, and the cache counts say how many of them came from
 * or went to the prompt cache. The ingest extractor stores what it returns
 * and prices the call from it; the span panel shows it.
 *
 * Claude Code's traces beta (the claude_code.llm_request span) is the case
 * that used to arrive with no tokens at all: it writes the Anthropic API's
 * usage block under bare keys, its input_tokens leaving the cached tokens
 * out (code.claude.com/docs/en/monitoring-usage, "Span attributes" and "Map
 * input tokens to OpenTelemetry GenAI semantic conventions", read
 * 2026-10-12).
 */

type Attributes = Record<string, unknown>;

function reader(attributes: Attributes): LlmAttributeNumberReader {
  return (key: string): number | null => {
    const value: unknown = attributes[key];

    if (typeof value === "number") {
      return isFinite(value) ? value : null;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed: number = Number(value);

      return isFinite(parsed) ? parsed : null;
    }

    return null;
  };
}

function read(
  attributes: Attributes,
  namesModelOrProvider: boolean = true,
): LlmTokenUsage {
  return LlmTokenUsageUtil.read({
    numberOf: reader(attributes),
    namesModelOrProvider: namesModelOrProvider,
  });
}

// A claude_code.llm_request span's usage, as Claude Code's docs list it.
const CLAUDE_CODE_USAGE: Attributes = {
  input_tokens: 12,
  output_tokens: 640,
  cache_read_tokens: 48_000,
  cache_creation_tokens: 2_100,
};

describe("the GenAI conventions and the libraries that write them", () => {
  test("gen_ai.usage.* as written, the total derived when absent", () => {
    expect(
      read({
        "gen_ai.usage.input_tokens": 1_200,
        "gen_ai.usage.output_tokens": 350,
      }),
    ).toEqual({
      inputTokens: 1_200,
      outputTokens: 350,
      totalTokens: 1_550,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reportedOutputTokens: 350,
    });
  });

  test("a reported total is kept as reported", () => {
    expect(
      read({
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 50,
        "gen_ai.usage.total_tokens": 999,
      }).totalTokens,
    ).toBe(999);
  });

  test("a reported total of 0 is no total at all", () => {
    expect(
      read({
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 50,
        "gen_ai.usage.total_tokens": 0,
      }).totalTokens,
    ).toBe(150);
  });

  test.each(LlmInputTokenAttributeKeys)(
    "input key %s is read on its own",
    (key: string) => {
      expect(read({ [key]: 42 }).inputTokens).toBe(42);
    },
  );

  test.each(LlmOutputTokenAttributeKeys)(
    "output key %s is read on its own",
    (key: string) => {
      expect(read({ [key]: 7 }).outputTokens).toBe(7);
      expect(read({ [key]: 7 }).reportedOutputTokens).toBe(7);
    },
  );

  test.each(LlmTotalTokenAttributeKeys)(
    "total key %s is read on its own",
    (key: string) => {
      expect(read({ [key]: 99 }).totalTokens).toBe(99);
    },
  );

  test("the first key of a list wins, in the order LlmConventions lists them", () => {
    expect(
      read({
        "gen_ai.usage.prompt_tokens": 1,
        "gen_ai.usage.input_tokens": 2,
        "llm.token_count.prompt": 3,
      }).inputTokens,
    ).toBe(2);
  });

  test("numbers sent as strings are read, fractions truncated, garbage and negatives are 0", () => {
    expect(
      read({
        "gen_ai.usage.input_tokens": "42",
        "gen_ai.usage.output_tokens": 8.9,
      }),
    ).toMatchObject({ inputTokens: 42, outputTokens: 8, totalTokens: 50 });
    expect(
      read({
        "gen_ai.usage.input_tokens": "lots",
        "gen_ai.usage.output_tokens": -3,
      }),
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("an unreadable first key falls through to the next one", () => {
    expect(
      read({
        "gen_ai.usage.input_tokens": "n/a",
        "gen_ai.usage.prompt_tokens": 64,
      }).inputTokens,
    ).toBe(64);
  });

  test("the output count as reported: null when absent, 0 when it says 0", () => {
    expect(read({ "gen_ai.usage.input_tokens": 10 }).reportedOutputTokens).toBe(
      null,
    );
    expect(
      read({
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 0,
      }).reportedOutputTokens,
    ).toBe(0);
  });

  test("a span with no tokens at all reads as the empty usage", () => {
    expect(read({})).toEqual(LlmTokenUsageUtil.empty());
    expect(read({ "http.method": "GET" }, false)).toEqual(
      LlmTokenUsageUtil.empty(),
    );
  });
});

describe("prompt-cache counts", () => {
  test.each(LlmCacheReadTokenAttributeKeys)(
    "cache-read key %s is read, as part of the input",
    (key: string) => {
      expect(
        read({ "gen_ai.usage.input_tokens": 10_000, [key]: 9_000 }),
      ).toMatchObject({
        inputTokens: 10_000,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 0,
      });
    },
  );

  test.each(LlmCacheWriteTokenAttributeKeys)(
    "cache-write key %s is read, as part of the input",
    (key: string) => {
      expect(
        read({ "gen_ai.usage.input_tokens": 10_000, [key]: 4_000 }),
      ).toMatchObject({
        inputTokens: 10_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 4_000,
      });
    },
  );

  test("the conventions' names come first, then OpenLLMetry's older ones, then OpenInference's", () => {
    expect(LlmCacheReadTokenAttributeKeys).toEqual([
      "gen_ai.usage.cache_read.input_tokens",
      "gen_ai.usage.cache_read_input_tokens",
      "llm.token_count.prompt_details.cache_read",
    ]);
    expect(LlmCacheWriteTokenAttributeKeys).toEqual([
      "gen_ai.usage.cache_write.input_tokens",
      "gen_ai.usage.cache_creation.input_tokens",
      "gen_ai.usage.cache_creation_input_tokens",
      "llm.token_count.prompt_details.cache_write",
    ]);
  });

  test("OpenLLMetry's Anthropic span, which counts the cache in its input, is read as it is", () => {
    expect(
      read({
        "gen_ai.usage.input_tokens": 50_105,
        "gen_ai.usage.output_tokens": 300,
        "gen_ai.usage.total_tokens": 50_405,
        "gen_ai.usage.cache_read.input_tokens": 45_000,
        "gen_ai.usage.cache_creation.input_tokens": 5_000,
      }),
    ).toEqual({
      inputTokens: 50_105,
      outputTokens: 300,
      totalTokens: 50_405,
      cacheReadTokens: 45_000,
      cacheWriteTokens: 5_000,
      reportedOutputTokens: 300,
    });
  });

  test("an input count smaller than its own cache counts left them out, so they are added in", () => {
    // The Anthropic API's own count written into gen_ai.usage.input_tokens.
    expect(
      read({
        "gen_ai.usage.input_tokens": 105,
        "gen_ai.usage.output_tokens": 300,
        "gen_ai.usage.total_tokens": 405,
        "gen_ai.usage.cache_read_input_tokens": 45_000,
        "gen_ai.usage.cache_creation_input_tokens": 5_000,
      }),
    ).toEqual({
      inputTokens: 50_105,
      outputTokens: 300,
      totalTokens: 50_405,
      cacheReadTokens: 45_000,
      cacheWriteTokens: 5_000,
      reportedOutputTokens: 300,
    });
  });

  test("OpenInference's prompt details are sub-counts of llm.token_count.prompt", () => {
    expect(
      read({
        "llm.token_count.prompt": 2_000,
        "llm.token_count.completion": 100,
        "llm.token_count.prompt_details.cache_read": 1_500,
        "llm.token_count.prompt_details.cache_write": 0,
      }),
    ).toMatchObject({
      inputTokens: 2_000,
      totalTokens: 2_100,
      cacheReadTokens: 1_500,
      cacheWriteTokens: 0,
    });
  });
});

describe("Claude Code's traces beta", () => {
  test("the keys are Claude Code's own names", () => {
    expect(ClaudeCodeUsageAttributeKeys).toEqual({
      inputTokens: "input_tokens",
      outputTokens: "output_tokens",
      cacheReadTokens: "cache_read_tokens",
      cacheWriteTokens: "cache_creation_tokens",
    });
  });

  test("its input count is input_tokens + cache_read_tokens + cache_creation_tokens", () => {
    expect(read(CLAUDE_CODE_USAGE)).toEqual({
      inputTokens: 50_112,
      outputTokens: 640,
      totalTokens: 50_752,
      cacheReadTokens: 48_000,
      cacheWriteTokens: 2_100,
      reportedOutputTokens: 640,
    });
  });

  test("only on a span that names its model or provider", () => {
    expect(read(CLAUDE_CODE_USAGE, false)).toEqual(LlmTokenUsageUtil.empty());
  });

  test("a span that carries a convention's input or output count is read by the convention", () => {
    expect(
      read({
        ...CLAUDE_CODE_USAGE,
        "gen_ai.usage.input_tokens": 70,
        "gen_ai.usage.output_tokens": 30,
      }),
    ).toEqual({
      inputTokens: 70,
      outputTokens: 30,
      totalTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reportedOutputTokens: 30,
    });
    expect(
      read({ ...CLAUDE_CODE_USAGE, "llm.token_count.completion": 5 })
        .outputTokens,
    ).toBe(5);
  });

  test("a request answered entirely from the cache", () => {
    expect(
      read({
        input_tokens: 0,
        output_tokens: 15,
        cache_read_tokens: 9_000,
        cache_creation_tokens: 0,
      }),
    ).toMatchObject({ inputTokens: 9_000, outputTokens: 15, totalTokens: 9_015 });
  });

  test("any one of the keys is enough, and values sent as strings count", () => {
    expect(read({ output_tokens: "12" })).toMatchObject({
      inputTokens: 0,
      outputTokens: 12,
      totalTokens: 12,
      reportedOutputTokens: 12,
    });
    expect(read({ cache_read_tokens: 500 })).toMatchObject({
      inputTokens: 500,
      cacheReadTokens: 500,
    });
  });

  test("a failed request that used no tokens reads as no usage", () => {
    expect(read({ input_tokens: 0, output_tokens: 0 })).toEqual({
      ...LlmTokenUsageUtil.empty(),
      reportedOutputTokens: 0,
    });
  });
});

describe("the two readings of one call agree", () => {
  /*
   * The same request, reported by Claude Code's traces beta (cache apart)
   * and by an instrumentation that follows the GenAI conventions (cache
   * inside the input count), reads as the same usage - so it is priced the
   * same and shows the same numbers whichever way it arrived.
   */
  test("for any mix of uncached, cached, written and output tokens", () => {
    const random: SeededRandom = seededRandom(2026);

    for (let draw: number = 0; draw < 500; draw++) {
      const uncached: number = random(20_000);
      const cacheRead: number = random(500_000);
      const cacheWrite: number = random(50_000);
      const output: number = random(30_000);

      const claudeCode: LlmTokenUsage = read({
        input_tokens: uncached,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_creation_tokens: cacheWrite,
      });
      const conventions: LlmTokenUsage = read({
        "gen_ai.usage.input_tokens": uncached + cacheRead + cacheWrite,
        "gen_ai.usage.output_tokens": output,
        "gen_ai.usage.cache_read.input_tokens": cacheRead,
        "gen_ai.usage.cache_write.input_tokens": cacheWrite,
      });

      expect(claudeCode).toEqual(conventions);
    }
  });
});
