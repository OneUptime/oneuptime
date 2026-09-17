import { withResourcePrefixedKeys } from "./LlmConventions";

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
  /*
   * Coding-agent CLIs. Every one of these ships OpenTelemetry natively and
   * every one namespaces its metrics under its own vendor prefix rather than
   * gen_ai.*, so before this list knew their names an entire fleet of agents
   * could be exporting straight into OneUptime and still report zero tokens
   * and zero spend. That is the failure mode these three entries fix.
   */
  // Anthropic Claude Code CLI.
  "claude_code.token.usage",
  // Cursor Enterprise OTel export.
  "cursor.token.usage",
  // OpenAI Codex CLI.
  "codex.turn.token_usage",
  /*
   * DELIBERATELY ABSENT: "gemini_cli.token.usage".
   *
   * Gemini CLI emits BOTH its vendor metric and the semantic-convention
   * `gen_ai.client.token.usage` for the SAME tokens (see the metric table in
   * Docs/Content/en/telemetry/gemini-cli-and-copilot.md, which lists the two
   * side by side). LlmMetricQuery.buildTokenQuery issues ONE query with
   * `name: new Includes(LlmTokenUsageMetricNames)` and groups only by the
   * token-TYPE attribute keys — never by metric name — so both emissions come
   * back as separate rows and reduceTokenRows adds them together. Listing
   * both names would make a Gemini-CLI-only project report exactly 2x its
   * real token count on the AI / LLM Usage view, with no error and no gap in
   * the chart to give it away.
   *
   * Nothing is lost by the omission: the semconv name that stays in this list
   * is emitted by Gemini CLI itself, so its tokens are still counted — once.
   *
   * AUDIT of the three names above, against the vendor docs in
   * Docs/Content/en/telemetry/, because this hazard applies to any emitter
   * that publishes two token metrics:
   *   - claude_code.token.usage   Claude Code's metric table is entirely
   *       claude_code.* — no gen_ai.* metric. Its gen_ai.* keys are on SPANS,
   *       which are a different stream and are summed separately.
   *   - cursor.token.usage        Cursor publishes exactly three metrics, all
   *       cursor.*, and emits no gen_ai.* telemetry at all.
   *   - codex.turn.token_usage    Codex's metrics are codex.*; its gen_ai.*
   *       usage attributes are on SPANS, not metrics.
   * None of the three overlaps a semconv metric, so all three stay.
   *
   * Before re-adding ANY vendor token metric, check whether the same process
   * also emits gen_ai.client.token.usage. If it does, leave it out.
   */
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
  // Anthropic Claude Code CLI — unit USD.
  "claude_code.cost.usage",
  /*
   * Cursor Enterprise OTel export — unit USD, and documented as a
   * best-effort estimate rather than a billed figure. It is still worth
   * summing: an estimate that is visible beats a true cost nobody can see.
   */
  "cursor.cost.usage",
];

/**
 * The multiplier that turns a micro-USD figure into USD. Exported so the
 * scale lives in exactly one place that a test can pin, rather than as a
 * literal 0.000001 sprinkled through the query layer where a typo'd zero
 * would be invisible in review and off by a factor of ten in production.
 */
export const MICRO_USD_TO_USD: number = 0.000001;

/*
 * Cost metric names denominated in MILLIONTHS of a USD.
 *
 * This list exists separately from LlmCostMetricNames for one reason, and it
 * is worth being blunt about it: the OpenAI Codex CLI reports spend in
 * micro-USD. If "codex.turn.cost_microusd" were appended to the USD list, the
 * shared Sum aggregate would add its raw values to genuinely-USD values and a
 * $3 Codex turn would land in a cost budget as $3,000,000 — instantly
 * breaching every threshold a customer has configured. There is no way to
 * recover the unit after the sum, so the two units must never share a query.
 *
 * Callers query this separately and combine via
 * LlmMetricQuery.combineCostTotals, which applies MICRO_USD_TO_USD in the one
 * tested place.
 */
export const LlmMicroUsdCostMetricNames: Array<string> = [
  // OpenAI Codex CLI — unit is millionths of a USD, NOT dollars.
  "codex.turn.cost_microusd",
];

/*
 * Attribute keys naming which side of the exchange a token datapoint counts.
 * The OTel convention is `gen_ai.token.type`; the others are pre-convention
 * spellings still in the wild.
 */
export const LlmTokenTypeAttributeKeys: Array<string> = [
  "gen_ai.token.type",
  "llm.token.type",
  /*
   * Claude Code spells it bare: `type`.
   *
   * A one-word key like this looks alarmingly generic, and the risk is worth
   * spelling out because it is bounded rather than absent: these keys are
   * consulted ONLY for rows that already matched one of the LLM metric NAMES
   * above. A `type` attribute on some unrelated business metric is never
   * reached by this code path, because that metric's name never enters the
   * query. The key is also last-but-two in preference order, so any emitter
   * carrying a namespaced spelling as well wins over it.
   */
  "type",
  // Cursor Enterprise OTel export.
  "cursor.token.type",
  // OpenAI Codex CLI.
  "token_type",
];

/*
 * Attribute values that mean "tokens sent to the model". `prompt` is the
 * pre-1.27 semconv spelling that several instrumentations still emit.
 */
export const LlmInputTokenTypeValues: Array<string> = ["input", "prompt"];

/*
 * Attribute values that mean "tokens produced by the model".
 *
 * Note what is deliberately absent, and why each exclusion is its own
 * decision rather than an oversight. The coding-agent CLIs emit a richer
 * token vocabulary than the semconv does:
 *
 *   Claude Code  input | output | cacheRead | cacheCreation   (camelCase!)
 *   Cursor       input | output | cache_read | cache_creation
 *   Codex        total | input | cached_input | cache_write_input |
 *                output | reasoning_output
 *
 * The plain input/output values are covered by the two lists here and need
 * nothing added. The rest are excluded on purpose:
 *
 *   - cache_read / cacheRead / cached_input, and
 *     cache_creation / cacheCreation / cache_write_input
 *       Real token counts, but neither input nor output in the sense the span
 *       columns (llmInputTokens / llmOutputTokens) use. Folding them in would
 *       silently inflate the metric-sourced totals against the span-sourced
 *       ones they stand in for. Cache-aware accounting deserves its own
 *       columns; until it has them, these are dropped rather than guessed at.
 *   - total
 *       A SUPERSET of its siblings. Codex emits it ALONGSIDE the per-kind
 *       datapoints, so counting it would add every token a second time.
 *   - reasoning_output
 *       A SUBSET of `output` — the reasoning share of the same tokens, which
 *       Codex also reports under `output`. Counting it would double-count the
 *       reasoning portion of every turn.
 *
 * Both classes are pinned by explicit getLlmTokenDirection tests, so a future
 * "why is this not handled?" reads as a decision, not a gap.
 */
export const LlmOutputTokenTypeValues: Array<string> = ["output", "completion"];

/*
 * Attribute keys naming WHO the metric datapoint belongs to, for grouping
 * metric-sourced spend by employee — the metric-side counterpart of
 * LlmUserIdAttributeKeys in Common/Types/Telemetry/LlmConventions.ts.
 *
 * Email leads here rather than id (the span list is the other way round)
 * because the coding-agent CLIs that dominate the metric-only population emit
 * user.email natively, and it is the one value a manager reads without a
 * lookup table. cursor.user.id sorts last for the same reason it does on the
 * span side: it is an opaque team-scoped integer.
 *
 * Both lists below are resource-widened for the same reason the span lists
 * are: OtelMetricsIngestService flattens resource attributes with the
 * "resource" prefix exactly as the traces service does, so a fleet that
 * stamps identity once on the resource — which is the normal thing to do, and
 * the only thing OTEL_RESOURCE_ATTRIBUTES can do — arrives here as
 * `resource.user.email` / `resource.team.id`. The bare tier still leads, so
 * METRIC_USER_ATTRIBUTE_KEY / METRIC_TEAM_ATTRIBUTE_KEY (element zero, used
 * for scoped filtering in LlmMetricQuery) are unchanged.
 */
export const LlmMetricUserBaseAttributeKeys: Array<string> = [
  "user.email",
  "user.id",
  "user.account_uuid",
  "user.account_id",
  "cursor.user.id",
];

export const LlmMetricUserAttributeKeys: Array<string> =
  withResourcePrefixedKeys(LlmMetricUserBaseAttributeKeys);

/*
 * Attribute keys naming the team / cost centre a metric datapoint charges to.
 * The first four are conventionally set by the operator via
 * OTEL_RESOURCE_ATTRIBUTES rather than emitted by any instrumentation — which
 * is precisely why the resource tier has to be here too; see above.
 */
export const LlmMetricTeamBaseAttributeKeys: Array<string> = [
  "team.id",
  "team",
  "cost_center",
  "department",
  "cursor.team.id",
];

export const LlmMetricTeamAttributeKeys: Array<string> =
  withResourcePrefixedKeys(LlmMetricTeamBaseAttributeKeys);

/*
 * Attribute keys naming WHICH MODEL a metric datapoint was produced by.
 *
 * This exists because the vendor cost/token counters DO carry the model on
 * the datapoint even though they carry no provider and no service id:
 * claude_code.cost.usage and claude_code.token.usage stamp a bare `model`,
 * and cursor.cost.usage stamps `cursor.model.name`. Without this list the
 * Model breakdown is empty for an entire fleet of coding agents whose spend
 * is perfectly well attributed to a model — the same failure the user list
 * above fixes for people.
 *
 * `model` is bare and looks alarmingly generic, and the bound is the same one
 * that makes the bare `type` token key safe: these keys are only ever read
 * off rows that already matched one of the LLM metric NAMES above, so a
 * `model` attribute on some unrelated business metric is never reached. It
 * also sorts after the semantic-convention spelling, so an emitter carrying
 * both wins with the namespaced one.
 *
 * Resource-widened for the same reason the identity lists are: a fleet that
 * pins one model per deployment sets it once via OTEL_RESOURCE_ATTRIBUTES,
 * and OtelMetricsIngestService flattens that to `resource.model`.
 */
export const LlmMetricModelBaseAttributeKeys: Array<string> = [
  "gen_ai.request.model",
  // Anthropic Claude Code CLI — bare, on both its cost and token counters.
  "model",
  // Cursor Enterprise OTel export.
  "cursor.model.name",
];

export const LlmMetricModelAttributeKeys: Array<string> =
  withResourcePrefixedKeys(LlmMetricModelBaseAttributeKeys);

/**
 * Which side of the exchange a `gen_ai.token.type` value denotes, or null
 * when the value is one we deliberately do not count (the cache kinds,
 * `total`, `reasoning_output` — see LlmOutputTokenTypeValues for why each is
 * excluded) or do not recognize at all.
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
