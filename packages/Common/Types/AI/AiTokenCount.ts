import { LlmCostCatalogUtil, LlmModelPrice } from "../Telemetry/LlmCostCatalog";

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
 * investigation or chat, sent again with the conversation - costs a fraction
 * of a fresh one, and a token written to the cache can cost more than one.
 * Without the cache an agent loop pays for its whole conversation again on
 * every call, so counting every cached token as a fresh one made AI work
 * count several times what it cost - and the more OneUptime caches, the
 * further apart the two would grow.
 *
 * What a cached token costs depends on the model, so it counts at the
 * model's own prices (getCacheWeights): what the provider charges for a
 * token read from or written to its cache, next to what it charges for a
 * fresh one, as the cost catalog of AI / LLM observability lists them
 * (Types/Telemetry/LlmCostCatalog) - a tenth for a read on Claude and on
 * OpenAI's current models, a twentieth on Claude Opus 5.5, a quarter on
 * gpt-4.1, half on gpt-4o; one and a quarter for a write to Anthropic's
 * 5-minute cache and to OpenAI's on GPT-5.6 and later, one (no charge of its
 * own) on OpenAI's earlier models. A model the catalog lists no cache price
 * for - one it does not know, a deployment name that does not say which
 * model it is, an entry without cache prices - counts a read as a tenth and
 * a write as one and a quarter, as every model counted before.
 *
 * The providers report cached tokens two ways, and both are counted alike:
 *
 *  - The OpenAI wire (OpenAI, Azure OpenAI, Groq, Mistral, OpenAI-compatible
 *    servers) counts them inside prompt_tokens, and reports how many were
 *    read in prompt_tokens_details.cached_tokens and how many were written
 *    in prompt_tokens_details.cache_write_tokens (GPT-5.6 and later charge
 *    for writes; earlier models report none).
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

/*
 * A token read from the provider's prompt cache counts as a tenth of a
 * token, for a model the cost catalog lists no cache price for.
 */
export const CACHE_READ_TOKEN_WEIGHT: AiTokenWeight = {
  numerator: 1,
  denominator: 10,
};

/*
 * A token written to the provider's prompt cache counts as one and a
 * quarter, for a model the cost catalog lists no cache price for.
 */
export const CACHE_WRITE_TOKEN_WEIGHT: AiTokenWeight = {
  numerator: 5,
  denominator: 4,
};

// A token that counts for exactly what a fresh one does.
export const FRESH_TOKEN_WEIGHT: AiTokenWeight = {
  numerator: 1,
  denominator: 1,
};

/*
 * A model's weights are its prices to a millionth of a token: finer than any
 * price list is written, and whole numbers either way.
 */
const MODEL_WEIGHT_DENOMINATOR: number = 1_000_000;

// What a model's cached tokens count as.
export interface AiTokenCacheWeights {
  read: AiTokenWeight;
  write: AiTokenWeight;
  /*
   * Whether the weights are the model's own prices (the cost catalog lists
   * a cache price for it), or the counts of a model it lists none for.
   */
  isModelPriced: boolean;
}

export const DEFAULT_CACHE_TOKEN_WEIGHTS: AiTokenCacheWeights = {
  read: CACHE_READ_TOKEN_WEIGHT,
  write: CACHE_WRITE_TOKEN_WEIGHT,
  isModelPriced: false,
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
  /*
   * The model the call asked for (LlmLog.modelName), whose prices weigh its
   * cached tokens. Absent: the counts of a model with no cache price.
   */
  modelName?: string | null | undefined;
}

// A sum of calls of one model: every part added up.
export interface AiTokenUsageSum {
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  // The calls' model, or null for calls that named none.
  modelName: string | null;
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
  // The weights the cached tokens were counted with.
  cacheWeights: AiTokenCacheWeights;
}

export default class AiTokenCount {
  /*
   * What a call - or a sum of calls of one model - counts as: its fresh
   * tokens, and the tokens read from and written to the prompt cache at the
   * model's weights, each weighted part rounded up to a whole token.
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

    const cacheWeights: AiTokenCacheWeights = this.getCacheWeights(
      usage.modelName,
    );

    const countedCacheReadTokens: number = this.weigh(
      cacheReadTokens,
      cacheWeights.read,
    );
    const countedCacheWriteTokens: number = this.weigh(
      cacheWriteTokens,
      cacheWeights.write,
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
      cacheWeights,
    };
  }

  /*
   * What a model's cached tokens count as: the price its provider charges
   * for a token read from, and one written to, its prompt cache, over the
   * price of a fresh input token - the model's list prices in the cost
   * catalog, at their standard tier (every long-prompt tier keeps the same
   * shares). A model the catalog has no cache price for counts them as a
   * tenth and one and a quarter; a model it has a read price but no write
   * price for is not charged extra for a write, which counts as one.
   */
  public static getCacheWeights(
    modelName: string | null | undefined,
  ): AiTokenCacheWeights {
    const name: string = typeof modelName === "string" ? modelName.trim() : "";

    if (!name) {
      return DEFAULT_CACHE_TOKEN_WEIGHTS;
    }

    const price: LlmModelPrice | null =
      LlmCostCatalogUtil.findPriceForModel(name);

    if (
      !price ||
      !this.isPrice(price.inputPricePerMillionTokensInUSD) ||
      price.inputPricePerMillionTokensInUSD <= 0 ||
      !this.isPrice(price.cacheReadPricePerMillionTokensInUSD)
    ) {
      return DEFAULT_CACHE_TOKEN_WEIGHTS;
    }

    const inputPrice: number = price.inputPricePerMillionTokensInUSD;

    return {
      read: this.toWeight(
        price.cacheReadPricePerMillionTokensInUSD,
        inputPrice,
      ),
      write: this.isPrice(price.cacheWritePricePerMillionTokensInUSD)
        ? this.toWeight(price.cacheWritePricePerMillionTokensInUSD, inputPrice)
        : FRESH_TOKEN_WEIGHT,
      isModelPriced: true,
    };
  }

  /*
   * The tokens of several calls added up, part by part, one sum for each
   * model - what a day of AI Logs rows sums to before it is counted, in the
   * order each model first appears.
   */
  public static sumByModel(
    usages: Array<AiTokenUsage>,
  ): Array<AiTokenUsageSum> {
    const sums: Map<string, AiTokenUsageSum> = new Map();

    for (const usage of usages) {
      const modelName: string | null = this.toModelName(usage.modelName);
      const key: string = modelName === null ? "" : `model:${modelName}`;

      let sum: AiTokenUsageSum | undefined = sums.get(key);

      if (!sum) {
        sum = {
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          modelName,
        };
        sums.set(key, sum);
      }

      sum.totalTokens += this.toTokenCount(usage.totalTokens);
      sum.cachedInputTokens += this.toTokenCount(usage.cachedInputTokens);
      sum.cacheCreationTokens += this.toTokenCount(usage.cacheCreationTokens);
    }

    return Array.from(sums.values());
  }

  /*
   * What several calls count as together: each model's sum counted at that
   * model's weights, and the counts added up. A model's weighted parts are
   * rounded up once for all its calls, where the AI Logs round each call's,
   * so the sum can count a token or so per call less than its rows add up to.
   */
  public static countAll(usages: Array<AiTokenUsage>): number {
    return this.sumByModel(usages).reduce(
      (total: number, sum: AiTokenUsageSum): number => {
        return total + this.count(sum);
      },
      0,
    );
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

  // A model's name as a sum keeps it: trimmed, or null when it names none.
  private static toModelName(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed: string = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private static isPrice(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  // A price over the input price, as a whole-number fraction in lowest terms.
  private static toWeight(price: number, inputPrice: number): AiTokenWeight {
    const numerator: number = Math.round(
      (price / inputPrice) * MODEL_WEIGHT_DENOMINATOR,
    );

    if (numerator <= 0) {
      return { numerator: 0, denominator: 1 };
    }

    const divisor: number = this.greatestCommonDivisor(
      numerator,
      MODEL_WEIGHT_DENOMINATOR,
    );

    return {
      numerator: numerator / divisor,
      denominator: MODEL_WEIGHT_DENOMINATOR / divisor,
    };
  }

  private static greatestCommonDivisor(a: number, b: number): number {
    let x: number = a;
    let y: number = b;

    while (y !== 0) {
      const rest: number = x % y;
      x = y;
      y = rest;
    }

    return x;
  }

  // Tokens times a weight, rounded up to a whole token, in whole numbers.
  private static weigh(tokens: number, weight: AiTokenWeight): number {
    if (tokens <= 0 || weight.numerator <= 0) {
      return 0;
    }

    return Math.ceil((tokens * weight.numerator) / weight.denominator);
  }
}
