/*
 * How OneUptime counts the tokens of its own AI calls (issue #5073): the
 * "Tokens Used" of the AI Logs, the tokens of each AI run (an
 * investigation, an Ask AI answer, a fix), the project's daily AI token
 * limit and the incident and alert ones, and the AI credits a call through
 * the OneUptime-hosted provider is charged.
 *
 * A token counts for what it costs. A token the model reads fresh, and every
 * token it writes, counts as one. A token the provider serves from its prompt
 * cache - a token the model already read on an earlier call of the same
 * investigation or chat, sent again with the conversation - costs a tenth of
 * a fresh one at Anthropic (less on its newest models) and on OpenAI's
 * current models, and counts as a tenth. A token written to the cache costs a
 * quarter more than a fresh one at Anthropic (its 5-minute cache, the one
 * OneUptime asks for), and counts as one and a quarter. Without the cache an
 * agent loop pays for its whole conversation again on every call, so counting
 * every cached token as a fresh one made AI work count several times what it
 * cost - and the more OneUptime caches, the further apart the two would grow.
 *
 * The providers report cached tokens two ways, and both are counted alike:
 *
 *  - The OpenAI wire (OpenAI, Azure OpenAI, Groq, Mistral, OpenAI-compatible
 *    servers) counts them inside prompt_tokens, and reports how many in
 *    prompt_tokens_details.cached_tokens. It never reports a cache write:
 *    writing costs nothing extra there.
 *  - Anthropic reports input_tokens WITHOUT them, and cache_read_input_tokens
 *    and cache_creation_input_tokens apart; LLMService adds them back.
 *
 * Either way totalTokens holds every token of the call (LlmLog.totalTokens,
 * as the provider counted them), and the cached ones are a part of it.
 *
 * Pure and free of React and server code: the server counts with it, and the
 * dashboard's AI Logs show the same count.
 */

// A weight in whole numbers, so a count is exact (0.1 is not, in floating point).
export interface AiTokenWeight {
  numerator: number;
  denominator: number;
}

// A token read from the provider's prompt cache counts as a tenth of a token.
export const CACHE_READ_TOKEN_WEIGHT: AiTokenWeight = {
  numerator: 1,
  denominator: 10,
};

// A token written to the provider's prompt cache counts as one and a quarter.
export const CACHE_WRITE_TOKEN_WEIGHT: AiTokenWeight = {
  numerator: 5,
  denominator: 4,
};

/*
 * A call's tokens as the provider reported them, or a sum of calls': any of
 * them may be missing (a provider that reports no cache traffic, an older AI
 * Logs row), which is none.
 */
export interface AiTokenUsage {
  // Every token of the call: input, cached input included, and output.
  totalTokens?: number | null | undefined;
  // Of them, the input tokens read from the provider's prompt cache.
  cachedInputTokens?: number | null | undefined;
  // Of them, the input tokens written to the provider's prompt cache.
  cacheCreationTokens?: number | null | undefined;
}

export interface AiTokenCountBreakdown {
  // What the call counts as: the sum of the three parts below.
  countedTokens: number;
  // Every token of the call, as the provider counted them.
  totalTokens: number;
  // Tokens read fresh and tokens written: each counts as one.
  freshTokens: number;
  // Read from the prompt cache, and what they count as.
  cacheReadTokens: number;
  countedCacheReadTokens: number;
  // Written to the prompt cache, and what they count as.
  cacheWriteTokens: number;
  countedCacheWriteTokens: number;
}

export default class AiTokenCount {
  /*
   * What a call - or a sum of calls - counts as: its fresh tokens, a tenth
   * of the tokens read from the prompt cache and one and a quarter of the
   * tokens written to it, each weighted part rounded up to a whole token.
   */
  public static count(usage: AiTokenUsage): number {
    return this.getBreakdown(usage).countedTokens;
  }

  /*
   * The count and what it is made of. A provider's report that does not add
   * up - more cached tokens than tokens - never counts below zero fresh
   * tokens, and its cache counts stand as reported.
   */
  public static getBreakdown(usage: AiTokenUsage): AiTokenCountBreakdown {
    const totalTokens: number = this.toTokenCount(usage.totalTokens);
    const cacheReadTokens: number = this.toTokenCount(usage.cachedInputTokens);
    const cacheWriteTokens: number = this.toTokenCount(
      usage.cacheCreationTokens,
    );

    const freshTokens: number = Math.max(
      0,
      totalTokens - cacheReadTokens - cacheWriteTokens,
    );

    const countedCacheReadTokens: number = this.weigh(
      cacheReadTokens,
      CACHE_READ_TOKEN_WEIGHT,
    );
    const countedCacheWriteTokens: number = this.weigh(
      cacheWriteTokens,
      CACHE_WRITE_TOKEN_WEIGHT,
    );

    return {
      countedTokens:
        freshTokens + countedCacheReadTokens + countedCacheWriteTokens,
      totalTokens,
      freshTokens,
      cacheReadTokens,
      countedCacheReadTokens,
      cacheWriteTokens,
      countedCacheWriteTokens,
    };
  }

  // Whether the call read from or wrote to the provider's prompt cache.
  public static usedPromptCache(usage: AiTokenUsage): boolean {
    return (
      this.toTokenCount(usage.cachedInputTokens) > 0 ||
      this.toTokenCount(usage.cacheCreationTokens) > 0
    );
  }

  /*
   * The tokens of several calls added up, part by part - what a day of AI
   * Logs rows sums to before it is counted.
   */
  public static add(usages: Array<AiTokenUsage>): Required<AiTokenUsage> {
    const sum: { total: number; read: number; write: number } = {
      total: 0,
      read: 0,
      write: 0,
    };

    for (const usage of usages) {
      sum.total += this.toTokenCount(usage.totalTokens);
      sum.read += this.toTokenCount(usage.cachedInputTokens);
      sum.write += this.toTokenCount(usage.cacheCreationTokens);
    }

    return {
      totalTokens: sum.total,
      cachedInputTokens: sum.read,
      cacheCreationTokens: sum.write,
    };
  }

  /*
   * A token count as a whole, non-negative number: a count reported as a
   * string (a SQL sum), a fraction, a negative number or anything else that
   * is not a count is read as the whole tokens it holds, or none.
   */
  public static toTokenCount(value: unknown): number {
    const parsed: number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    return Math.floor(parsed);
  }

  // Tokens times a weight, rounded up to a whole token, in whole numbers.
  private static weigh(tokens: number, weight: AiTokenWeight): number {
    if (tokens <= 0) {
      return 0;
    }

    return Math.ceil((tokens * weight.numerator) / weight.denominator);
  }
}
