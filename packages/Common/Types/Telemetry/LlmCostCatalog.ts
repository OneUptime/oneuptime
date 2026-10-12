import ClaudeModelId from "../../Utils/LLM/ClaudeModelId";

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
 * Rates are USD per one million tokens, copied from each provider's own
 * pricing page (the page heads its section below). They are the list prices
 * of the provider's own API: no batch or flex discount, no fast or priority
 * mode, no regional or data-residency premium, no negotiated rate. Where a
 * provider prices prompt-cache reads and writes, the entry carries them
 * (Anthropic's cache writes at the default 5-minute rate), and a model whose
 * price rises past a prompt length carries that tier too. Prices go stale as
 * vendors reprice — update them here, once, like
 * Common/Types/Billing/PayAsYouGoPricing.ts. The test
 * Tests/Types/Telemetry/LlmCostCatalog.test.ts pins every Anthropic price to
 * the official table it was copied from.
 *
 * Matching (findPriceForModel):
 *
 *  - An id is normalized first: lowercased; a provider path, routing
 *    namespace or cross-region prefix dropped (anthropic/claude-...,
 *    models/gemini-..., us.anthropic.claude-...); and a Claude id read by
 *    ClaudeModelId into the form Anthropic's API writes, so every shape of
 *    a Claude model (dated, Bedrock, Google Cloud's "@", OpenRouter's dot)
 *    finds that model's one entry.
 *  - A built-in entry matches an id that starts with its prefix at a word
 *    boundary, and never where the id goes on to a LATER VERSION of the
 *    model the entry names: claude-opus-4 is Claude Opus 4 (and
 *    claude-opus-4-20250514, claude-opus-4-0), never Opus 4.5; gpt-5 is never
 *    gpt-5.2; grok-4 is never grok-4.7. A model the list does not know, a
 *    newer release included, gets no price rather than an older model's: the
 *    caller stores 0 until someone prices it.
 *  - The longest matching prefix wins, so gpt-4o-mini-2024-07-18 resolves to
 *    the gpt-4o-mini entry, not gpt-4o.
 *  - A project's own prices (LlmModelPrice) match as plain prefixes, exactly
 *    as written, and take part in the same longest-prefix contest; a project
 *    price beats a built-in one of the same length.
 */

export interface LlmModelPrice {
  // Normalized (lowercase) model-name prefix this entry matches.
  modelPrefix: string;
  inputPricePerMillionTokensInUSD: number;
  outputPricePerMillionTokensInUSD: number;
  /*
   * Input tokens read from the provider's prompt cache. Absent: they cost
   * what any other input token costs (a project's own price never has one).
   */
  cacheReadPricePerMillionTokensInUSD?: number | undefined;
  /*
   * Input tokens written to the provider's prompt cache (Anthropic: the
   * default 5-minute cache). Absent: the input price.
   */
  cacheWritePricePerMillionTokensInUSD?: number | undefined;
  /*
   * What a call pays when its prompt is long: Claude Haiku 5.5 past 100,000
   * prompt tokens, OpenAI's long-context models past 272K. Absent: one price
   * for every prompt length.
   */
  longPrompt?: LlmLongPromptPrice | undefined;
}

export interface LlmLongPromptPrice {
  /*
   * The first prompt length, in tokens, that pays these prices. A prompt
   * counts every input token, cached ones included, as every provider here
   * counts it. Inclusive: a provider that charges prompts OVER 100,000
   * tokens starts its tier at 100,001.
   */
  fromPromptTokens: number;
  inputPricePerMillionTokensInUSD: number;
  outputPricePerMillionTokensInUSD: number;
  cacheReadPricePerMillionTokensInUSD?: number | undefined;
  cacheWritePricePerMillionTokensInUSD?: number | undefined;
}

// The prices one call pays: a model's price, at the call's prompt length.
export interface LlmCallPrices {
  inputPricePerMillionTokensInUSD: number;
  outputPricePerMillionTokensInUSD: number;
  cacheReadPricePerMillionTokensInUSD: number;
  cacheWritePricePerMillionTokensInUSD: number;
}

export const LlmModelPricingCatalog: Array<LlmModelPrice> = [
  // ---- OpenAI ----
  /*
   * https://developers.openai.com/api/docs/pricing (Standard): the
   * "Flagship models" table, the Codex, ChatGPT and cyber text models, the
   * life-sciences models and the embeddings. "Long context" is a prompt over
   * 272K input tokens. o1-mini is no longer on the page and keeps its last
   * list price. Realtime, audio, image and transcription models are priced
   * per modality and are not here.
   */
  {
    modelPrefix: "gpt-6-astra",
    inputPricePerMillionTokensInUSD: 10,
    cacheReadPricePerMillionTokensInUSD: 1,
    cacheWritePricePerMillionTokensInUSD: 12.5,
    outputPricePerMillionTokensInUSD: 50,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 20,
      cacheReadPricePerMillionTokensInUSD: 2,
      cacheWritePricePerMillionTokensInUSD: 25,
      outputPricePerMillionTokensInUSD: 75,
    },
  },
  {
    modelPrefix: "gpt-6.1-sol",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.1,
    cacheWritePricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 4,
      cacheReadPricePerMillionTokensInUSD: 0.2,
      cacheWritePricePerMillionTokensInUSD: 5,
      outputPricePerMillionTokensInUSD: 15,
    },
  },
  {
    modelPrefix: "gpt-6-sol",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    cacheWritePricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 4,
      cacheReadPricePerMillionTokensInUSD: 0.4,
      cacheWritePricePerMillionTokensInUSD: 5,
      outputPricePerMillionTokensInUSD: 15,
    },
  },
  {
    modelPrefix: "gpt-6-luna",
    inputPricePerMillionTokensInUSD: 0.1,
    cacheReadPricePerMillionTokensInUSD: 0.01,
    cacheWritePricePerMillionTokensInUSD: 0.125,
    outputPricePerMillionTokensInUSD: 0.5,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 0.2,
      cacheReadPricePerMillionTokensInUSD: 0.02,
      cacheWritePricePerMillionTokensInUSD: 0.25,
      outputPricePerMillionTokensInUSD: 0.75,
    },
  },
  {
    modelPrefix: "gpt-5.6-sol",
    inputPricePerMillionTokensInUSD: 4,
    cacheReadPricePerMillionTokensInUSD: 0.4,
    cacheWritePricePerMillionTokensInUSD: 5,
    outputPricePerMillionTokensInUSD: 20,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 8,
      cacheReadPricePerMillionTokensInUSD: 0.8,
      cacheWritePricePerMillionTokensInUSD: 10,
      outputPricePerMillionTokensInUSD: 30,
    },
  },
  {
    modelPrefix: "gpt-5.6-terra",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    cacheWritePricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 12,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 4,
      cacheReadPricePerMillionTokensInUSD: 0.4,
      cacheWritePricePerMillionTokensInUSD: 5,
      outputPricePerMillionTokensInUSD: 18,
    },
  },
  {
    modelPrefix: "gpt-5.6-luna",
    inputPricePerMillionTokensInUSD: 0.2,
    cacheReadPricePerMillionTokensInUSD: 0.02,
    cacheWritePricePerMillionTokensInUSD: 0.25,
    outputPricePerMillionTokensInUSD: 1.2,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 0.4,
      cacheReadPricePerMillionTokensInUSD: 0.04,
      cacheWritePricePerMillionTokensInUSD: 0.5,
      outputPricePerMillionTokensInUSD: 1.8,
    },
  },
  {
    modelPrefix: "gpt-5.6-cyber",
    inputPricePerMillionTokensInUSD: 12.5,
    cacheReadPricePerMillionTokensInUSD: 1.25,
    cacheWritePricePerMillionTokensInUSD: 15.625,
    outputPricePerMillionTokensInUSD: 75,
  },
  {
    modelPrefix: "gpt-5.5",
    inputPricePerMillionTokensInUSD: 5,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 30,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 10,
      cacheReadPricePerMillionTokensInUSD: 1,
      outputPricePerMillionTokensInUSD: 45,
    },
  },
  {
    modelPrefix: "gpt-5.5-pro",
    inputPricePerMillionTokensInUSD: 30,
    outputPricePerMillionTokensInUSD: 180,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 60,
      outputPricePerMillionTokensInUSD: 270,
    },
  },
  {
    modelPrefix: "gpt-5.5-cyber",
    inputPricePerMillionTokensInUSD: 12.5,
    cacheReadPricePerMillionTokensInUSD: 1.25,
    outputPricePerMillionTokensInUSD: 75,
  },
  {
    modelPrefix: "gpt-5.4",
    inputPricePerMillionTokensInUSD: 2.5,
    cacheReadPricePerMillionTokensInUSD: 0.25,
    outputPricePerMillionTokensInUSD: 15,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 5,
      cacheReadPricePerMillionTokensInUSD: 0.5,
      outputPricePerMillionTokensInUSD: 22.5,
    },
  },
  {
    modelPrefix: "gpt-5.4-pro",
    inputPricePerMillionTokensInUSD: 30,
    outputPricePerMillionTokensInUSD: 180,
    longPrompt: {
      fromPromptTokens: 272_001,
      inputPricePerMillionTokensInUSD: 60,
      outputPricePerMillionTokensInUSD: 270,
    },
  },
  {
    modelPrefix: "gpt-5.4-mini",
    inputPricePerMillionTokensInUSD: 0.75,
    cacheReadPricePerMillionTokensInUSD: 0.075,
    outputPricePerMillionTokensInUSD: 4.5,
  },
  {
    modelPrefix: "gpt-5.4-nano",
    inputPricePerMillionTokensInUSD: 0.2,
    cacheReadPricePerMillionTokensInUSD: 0.02,
    outputPricePerMillionTokensInUSD: 1.25,
  },
  {
    modelPrefix: "gpt-5.3-codex",
    inputPricePerMillionTokensInUSD: 1.75,
    cacheReadPricePerMillionTokensInUSD: 0.175,
    outputPricePerMillionTokensInUSD: 14,
  },
  {
    modelPrefix: "gpt-5.2",
    inputPricePerMillionTokensInUSD: 1.75,
    cacheReadPricePerMillionTokensInUSD: 0.175,
    outputPricePerMillionTokensInUSD: 14,
  },
  {
    modelPrefix: "gpt-5.2-pro",
    inputPricePerMillionTokensInUSD: 21,
    outputPricePerMillionTokensInUSD: 168,
  },
  {
    modelPrefix: "gpt-5.1",
    inputPricePerMillionTokensInUSD: 1.25,
    cacheReadPricePerMillionTokensInUSD: 0.125,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "gpt-5-pro",
    inputPricePerMillionTokensInUSD: 15,
    outputPricePerMillionTokensInUSD: 120,
  },
  {
    modelPrefix: "gpt-5-nano",
    inputPricePerMillionTokensInUSD: 0.05,
    cacheReadPricePerMillionTokensInUSD: 0.005,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gpt-5-mini",
    inputPricePerMillionTokensInUSD: 0.25,
    cacheReadPricePerMillionTokensInUSD: 0.025,
    outputPricePerMillionTokensInUSD: 2,
  },
  {
    modelPrefix: "gpt-5",
    inputPricePerMillionTokensInUSD: 1.25,
    cacheReadPricePerMillionTokensInUSD: 0.125,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "gpt-4.1-nano",
    inputPricePerMillionTokensInUSD: 0.1,
    cacheReadPricePerMillionTokensInUSD: 0.025,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gpt-4.1-mini",
    inputPricePerMillionTokensInUSD: 0.4,
    cacheReadPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 1.6,
  },
  {
    modelPrefix: "gpt-4.1",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 8,
  },
  {
    modelPrefix: "gpt-4o-mini",
    inputPricePerMillionTokensInUSD: 0.15,
    cacheReadPricePerMillionTokensInUSD: 0.075,
    outputPricePerMillionTokensInUSD: 0.6,
  },
  {
    // The first gpt-4o snapshot kept its launch price.
    modelPrefix: "gpt-4o-2024-05-13",
    inputPricePerMillionTokensInUSD: 5,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "gpt-4o",
    inputPricePerMillionTokensInUSD: 2.5,
    cacheReadPricePerMillionTokensInUSD: 1.25,
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
    modelPrefix: "gpt-3.5-turbo-instruct",
    inputPricePerMillionTokensInUSD: 1.5,
    outputPricePerMillionTokensInUSD: 2,
  },
  {
    modelPrefix: "gpt-3.5-turbo-1106",
    inputPricePerMillionTokensInUSD: 1,
    outputPricePerMillionTokensInUSD: 2,
  },
  {
    modelPrefix: "gpt-3.5-turbo",
    inputPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 1.5,
  },
  {
    modelPrefix: "davinci-002",
    inputPricePerMillionTokensInUSD: 2,
    outputPricePerMillionTokensInUSD: 2,
  },
  {
    modelPrefix: "babbage-002",
    inputPricePerMillionTokensInUSD: 0.4,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "chat-latest",
    inputPricePerMillionTokensInUSD: 5,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 30,
  },
  {
    modelPrefix: "gpt-rosalind-research",
    inputPricePerMillionTokensInUSD: 5,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "gpt-rosalind-discovery",
    inputPricePerMillionTokensInUSD: 5,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "o3-pro",
    inputPricePerMillionTokensInUSD: 20,
    outputPricePerMillionTokensInUSD: 80,
  },
  {
    modelPrefix: "o3-mini",
    inputPricePerMillionTokensInUSD: 1.1,
    cacheReadPricePerMillionTokensInUSD: 0.55,
    outputPricePerMillionTokensInUSD: 4.4,
  },
  {
    modelPrefix: "o3",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 8,
  },
  {
    modelPrefix: "o4-mini",
    inputPricePerMillionTokensInUSD: 1.1,
    cacheReadPricePerMillionTokensInUSD: 0.275,
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
    cacheReadPricePerMillionTokensInUSD: 7.5,
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
  /*
   * https://platform.claude.com/docs/en/about-claude/pricing: every model of
   * its "Model pricing" table, one entry per model version, with its 5-minute
   * cache write and its cache hit. Claude Haiku 5.5 charges more for a
   * prompt over 100,000 tokens. Claude on Microsoft Foundry and Claude
   * Platform on AWS bill these same rates; Amazon Bedrock and Google Cloud
   * set their own, the same on their global endpoints. Claude 3.7 Sonnet,
   * 3.5 Sonnet, 3 Opus and 3 Haiku are retired and no longer on the page:
   * they keep their last list price.
   */
  {
    modelPrefix: "claude-fable-5-1",
    inputPricePerMillionTokensInUSD: 10,
    cacheWritePricePerMillionTokensInUSD: 12.5,
    cacheReadPricePerMillionTokensInUSD: 0.25,
    outputPricePerMillionTokensInUSD: 50,
  },
  {
    modelPrefix: "claude-mythos-5-1",
    inputPricePerMillionTokensInUSD: 10,
    cacheWritePricePerMillionTokensInUSD: 12.5,
    cacheReadPricePerMillionTokensInUSD: 0.25,
    outputPricePerMillionTokensInUSD: 50,
  },
  {
    modelPrefix: "claude-fable-5",
    inputPricePerMillionTokensInUSD: 10,
    cacheWritePricePerMillionTokensInUSD: 12.5,
    cacheReadPricePerMillionTokensInUSD: 1,
    outputPricePerMillionTokensInUSD: 50,
  },
  {
    modelPrefix: "claude-mythos-5",
    inputPricePerMillionTokensInUSD: 10,
    cacheWritePricePerMillionTokensInUSD: 12.5,
    cacheReadPricePerMillionTokensInUSD: 1,
    outputPricePerMillionTokensInUSD: 50,
  },
  {
    modelPrefix: "claude-opus-5-5",
    inputPricePerMillionTokensInUSD: 4,
    cacheWritePricePerMillionTokensInUSD: 5,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    outputPricePerMillionTokensInUSD: 20,
  },
  {
    modelPrefix: "claude-opus-5",
    inputPricePerMillionTokensInUSD: 5,
    cacheWritePricePerMillionTokensInUSD: 6.25,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "claude-opus-4-8",
    inputPricePerMillionTokensInUSD: 5,
    cacheWritePricePerMillionTokensInUSD: 6.25,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "claude-opus-4-7",
    inputPricePerMillionTokensInUSD: 5,
    cacheWritePricePerMillionTokensInUSD: 6.25,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "claude-opus-4-6",
    inputPricePerMillionTokensInUSD: 5,
    cacheWritePricePerMillionTokensInUSD: 6.25,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "claude-opus-4-5",
    inputPricePerMillionTokensInUSD: 5,
    cacheWritePricePerMillionTokensInUSD: 6.25,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 25,
  },
  {
    modelPrefix: "claude-opus-4-1",
    inputPricePerMillionTokensInUSD: 15,
    cacheWritePricePerMillionTokensInUSD: 18.75,
    cacheReadPricePerMillionTokensInUSD: 1.5,
    outputPricePerMillionTokensInUSD: 75,
  },
  {
    // Claude Opus 4 itself: claude-opus-4-20250514 and claude-opus-4-0.
    modelPrefix: "claude-opus-4",
    inputPricePerMillionTokensInUSD: 15,
    cacheWritePricePerMillionTokensInUSD: 18.75,
    cacheReadPricePerMillionTokensInUSD: 1.5,
    outputPricePerMillionTokensInUSD: 75,
  },
  {
    modelPrefix: "claude-sonnet-5-5",
    inputPricePerMillionTokensInUSD: 2,
    cacheWritePricePerMillionTokensInUSD: 2.5,
    cacheReadPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "claude-sonnet-5",
    inputPricePerMillionTokensInUSD: 2,
    cacheWritePricePerMillionTokensInUSD: 2.5,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "claude-sonnet-4-6",
    inputPricePerMillionTokensInUSD: 3,
    cacheWritePricePerMillionTokensInUSD: 3.75,
    cacheReadPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "claude-sonnet-4-5",
    inputPricePerMillionTokensInUSD: 3,
    cacheWritePricePerMillionTokensInUSD: 3.75,
    cacheReadPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    // Claude Sonnet 4 itself: claude-sonnet-4-20250514 and claude-sonnet-4-0.
    modelPrefix: "claude-sonnet-4",
    inputPricePerMillionTokensInUSD: 3,
    cacheWritePricePerMillionTokensInUSD: 3.75,
    cacheReadPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "claude-haiku-5-5",
    inputPricePerMillionTokensInUSD: 0.1,
    cacheWritePricePerMillionTokensInUSD: 0.125,
    cacheReadPricePerMillionTokensInUSD: 0.01,
    outputPricePerMillionTokensInUSD: 0.5,
    longPrompt: {
      // "For prompts over 100,000 tokens", cache reads and writes included.
      fromPromptTokens: 100_001,
      inputPricePerMillionTokensInUSD: 0.5,
      cacheWritePricePerMillionTokensInUSD: 0.625,
      cacheReadPricePerMillionTokensInUSD: 0.05,
      outputPricePerMillionTokensInUSD: 2.5,
    },
  },
  {
    modelPrefix: "claude-haiku-4-5",
    inputPricePerMillionTokensInUSD: 1,
    cacheWritePricePerMillionTokensInUSD: 1.25,
    cacheReadPricePerMillionTokensInUSD: 0.1,
    outputPricePerMillionTokensInUSD: 5,
  },
  {
    modelPrefix: "claude-3-5-haiku",
    inputPricePerMillionTokensInUSD: 0.8,
    cacheWritePricePerMillionTokensInUSD: 1,
    cacheReadPricePerMillionTokensInUSD: 0.08,
    outputPricePerMillionTokensInUSD: 4,
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
  /*
   * https://ai.google.dev/gemini-api/docs/pricing (paid tier, Standard, text
   * input): Gemini 2.5 Pro, Flash and Flash-Lite with their context-caching
   * price, and 2.5 Pro's price for a prompt over 200K tokens. Gemini 2.0 and
   * 1.5 are no longer on the page and keep their last list prices.
   */
  {
    modelPrefix: "gemini-2.5-pro",
    inputPricePerMillionTokensInUSD: 1.25,
    cacheReadPricePerMillionTokensInUSD: 0.125,
    outputPricePerMillionTokensInUSD: 10,
    longPrompt: {
      fromPromptTokens: 200_001,
      inputPricePerMillionTokensInUSD: 2.5,
      cacheReadPricePerMillionTokensInUSD: 0.25,
      outputPricePerMillionTokensInUSD: 15,
    },
  },
  {
    modelPrefix: "gemini-2.5-flash-lite",
    inputPricePerMillionTokensInUSD: 0.1,
    cacheReadPricePerMillionTokensInUSD: 0.01,
    outputPricePerMillionTokensInUSD: 0.4,
  },
  {
    modelPrefix: "gemini-2.5-flash",
    inputPricePerMillionTokensInUSD: 0.3,
    cacheReadPricePerMillionTokensInUSD: 0.03,
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
  /*
   * https://mistral.ai/pricing gives Mistral Large's price ($0.5 in, $1.5
   * out). Its other API prices are not on the page as published, so Medium,
   * Small and Codestral keep their last list prices.
   */
  {
    modelPrefix: "mistral-large",
    inputPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 1.5,
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
  /*
   * https://api-docs.deepseek.com/quick_start/pricing now lists only
   * deepseek-flash and deepseek-v4-pro, at a peak and an off-peak price by
   * time of day, which one list price cannot hold. deepseek-chat and
   * deepseek-reasoner keep their last list prices.
   */
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
  /*
   * https://docs.x.ai/developers/models ("Text API Pricing"): a prompt that
   * reaches 200K tokens pays the higher row for every token. Grok 4, Grok 3
   * and Grok 3 Mini are no longer on the page and keep their last list
   * prices.
   */
  {
    modelPrefix: "grok-4.7",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 6,
    longPrompt: {
      fromPromptTokens: 200_000,
      inputPricePerMillionTokensInUSD: 4,
      cacheReadPricePerMillionTokensInUSD: 1,
      outputPricePerMillionTokensInUSD: 12,
    },
  },
  {
    modelPrefix: "grok-4.6",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 6,
    longPrompt: {
      fromPromptTokens: 200_000,
      inputPricePerMillionTokensInUSD: 4,
      cacheReadPricePerMillionTokensInUSD: 1,
      outputPricePerMillionTokensInUSD: 12,
    },
  },
  {
    modelPrefix: "grok-4.5",
    inputPricePerMillionTokensInUSD: 2,
    cacheReadPricePerMillionTokensInUSD: 0.3,
    outputPricePerMillionTokensInUSD: 6,
    longPrompt: {
      fromPromptTokens: 200_000,
      inputPricePerMillionTokensInUSD: 4,
      cacheReadPricePerMillionTokensInUSD: 0.6,
      outputPricePerMillionTokensInUSD: 12,
    },
  },
  {
    modelPrefix: "grok-4.3",
    inputPricePerMillionTokensInUSD: 1.25,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    outputPricePerMillionTokensInUSD: 2.5,
    longPrompt: {
      fromPromptTokens: 200_000,
      inputPricePerMillionTokensInUSD: 2.5,
      cacheReadPricePerMillionTokensInUSD: 0.4,
      outputPricePerMillionTokensInUSD: 5,
    },
  },
  {
    // grok-4.20-0309-reasoning, -non-reasoning and grok-4.20-multi-agent-0309.
    modelPrefix: "grok-4.20",
    inputPricePerMillionTokensInUSD: 1.25,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    outputPricePerMillionTokensInUSD: 2.5,
    longPrompt: {
      fromPromptTokens: 200_000,
      inputPricePerMillionTokensInUSD: 2.5,
      cacheReadPricePerMillionTokensInUSD: 0.4,
      outputPricePerMillionTokensInUSD: 5,
    },
  },
  {
    modelPrefix: "grok-build-0.1",
    inputPricePerMillionTokensInUSD: 1,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    outputPricePerMillionTokensInUSD: 2,
    longPrompt: {
      fromPromptTokens: 200_000,
      inputPricePerMillionTokensInUSD: 2,
      cacheReadPricePerMillionTokensInUSD: 0.4,
      outputPricePerMillionTokensInUSD: 4,
    },
  },
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
  /*
   * https://cohere.com/pricing: Command A+ (which the command-a prefix
   * prices), Command R and Command R7B, and the legacy dated models its FAQ
   * prices (Command R+ 08-2024 and 04-2024, Command R 03-2024).
   */
  {
    modelPrefix: "command-r-plus",
    inputPricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
  },
  {
    modelPrefix: "command-r-plus-04-2024",
    inputPricePerMillionTokensInUSD: 3,
    outputPricePerMillionTokensInUSD: 15,
  },
  {
    modelPrefix: "command-r",
    inputPricePerMillionTokensInUSD: 0.15,
    outputPricePerMillionTokensInUSD: 0.6,
  },
  {
    modelPrefix: "command-r-03-2024",
    inputPricePerMillionTokensInUSD: 0.5,
    outputPricePerMillionTokensInUSD: 1.5,
  },
  {
    modelPrefix: "command-r7b",
    inputPricePerMillionTokensInUSD: 0.0375,
    outputPricePerMillionTokensInUSD: 0.15,
  },
  {
    modelPrefix: "command-a",
    inputPricePerMillionTokensInUSD: 2.5,
    outputPricePerMillionTokensInUSD: 10,
  },

  // ---- Amazon Nova ----
  /*
   * https://aws.amazon.com/bedrock/pricing/ (on-demand, US East, from AWS's
   * Price List API): input, output and prompt-cache reads. Bedrock does not
   * charge Nova's cache writes.
   */
  {
    modelPrefix: "nova-micro",
    inputPricePerMillionTokensInUSD: 0.035,
    cacheReadPricePerMillionTokensInUSD: 0.00875,
    cacheWritePricePerMillionTokensInUSD: 0,
    outputPricePerMillionTokensInUSD: 0.14,
  },
  {
    modelPrefix: "nova-lite",
    inputPricePerMillionTokensInUSD: 0.06,
    cacheReadPricePerMillionTokensInUSD: 0.015,
    cacheWritePricePerMillionTokensInUSD: 0,
    outputPricePerMillionTokensInUSD: 0.24,
  },
  {
    modelPrefix: "nova-pro",
    inputPricePerMillionTokensInUSD: 0.8,
    cacheReadPricePerMillionTokensInUSD: 0.2,
    cacheWritePricePerMillionTokensInUSD: 0,
    outputPricePerMillionTokensInUSD: 3.2,
  },

  // ---- Meta Llama (Amazon Bedrock on-demand prices) ----
  /*
   * https://aws.amazon.com/bedrock/pricing/ (on-demand, US regions, from
   * AWS's Price List API), under the names the models go by elsewhere
   * (llama-3.3-70b) and on Bedrock itself (meta.llama3-3-70b-instruct-v1:0).
   * Other hosts charge their own rates: price a model you call elsewhere on
   * the Pricing tab.
   */
  {
    modelPrefix: "llama-3.3-70b",
    inputPricePerMillionTokensInUSD: 0.72,
    outputPricePerMillionTokensInUSD: 0.72,
  },
  {
    modelPrefix: "llama3-3-70b",
    inputPricePerMillionTokensInUSD: 0.72,
    outputPricePerMillionTokensInUSD: 0.72,
  },
  {
    modelPrefix: "llama-3.1-405b",
    inputPricePerMillionTokensInUSD: 2.4,
    outputPricePerMillionTokensInUSD: 2.4,
  },
  {
    modelPrefix: "llama3-1-405b",
    inputPricePerMillionTokensInUSD: 2.4,
    outputPricePerMillionTokensInUSD: 2.4,
  },
  {
    modelPrefix: "llama-3.1-70b",
    inputPricePerMillionTokensInUSD: 0.72,
    outputPricePerMillionTokensInUSD: 0.72,
  },
  {
    modelPrefix: "llama3-1-70b",
    inputPricePerMillionTokensInUSD: 0.72,
    outputPricePerMillionTokensInUSD: 0.72,
  },
  {
    modelPrefix: "llama-3.1-8b",
    inputPricePerMillionTokensInUSD: 0.22,
    outputPricePerMillionTokensInUSD: 0.22,
  },
  {
    modelPrefix: "llama3-1-8b",
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

/*
 * Where a built-in prefix stops in the middle of a word: "gpt-4" in
 * "gpt-4o", "command-r" in "command-r7b". The id names another model.
 */
const CONTINUES_THE_WORD: RegExp = /^[\da-z]/;

// A prefix that ends in a version number: "claude-opus-4", "gpt-5", "grok-4".
const ENDS_IN_A_NUMBER: RegExp = /\d$/;

/*
 * Where an id goes on from such a prefix to a later version of the model: a
 * dotted minor version ("gpt-5" in "gpt-5.2", "grok-4" in "grok-4.7") or a
 * dashed one ("claude-opus-4" in "claude-opus-4-5", "grok-4" in
 * "grok-4-1-fast"). A dashed number is a version only when it is one or two
 * digits, does not start with 0 and stands alone: "-20250514" and
 * "-2024-08-06" are dates, "-0613" and "-0" name the same model
 * (gpt-4-0613, claude-opus-4-0), and "-32k" is a variant.
 */
const LATER_VERSION: RegExp = /^(?:\.\d|-[1-9]\d?(?![\da-z]))/;

export class LlmCostCatalogUtil {
  /**
   * Find the price entry for a (possibly vendor-decorated) model name.
   * Returns null when the model is unknown — callers must not guess a price.
   *
   * `projectPriceOverrides` are per-project custom prices (negotiated rates,
   * self-hosted models, fine-tunes) consulted alongside the built-in catalog.
   * The longest matching prefix wins across BOTH lists; on a prefix-length
   * tie the project entry beats the built-in one. A project entry matches as
   * the plain prefix its owner wrote; a built-in one never matches a later
   * version of its model (see the file header).
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
        if (!this.builtInPrefixMatches(entry.modelPrefix, candidate)) {
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

  /**
   * Whether a built-in entry's prefix names the model of this (normalized)
   * id: the id starts with the prefix, does not go on in the same word, and
   * — when the prefix ends in a version number — does not go on to a later
   * version. claude-opus-4 matches claude-opus-4-20250514, claude-opus-4-0
   * and claude-opus-4@20250514, and not claude-opus-4-5 or claude-opus-4.5.
   */
  public static builtInPrefixMatches(prefix: string, candidate: string): boolean {
    if (!prefix || !candidate.startsWith(prefix)) {
      return false;
    }

    const rest: string = candidate.substring(prefix.length);

    if (!rest) {
      return true;
    }

    if (CONTINUES_THE_WORD.test(rest)) {
      return false;
    }

    return !(ENDS_IN_A_NUMBER.test(prefix) && LATER_VERSION.test(rest));
  }

  /**
   * The prices a call with this many prompt tokens pays at this model's
   * price: its long-prompt tier when the prompt reaches it, and cache reads
   * and writes at the input price where the price names none.
   */
  public static callPrices(
    price: LlmModelPrice,
    promptTokens: number,
  ): LlmCallPrices {
    const tier: LlmModelPrice | LlmLongPromptPrice =
      price.longPrompt && promptTokens >= price.longPrompt.fromPromptTokens
        ? price.longPrompt
        : price;

    return {
      inputPricePerMillionTokensInUSD: tier.inputPricePerMillionTokensInUSD,
      outputPricePerMillionTokensInUSD: tier.outputPricePerMillionTokensInUSD,
      cacheReadPricePerMillionTokensInUSD:
        tier.cacheReadPricePerMillionTokensInUSD ??
        tier.inputPricePerMillionTokensInUSD,
      cacheWritePricePerMillionTokensInUSD:
        tier.cacheWritePricePerMillionTokensInUSD ??
        tier.inputPricePerMillionTokensInUSD,
    };
  }

  /*
   * Normalize project override entries the same way catalog prefixes are
   * stored (trimmed, lowercase) and drop unpriceable rows — user-authored
   * data must never break span ingest or price a call negatively. Only the
   * input and output prices are kept: a project's price is charged for every
   * input token, cached or not, at every prompt length.
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

      sanitized.push({
        modelPrefix: modelPrefix,
        inputPricePerMillionTokensInUSD: inputPrice,
        outputPricePerMillionTokensInUSD: outputPrice,
      });
    }

    return sanitized;
  }

  /**
   * Compute the estimated USD cost of a call from its token counts, or null
   * when the model is unknown or there are no tokens to price. Never guesses:
   * an unknown model yields null, not zero, so the caller can distinguish
   * "free" from "unpriceable".
   *
   * `inputTokens` counts every input token the model read, cached ones
   * included (the GenAI conventions' gen_ai.usage.input_tokens);
   * `cacheReadTokens` and `cacheWriteTokens` say how many of them came from
   * or went to the prompt cache (LlmTokenUsage reads all three off a span).
   * The rest of the input pays the input price.
   */
  public static computeCostInUSD(data: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
    projectPriceOverrides?: Array<LlmModelPrice> | undefined;
  }): number | null {
    const cacheReadTokens: number = this.tokenCount(data.cacheReadTokens);
    const cacheWriteTokens: number = this.tokenCount(data.cacheWriteTokens);
    const outputTokens: number = this.tokenCount(data.outputTokens);

    // A prompt is never smaller than the cache traffic it is made of.
    const promptTokens: number = Math.max(
      this.tokenCount(data.inputTokens),
      cacheReadTokens + cacheWriteTokens,
    );

    if (promptTokens === 0 && outputTokens === 0) {
      return null;
    }

    const price: LlmModelPrice | null = this.findPriceForModel(
      data.model,
      data.projectPriceOverrides,
    );

    if (!price) {
      return null;
    }

    const prices: LlmCallPrices = this.callPrices(price, promptTokens);
    const uncachedInputTokens: number =
      promptTokens - cacheReadTokens - cacheWriteTokens;

    const cost: number =
      (uncachedInputTokens * prices.inputPricePerMillionTokensInUSD +
        cacheReadTokens * prices.cacheReadPricePerMillionTokensInUSD +
        cacheWriteTokens * prices.cacheWritePricePerMillionTokensInUSD +
        outputTokens * prices.outputPricePerMillionTokensInUSD) /
      1_000_000;

    /*
     * Trim float noise (e.g. 0.30000000000000004) — 8 decimal places is
     * sub-hundredth-of-a-cent resolution, far below list-price accuracy.
     */
    return Math.round(cost * 1e8) / 1e8;
  }

  // A token count as a non-negative finite number; anything else is none.
  private static tokenCount(value: number | undefined): number {
    return typeof value === "number" && isFinite(value) && value > 0
      ? value
      : 0;
  }

  /**
   * Expand a raw model string into normalized lookup candidates, most-specific
   * first: the full lowercase name, then the name with routing/provider
   * prefixes (path segments, dotted namespaces, region tokens) stripped away,
   * and last, for a Claude model, the id Anthropic's API gives it
   * (ClaudeModelId.canonicalId) — the one form OpenRouter's dotted versions,
   * Google Cloud's "@" dates and gateway-prefixed names all share.
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

    const claudeId: string | null = ClaudeModelId.canonicalId(normalized);

    if (claudeId && !candidates.includes(claudeId)) {
      candidates.push(claudeId);
    }

    return candidates;
  }
}
