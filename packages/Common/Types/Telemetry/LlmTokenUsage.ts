import {
  ClaudeCodeUsageAttributeKeys,
  LlmCacheReadTokenAttributeKeys,
  LlmCacheWriteTokenAttributeKeys,
  LlmInputTokenAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmTotalTokenAttributeKeys,
} from "./LlmConventions";

/*
 * A call's token usage, read off its span the way the OpenTelemetry GenAI
 * semantic conventions count it: the input count is EVERY token the model
 * read, the ones it read from or wrote to the provider's prompt cache
 * included, and the cache counts say how many of them those were.
 *
 * The ingest extractor (Common/Server/Utils/Telemetry/LlmSpan.ts), which
 * stores the token columns and prices the call, and the Dashboard's span
 * panel (LlmSpanDisplay) both read through here, so the panel never shows
 * other numbers than the columns.
 *
 * Instrumentations do not all count the same way, and two shapes need
 * adding up:
 *
 *  - Claude Code's traces beta sets no gen_ai.usage.* key. Its model span
 *    carries the Anthropic API's own usage block under bare names, whose
 *    input_tokens leaves the cached tokens out (ClaudeCodeUsageAttributeKeys).
 *    Its input count is input_tokens + cache_read_tokens +
 *    cache_creation_tokens, as Claude Code's monitoring docs say to map it.
 *  - An instrumentation that writes the Anthropic count into
 *    gen_ai.usage.input_tokens, against the conventions, gives itself away
 *    when its cache counts are larger than its input count: an input count
 *    that held them could not be smaller. Its cached tokens are added in.
 *    (A smaller cache count left out of the input cannot be told apart, and
 *    is read as the conventions say.)
 */
export interface LlmTokenUsage {
  // Every input token, cached ones included.
  inputTokens: number;
  outputTokens: number;
  // The reported total, or input + output when none was reported.
  totalTokens: number;
  // Of the input tokens, the ones read from the provider's prompt cache.
  cacheReadTokens: number;
  // Of the input tokens, the ones written to the provider's prompt cache.
  cacheWriteTokens: number;
  /*
   * The output count exactly as the span reported it, or null when it
   * reported none. An absent count is not a zero: the answer checks read an
   * explicit 0 as an empty answer.
   */
  reportedOutputTokens: number | null;
}

/*
 * The number an attribute of the span holds: a number, or a string that is
 * one. Null when the span has no such attribute or it is not a number.
 */
export type LlmAttributeNumberReader = (key: string) => number | null;

export default class LlmTokenUsageUtil {
  public static empty(): LlmTokenUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reportedOutputTokens: null,
    };
  }

  /**
   * Read a span's token usage. `namesModelOrProvider` says whether the span
   * names its model or provider (gen_ai.request.model, gen_ai.system and the
   * like): only such a span's bare Claude Code keys are read, because
   * input_tokens and output_tokens are names any span could carry.
   */
  public static read(data: {
    numberOf: LlmAttributeNumberReader;
    namesModelOrProvider: boolean;
  }): LlmTokenUsage {
    const first: (keys: Array<string>) => number | null = (
      keys: Array<string>,
    ): number | null => {
      for (const key of keys) {
        const value: number | null = data.numberOf(key);

        if (value !== null && isFinite(value)) {
          return value;
        }
      }

      return null;
    };

    let input: number | null = first(LlmInputTokenAttributeKeys);
    let output: number | null = first(LlmOutputTokenAttributeKeys);
    let cacheRead: number | null = first(LlmCacheReadTokenAttributeKeys);
    let cacheWrite: number | null = first(LlmCacheWriteTokenAttributeKeys);

    // Whether the input count leaves the cached tokens out.
    let cachedTokensApart: boolean = false;

    if (input === null && output === null && data.namesModelOrProvider) {
      const claudeCode: Array<number | null> = [
        ClaudeCodeUsageAttributeKeys.inputTokens,
        ClaudeCodeUsageAttributeKeys.outputTokens,
        ClaudeCodeUsageAttributeKeys.cacheReadTokens,
        ClaudeCodeUsageAttributeKeys.cacheWriteTokens,
      ].map((key: string): number | null => {
        return first([key]);
      });

      if (
        claudeCode.some((value: number | null): boolean => {
          return value !== null;
        })
      ) {
        input = claudeCode[0] ?? null;
        output = claudeCode[1] ?? null;
        cacheRead = claudeCode[2] ?? cacheRead;
        cacheWrite = claudeCode[3] ?? cacheWrite;
        cachedTokensApart = true;
      }
    }

    const inputCount: number = this.count(input);
    const outputCount: number = this.count(output);
    const cacheReadTokens: number = this.count(cacheRead);
    const cacheWriteTokens: number = this.count(cacheWrite);
    const cachedTokens: number = cacheReadTokens + cacheWriteTokens;

    if (cachedTokens > inputCount) {
      cachedTokensApart = true;
    }

    const addedCachedTokens: number = cachedTokensApart ? cachedTokens : 0;
    const inputTokens: number = inputCount + addedCachedTokens;

    /*
     * A reported total of a count that left the cached tokens out left them
     * out too. One of 0 is no total at all, as it always was.
     */
    const reportedTotal: number = this.count(first(LlmTotalTokenAttributeKeys));

    let totalTokens: number =
      reportedTotal > 0 ? reportedTotal + addedCachedTokens : 0;

    if (totalTokens === 0 && (inputTokens > 0 || outputCount > 0)) {
      totalTokens = inputTokens + outputCount;
    }

    return {
      inputTokens: inputTokens,
      outputTokens: outputCount,
      totalTokens: totalTokens,
      cacheReadTokens: cacheReadTokens,
      cacheWriteTokens: cacheWriteTokens,
      reportedOutputTokens: output,
    };
  }

  /*
   * A token count as a column holds it: a whole, non-negative number (the
   * columns are ClickHouse Int32, and a malformed fractional count must not
   * fail the batch's insert).
   */
  private static count(value: number | null): number {
    if (value === null || !isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.trunc(value);
  }
}
