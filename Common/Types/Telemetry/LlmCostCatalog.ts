/*
 * Built-in list-price catalog for computing LLM call cost from token counts.
 *
 * OneUptime prefers the cost the instrumentation reports (gen_ai.usage.cost)
 * — a vendor-negotiated or gateway-computed number is always more accurate
 * than a list price. This catalog is the fallback: when a span carries token
 * counts but no reported cost, the ingest pipeline computes an estimated cost
 * from these rates so token spend is visible in dashboards and enforceable by
 * cost budgets without requiring every SDK to do pricing math.
 *
 * Rates are USD per one million tokens, taken from the providers' public
 * pricing pages. They are list prices: they ignore prompt-cache discounts,
 * batch pricing, and negotiated rates, and they go stale as vendors reprice —
 * update them here, once, like Common/Types/Billing/PayAsYouGoPricing.ts.
 * Matching is by normalized model-name prefix with the LONGEST prefix winning,
 * so "gpt-4o-mini-2024-07-18" resolves to the gpt-4o-mini entry, not gpt-4o.
 */

export interface LlmModelPrice {
  // Normalized (lowercase) model-name prefix this entry matches.
  modelPrefix: string;
  inputPricePerMillionTokensInUSD: number;
  outputPricePerMillionTokensInUSD: number;
}

export const LlmModelPricingCatalog: Array<LlmModelPrice> = [
  // ---- OpenAI ----
  {
    modelPrefix: "gpt-5-nano",
    inputPricePerMillionTokensInUSD: 0.05,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gpt-5-mini",
    inputPricePerMillionTokensInUSD: 0.25,
    outputPricePerMillionTokensInUSD: 2,
  },
  {
    modelPrefix: "gpt-5",
    inputPricePerMillionTokensInUSD: 1.25,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "gpt-4.1-nano",
    inputPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gpt-4.1-mini",
    inputPricePerMillionTokensInUSD: 0.4,
    outputPricePerMillionTokensInUSD: 1.6,
  },
  {
    modelPrefix: "gpt-4.1",
    inputPricePerMillionTokensInUSD: 2,
    outputPricePerMillionTokensInUSD: 8,
  },
  {
    modelPrefix: "gpt-4o-mini",
    inputPricePerMillionTokensInUSD: 0.15,
    outputPricePerMillionTokensInUSD: 0.6,
  },
  {
    modelPrefix: "gpt-4o",
    inputPricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "gpt-4-turbo",
    inputPricePerMillionTokensInUSD: 10,
    outputPricePerMillionTokensInUSD: 30,
  },
  {
    modelPrefix: "gpt-4",
    inputPricePerMillionTokensInUSD: 30,
    outputPricePerMillionTokensInUSD: 60,
  },
  {
    modelPrefix: "gpt-3.5-turbo",
    inputPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 1.5,
  },
  {
    modelPrefix: "o3-pro",
    inputPricePerMillionTokensInUSD: 20,
    outputPricePerMillionTokensInUSD: 80,
  },
  {
    modelPrefix: "o3-mini",
    inputPricePerMillionTokensInUSD: 1.1,
    outputPricePerMillionTokensInUSD: 4.4,
  },
  {
    modelPrefix: "o3",
    inputPricePerMillionTokensInUSD: 2,
    outputPricePerMillionTokensInUSD: 8,
  },
  {
    modelPrefix: "o4-mini",
    inputPricePerMillionTokensInUSD: 1.1,
    outputPricePerMillionTokensInUSD: 4.4,
  },
  {
    modelPrefix: "o1-mini",
    inputPricePerMillionTokensInUSD: 1.1,
    outputPricePerMillionTokensInUSD: 4.4,
  },
  {
    // Priced 10x above bare o1 — must never fall through to that prefix.
    modelPrefix: "o1-pro",
    inputPricePerMillionTokensInUSD: 150,
    outputPricePerMillionTokensInUSD: 600,
  },
  {
    modelPrefix: "o1",
    inputPricePerMillionTokensInUSD: 15,
    outputPricePerMillionTokensInUSD: 60,
  },
  {
    modelPrefix: "text-embedding-3-small",
    inputPricePerMillionTokensInUSD: 0.02,
    outputPricePerMillionTokensInUSD: 0,
  },
  {
    modelPrefix: "text-embedding-3-large",
    inputPricePerMillionTokensInUSD: 0.13,
    outputPricePerMillionTokensInUSD: 0,
  },
  {
    modelPrefix: "text-embedding-ada-002",
    inputPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 0,
  },

  // ---- Anthropic ----
  {
    modelPrefix: "claude-opus-4",
    inputPricePerMillionTokensInUSD: 15,
    outputPricePerMillionTokensInUSD: 75,
  },
  {
    modelPrefix: "claude-sonnet-4",
    inputPricePerMillionTokensInUSD: 3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "claude-haiku-4",
    inputPricePerMillionTokensInUSD: 1,
    outputPricePerMillionTokensInUSD: 5,
  },
  {
    modelPrefix: "claude-3-7-sonnet",
    inputPricePerMillionTokensInUSD: 3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "claude-3-5-sonnet",
    inputPricePerMillionTokensInUSD: 3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "claude-3-5-haiku",
    inputPricePerMillionTokensInUSD: 0.8,
    outputPricePerMillionTokensInUSD: 4,
  },
  {
    modelPrefix: "claude-3-opus",
    inputPricePerMillionTokensInUSD: 15,
    outputPricePerMillionTokensInUSD: 75,
  },
  {
    modelPrefix: "claude-3-haiku",
    inputPricePerMillionTokensInUSD: 0.25,
    outputPricePerMillionTokensInUSD: 1.25,
  },

  // ---- Google Gemini ----
  {
    modelPrefix: "gemini-2.5-pro",
    inputPricePerMillionTokensInUSD: 1.25,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "gemini-2.5-flash-lite",
    inputPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gemini-2.5-flash",
    inputPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 2.5,
  },
  {
    modelPrefix: "gemini-2.0-flash-lite",
    inputPricePerMillionTokensInUSD: 0.075,
    outputPricePerMillionTokensInUSD: 0.3,
  },
  {
    modelPrefix: "gemini-2.0-flash",
    inputPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gemini-1.5-pro",
    inputPricePerMillionTokensInUSD: 1.25,
    outputPricePerMillionTokensInUSD: 5,
  },
  {
    modelPrefix: "gemini-1.5-flash",
    inputPricePerMillionTokensInUSD: 0.075,
    outputPricePerMillionTokensInUSD: 0.3,
  },

  // ---- Mistral ----
  {
    modelPrefix: "mistral-large",
    inputPricePerMillionTokensInUSD: 2,
    outputPricePerMillionTokensInUSD: 6,
  },
  {
    modelPrefix: "mistral-medium",
    inputPricePerMillionTokensInUSD: 0.4,
    outputPricePerMillionTokensInUSD: 2,
  },
  {
    modelPrefix: "mistral-small",
    inputPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 0.3,
  },
  {
    modelPrefix: "codestral",
    inputPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 0.9,
  },

  // ---- DeepSeek ----
  {
    modelPrefix: "deepseek-chat",
    inputPricePerMillionTokensInUSD: 0.27,
    outputPricePerMillionTokensInUSD: 1.1,
  },
  {
    modelPrefix: "deepseek-reasoner",
    inputPricePerMillionTokensInUSD: 0.55,
    outputPricePerMillionTokensInUSD: 2.19,
  },

  // ---- xAI ----
  {
    modelPrefix: "grok-4",
    inputPricePerMillionTokensInUSD: 3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "grok-3-mini",
    inputPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 0.5,
  },
  {
    modelPrefix: "grok-3",
    inputPricePerMillionTokensInUSD: 3,
    outputPricePerMillionTokensInUSD: 15,
  },

  // ---- Cohere ----
  {
    modelPrefix: "command-r-plus",
    inputPricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "command-r",
    inputPricePerMillionTokensInUSD: 0.15,
    outputPricePerMillionTokensInUSD: 0.6,
  },
  {
    modelPrefix: "command-a",
    inputPricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
  },

  // ---- Amazon Nova ----
  {
    modelPrefix: "nova-micro",
    inputPricePerMillionTokensInUSD: 0.035,
    outputPricePerMillionTokensInUSD: 0.14,
  },
  {
    modelPrefix: "nova-lite",
    inputPricePerMillionTokensInUSD: 0.06,
    outputPricePerMillionTokensInUSD: 0.24,
  },
  {
    modelPrefix: "nova-pro",
    inputPricePerMillionTokensInUSD: 0.8,
    outputPricePerMillionTokensInUSD: 3.2,
  },

  // ---- Meta Llama (typical hosted per-token rates) ----
  {
    modelPrefix: "llama-3.3-70b",
    inputPricePerMillionTokensInUSD: 0.72,
    outputPricePerMillionTokensInUSD: 0.72,
  },
  {
    modelPrefix: "llama-3.1-405b",
    inputPricePerMillionTokensInUSD: 2.4,
    outputPricePerMillionTokensInUSD: 2.4,
  },
  {
    modelPrefix: "llama-3.1-70b",
    inputPricePerMillionTokensInUSD: 0.72,
    outputPricePerMillionTokensInUSD: 0.72,
  },
  {
    modelPrefix: "llama-3.1-8b",
    inputPricePerMillionTokensInUSD: 0.22,
    outputPricePerMillionTokensInUSD: 0.22,
  },
];

/*
 * Leading tokens that carry deployment routing, not model identity. Bedrock
 * model ids look like "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
 * OpenRouter-style ids like "anthropic/claude-3-5-sonnet", Google's like
 * "models/gemini-2.5-pro" — all of them must resolve to the same catalog
 * entry as the bare model name.
 */
const RoutingPrefixTokens: Array<string> = [
  // Bedrock cross-region inference profiles.
  "us",
  "eu",
  "apac",
  "global",
  // Provider namespaces.
  "anthropic",
  "openai",
  "google",
  "meta",
  "amazon",
  "mistral",
  "mistralai",
  "cohere",
  "ai21",
  "deepseek",
  "xai",
  "azure",
  "models",
];

export class LlmCostCatalogUtil {
  /**
   * Find the price entry for a (possibly vendor-decorated) model name.
   * Returns null when the model is unknown — callers must not guess a price.
   *
   * `projectPriceOverrides` are per-project custom prices (negotiated rates,
   * self-hosted models, fine-tunes) consulted alongside the built-in catalog.
   * The longest matching prefix wins across BOTH lists; on a prefix-length
   * tie the project entry beats the built-in one.
   */
  public static findPriceForModel(
    model: string,
    projectPriceOverrides?: Array<LlmModelPrice>,
  ): LlmModelPrice | null {
    const candidates: Array<string> = this.normalizedCandidates(model);

    const overrides: Array<LlmModelPrice> = this.sanitizeOverrides(
      projectPriceOverrides,
    );

    let best: LlmModelPrice | null = null;
    let bestIsProjectOverride: boolean = false;

    for (const candidate of candidates) {
      for (const entry of overrides) {
        if (!candidate.startsWith(entry.modelPrefix)) {
          continue;
        }

        if (
          !best ||
          entry.modelPrefix.length > best.modelPrefix.length ||
          (entry.modelPrefix.length === best.modelPrefix.length &&
            !bestIsProjectOverride)
        ) {
          best = entry;
          bestIsProjectOverride = true;
        }
      }

      for (const entry of LlmModelPricingCatalog) {
        if (!candidate.startsWith(entry.modelPrefix)) {
          continue;
        }

        // Strictly longer only — an equal-length project entry keeps winning.
        if (!best || entry.modelPrefix.length > best.modelPrefix.length) {
          best = entry;
          bestIsProjectOverride = false;
        }
      }
    }

    return best;
  }

  /*
   * Normalize project override entries the same way catalog prefixes are
   * stored (trimmed, lowercase) and drop unpriceable rows — user-authored
   * data must never break span ingest or price a call negatively.
   */
  private static sanitizeOverrides(
    projectPriceOverrides?: Array<LlmModelPrice>,
  ): Array<LlmModelPrice> {
    if (!projectPriceOverrides || projectPriceOverrides.length === 0) {
      return [];
    }

    const sanitized: Array<LlmModelPrice> = [];

    for (const entry of projectPriceOverrides) {
      if (!entry || typeof entry.modelPrefix !== "string") {
        continue;
      }

      const modelPrefix: string = entry.modelPrefix.trim().toLowerCase();

      const inputPrice: number = entry.inputPricePerMillionTokensInUSD;
      const outputPrice: number = entry.outputPricePerMillionTokensInUSD;

      if (
        !modelPrefix ||
        typeof inputPrice !== "number" ||
        !isFinite(inputPrice) ||
        inputPrice < 0 ||
        typeof outputPrice !== "number" ||
        !isFinite(outputPrice) ||
        outputPrice < 0
      ) {
        continue;
      }

      if (modelPrefix === entry.modelPrefix) {
        sanitized.push(entry);
      } else {
        sanitized.push({
          modelPrefix: modelPrefix,
          inputPricePerMillionTokensInUSD: inputPrice,
          outputPricePerMillionTokensInUSD: outputPrice,
        });
      }
    }

    return sanitized;
  }

  /**
   * Compute the estimated USD cost of a call from its token counts, or null
   * when the model is unknown or there are no tokens to price. Never guesses:
   * an unknown model yields null, not zero, so the caller can distinguish
   * "free" from "unpriceable".
   */
  public static computeCostInUSD(data: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    projectPriceOverrides?: Array<LlmModelPrice> | undefined;
  }): number | null {
    const inputTokens: number =
      isFinite(data.inputTokens) && data.inputTokens > 0 ? data.inputTokens : 0;
    const outputTokens: number =
      isFinite(data.outputTokens) && data.outputTokens > 0
        ? data.outputTokens
        : 0;

    if (inputTokens === 0 && outputTokens === 0) {
      return null;
    }

    const price: LlmModelPrice | null = this.findPriceForModel(
      data.model,
      data.projectPriceOverrides,
    );

    if (!price) {
      return null;
    }

    const cost: number =
      (inputTokens * price.inputPricePerMillionTokensInUSD) / 1_000_000 +
      (outputTokens * price.outputPricePerMillionTokensInUSD) / 1_000_000;

    /*
     * Trim float noise (e.g. 0.30000000000000004) — 8 decimal places is
     * sub-hundredth-of-a-cent resolution, far below list-price accuracy.
     */
    return Math.round(cost * 1e8) / 1e8;
  }

  /**
   * Expand a raw model string into normalized lookup candidates, most-specific
   * first: the full lowercase name, then the name with routing/provider
   * prefixes (path segments, dotted namespaces, region tokens) stripped away.
   */
  private static normalizedCandidates(model: string): Array<string> {
    if (!model || typeof model !== "string") {
      return [];
    }

    const normalized: string = model.trim().toLowerCase();

    if (!normalized) {
      return [];
    }

    const candidates: Array<string> = [normalized];

    // "anthropic/claude-3-5-sonnet" or "models/gemini-2.5-pro" → last segment.
    const lastSlashSegment: string = normalized.split("/").pop() || "";

    if (lastSlashSegment && !candidates.includes(lastSlashSegment)) {
      candidates.push(lastSlashSegment);
    }

    /*
     * "us.anthropic.claude-3-5-sonnet-20241022-v2:0" → progressively strip
     * leading routing tokens ("us", "anthropic") that sit before the model
     * name. Only recognized routing tokens are stripped, so a model whose name
     * legitimately contains a dot (gpt-4.1, gemini-2.5-pro) is untouched.
     */
    for (const base of [...candidates]) {
      let remainder: string = base;

      for (;;) {
        const dotIndex: number = remainder.indexOf(".");

        if (dotIndex <= 0) {
          break;
        }

        const leadingToken: string = remainder.substring(0, dotIndex);

        if (!RoutingPrefixTokens.includes(leadingToken)) {
          break;
        }

        remainder = remainder.substring(dotIndex + 1);

        if (remainder && !candidates.includes(remainder)) {
          candidates.push(remainder);
        }
      }
    }

    return candidates;
  }
}
