/*
 * Single source of truth for the OpenTelemetry GenAI **metric** names and
 * attribute keys OneUptime recognizes — the metric-side sibling of
 * Common/Types/Telemetry/LlmConventions.ts, which does the same job for span
 * attributes.
 *
 * Why this exists: the LLM feature was originally span-only. A span carries
 * model, tokens and cost together, so one row answers every question. But a
 * large class of emitters never produce GenAI spans at all:
 *
 *   - Native OpenTelemetry GenAI metrics (gen_ai.client.token.usage) emitted
 *     by an SDK configured for metrics without tracing.
 *   - AI gateways and vendor exporters that publish spend/usage counters only.
 *
 * For those, token and cost totals have to come off the metric stream instead.
 * Both the budget evaluator (Common/Server/Utils/Telemetry/LlmMetricSpend.ts)
 * and anything else that needs metric-sourced LLM figures import these lists,
 * so a newly recognized metric name is added HERE, once.
 *
 * Order matters: within each list the preferred convention comes first.
 */

/*
 * Metric names carrying token counts. `gen_ai.client.token.usage` is the OTel
 * semantic convention (a histogram whose `sum` is the token total); the rest
 * are the spellings the dominant instrumentations shipped before/alongside it.
 */
export const LlmTokenUsageMetricNames: Array<string> = [
  "gen_ai.client.token.usage",
  "gen_ai.client.token.count",
  "llm.token.usage",
  "llm.usage.tokens",
];

/*
 * Metric names carrying spend in USD.
 *
 * There is no OTel semantic convention for LLM cost — every entry below is a
 * vendor spelling. That is precisely why metric-sourced cost is worth
 * supporting: the emitters that publish a cost metric are generally the ones
 * that publish no spans, so this list is the only way their spend is visible.
 */
export const LlmCostMetricNames: Array<string> = [
  "gen_ai.client.cost",
  "gen_ai.client.cost.usd",
  "gen_ai.usage.cost",
  // LiteLLM proxy.
  "litellm_spend_metric",
  "litellm.cost.total",
];

/*
 * Attribute keys naming which side of the exchange a token datapoint counts.
 * The OTel convention is `gen_ai.token.type`; the others are pre-convention
 * spellings still in the wild.
 */
export const LlmTokenTypeAttributeKeys: Array<string> = [
  "gen_ai.token.type",
  "llm.token.type",
];

/*
 * Attribute values that mean "tokens sent to the model". `prompt` is the
 * pre-1.27 semconv spelling that several instrumentations still emit.
 */
export const LlmInputTokenTypeValues: Array<string> = ["input", "prompt"];

/*
 * Attribute values that mean "tokens produced by the model".
 *
 * Note what is deliberately absent: cache_read / cache_creation. Those are
 * real token counts, but they are neither input nor output in the sense the
 * span columns (llmInputTokens / llmOutputTokens) use, and folding them in
 * would silently inflate the metric-sourced totals relative to the
 * span-sourced ones they stand in for.
 */
export const LlmOutputTokenTypeValues: Array<string> = ["output", "completion"];

/**
 * Which side of the exchange a `gen_ai.token.type` value denotes, or null
 * when the value is one we deliberately do not count (cache_read,
 * cache_creation) or do not recognize at all.
 *
 * Comparison is case-insensitive and whitespace-trimmed: the value reaches us
 * as a free-form OTLP string attribute, and emitters are inconsistent about
 * casing.
 */
export type LlmTokenDirection = "input" | "output";

export function getLlmTokenDirection(
  attributeValue: string | undefined | null,
): LlmTokenDirection | null {
  if (typeof attributeValue !== "string") {
    return null;
  }

  const normalized: string = attributeValue.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (LlmInputTokenTypeValues.includes(normalized)) {
    return "input";
  }

  if (LlmOutputTokenTypeValues.includes(normalized)) {
    return "output";
  }

  return null;
}

/**
 * The attribute values to match for a direction. Exposed so query builders
 * and tests share one definition of "what counts as input".
 */
export function getLlmTokenTypeValues(
  direction: LlmTokenDirection,
): Array<string> {
  return direction === "input"
    ? LlmInputTokenTypeValues
    : LlmOutputTokenTypeValues;
}
