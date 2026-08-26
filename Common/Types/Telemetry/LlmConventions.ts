/*
 * Single source of truth for the OpenTelemetry GenAI (gen_ai.*) semantic
 * convention attribute keys OneUptime recognizes when it detects and
 * denormalizes LLM / GenAI / agent telemetry, plus cheap fallbacks for the two
 * dominant instrumentation libraries:
 *   - OpenLLMetry / Traceloop  (gen_ai.* + traceloop.*)
 *   - OpenInference / Arize    (llm.* + openinference.span.kind)
 *
 * Both the server-side ingest extractor
 * (Common/Server/Utils/Telemetry/LlmSpan.ts) and the client-side display parser
 * (App/FeatureSet/Dashboard/src/Utils/LlmSpanDisplay.ts) import these lists so
 * the two cannot silently drift apart when a new attribute is added — add a
 * newly recognized key HERE, once.
 *
 * Order matters: within each list the preferred convention comes first and the
 * lookup helpers return the first key that is present.
 */

/**
 * The prefix OTLP ingest stamps onto every RESOURCE attribute before the
 * attributes map reaches any extractor.
 *
 * This is not cosmetic and it is the difference between a feature that works
 * and one that silently reports nothing. All three ingest services flatten
 * resource attributes through
 * `TelemetryUtil.getAttributes({ items, prefixKeysWithString: "resource" })`
 * — OtelTracesIngestService, OtelMetricsIngestService and
 * OtelLogsIngestService alike. So an operator who sets
 * `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` does NOT produce an attribute
 * called `team.id`; they produce one called `resource.team.id`.
 *
 * OtelTracesIngestService already learned this the hard way for session
 * replay (see its `sessionIdAttributeKeys`, which lists both spellings and
 * whose comment notes that reading only the bare key "would look correct in a
 * unit test and fail in production"). Identity is the same trap, one tier
 * worse: identity is precisely the kind of value a fleet stamps ONCE on the
 * resource rather than on every span, and Cursor documents `cursor.user.id` /
 * `cursor.team.id` as resource attributes outright.
 */
export const RESOURCE_ATTRIBUTE_KEY_PREFIX: string = "resource.";

/**
 * Widen a key list so it matches both the span-attribute spelling and the
 * resource-attribute spelling of every key in it.
 *
 * The bare block comes FIRST in its entirety, then the resource-prefixed
 * block, because a span attribute is strictly more specific than a resource
 * attribute: the resource describes the whole process, the span describes one
 * call. Preserving each block's internal order keeps the documented
 * preference ordering intact within each tier.
 *
 * Pure and exported so the widening is one tested function rather than a
 * hand-maintained second copy of every list that drifts the first time
 * somebody adds a key.
 */
export function withResourcePrefixedKeys(keys: Array<string>): Array<string> {
  return [
    ...keys,
    ...keys.map((key: string) => {
      return `${RESOURCE_ATTRIBUTE_KEY_PREFIX}${key}`;
    }),
  ];
}

/*
 * Note what is deliberately NOT widened: every list below that carries a
 * per-CALL value — system, operation, models, tokens, cost, conversation id,
 * tool name, request parameters, prompts and completions. Those describe one
 * LLM request and have no business being set on a resource, which describes
 * the whole process; a resource-scoped `gen_ai.request.model` would be a
 * misconfiguration, not a convention to support. Widening them would double
 * the number of map lookups on the hottest ingest path to chase a spelling
 * nobody emits. Only the IDENTITY lists — user id, user email, team, and the
 * end-user EXCLUSION list — are widened, because identity is exactly the
 * value an operator sets once via OTEL_RESOURCE_ATTRIBUTES.
 */

// Provider / system, e.g. "openai", "anthropic", "aws.bedrock".
export const LlmSystemAttributeKeys: Array<string> = [
  "gen_ai.system",
  "gen_ai.provider.name",
  "llm.system",
  "llm.provider",
];

// Operation, e.g. "chat", "embeddings", "execute_tool", "invoke_agent".
export const LlmOperationAttributeKeys: Array<string> = [
  "gen_ai.operation.name",
  "llm.request.type",
  "openinference.span.kind",
];

// Model requested by the caller.
export const LlmRequestModelAttributeKeys: Array<string> = [
  "gen_ai.request.model",
  "llm.model_name",
  "llm.request.model",
];

// Model the provider actually served (often the resolved/pinned model).
export const LlmResponseModelAttributeKeys: Array<string> = [
  "gen_ai.response.model",
  "llm.response.model",
];

export const LlmInputTokenAttributeKeys: Array<string> = [
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.prompt_tokens",
  "llm.token_count.prompt",
  "llm.usage.prompt_tokens",
];

export const LlmOutputTokenAttributeKeys: Array<string> = [
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.completion_tokens",
  "llm.token_count.completion",
  "llm.usage.completion_tokens",
];

export const LlmTotalTokenAttributeKeys: Array<string> = [
  "gen_ai.usage.total_tokens",
  "llm.token_count.total",
  "llm.usage.total_tokens",
];

/*
 * Cost in USD. A reported cost always wins; when absent, ingest computes an
 * estimate from token counts via Common/Types/Telemetry/LlmCostCatalog.ts.
 */
export const LlmCostAttributeKeys: Array<string> = [
  "gen_ai.usage.cost",
  "gen_ai.usage.cost_usd",
  "gen_ai.usage.total_cost",
  "llm.usage.total_cost",
  // LiteLLM proxy: v1 otel callback / opt-in OTel v2 mode.
  "gen_ai.cost.total_cost",
  "litellm.cost.total",
];

/*
 * Conversation / session id that groups the LLM calls of one user interaction
 * across traces. gen_ai.conversation.id is the OTel semconv key; session.id is
 * emitted by OpenInference and Langfuse-compatible SDKs; the traceloop
 * association property is OpenLLMetry's spelling.
 */
export const LlmConversationIdAttributeKeys: Array<string> = [
  "gen_ai.conversation.id",
  "session.id",
  "langfuse.session.id",
  "traceloop.association.properties.session_id",
];

export const LlmAgentNameAttributeKeys: Array<string> = [
  "gen_ai.agent.name",
  "agent.name",
];

/*
 * ---------------------------------------------------------------------------
 * WHO ran this call — the EMPLOYEE, never the employee's own customer.
 * ---------------------------------------------------------------------------
 *
 * The LLM feature was born trace-only and had no concept of a human being, so
 * "which of our engineers burned $4k on Opus last month" was unanswerable. The
 * three lists below make the human actor a first-class span dimension, so
 * spend can be grouped by person and by cost centre.
 *
 * THE CORRECTNESS RULE, and it is not a stylistic one: an LLM span can carry
 * TWO different humans. The employee who made the call, and the DOWNSTREAM
 * CUSTOMER on whose behalf the call was made (OpenAI's `user` request
 * parameter, which instrumentations echo back as gen_ai.user / llm.user, and
 * LiteLLM's end-user id). Those two are not interchangeable. Mapping a
 * downstream customer into the employee columns produces internal chargeback
 * that is not merely imprecise but WRONG — a support bot serving 40k
 * customers would manufacture 40k phantom "employees", and the engineer who
 * actually owns that spend would appear to have spent nothing.
 *
 * So the customer-identity keys are enumerated separately in
 * LlmEndUserAttributeKeys below and are deliberately NOT read into any
 * column. The exclusion is pinned by a test; if someone later wants
 * downstream-customer analytics it must land in its OWN column, never by
 * appending a key to the lists below.
 */

/*
 * The employee / internal actor id.
 *
 * Provenance, preferred first:
 *   - user.id      OTel general semantic conventions; THE canonical key for
 *                  the human actor and the one to standardize on.
 *   - enduser.id   Also still an ACTIVE semconv attribute — the 1.25
 *                  deprecation removed enduser.role and enduser.scope only,
 *                  so this remains a legitimate, widely-emitted spelling.
 *   - litellm.metadata.user_api_key_user_id
 *                  LiteLLM proxy: the internal user who OWNS the virtual key
 *                  the request authenticated with. Note the sibling key
 *                  user_api_key_end_user_id is the CUSTOMER and is excluded.
 *   - traceloop.association.properties.user_id   OpenLLMetry.
 *   - langfuse.user.id                           Langfuse.
 *   - user.account_uuid / user.account_id        Claude Code (and Codex for
 *                  the latter) stamp the signed-in account onto every span.
 *   - cursor.user.id   Cursor's OTel export; an opaque team-scoped integer,
 *                  which is why it sorts last — it needs the Cursor admin API
 *                  to resolve to a person, unlike the keys above.
 *
 * The `Base` list is the SPAN-attribute spelling only. Consumers must import
 * LlmUserIdAttributeKeys, which adds the resource-attribute tier — see
 * withResourcePrefixedKeys. The base list is exported solely so tests and
 * docs can cross-check the two tiers against each other.
 */
export const LlmUserIdBaseAttributeKeys: Array<string> = [
  "user.id",
  "enduser.id",
  "litellm.metadata.user_api_key_user_id",
  "traceloop.association.properties.user_id",
  "langfuse.user.id",
  "user.account_uuid",
  "user.account_id",
  "cursor.user.id",
];

export const LlmUserIdAttributeKeys: Array<string> = withResourcePrefixedKeys(
  LlmUserIdBaseAttributeKeys,
);

/*
 * The employee's email address — in practice the only identity value a
 * manager can read without a lookup table, which is why it gets its own
 * column rather than being folded into the id.
 *
 * user.email is the OTel general-semconv key and is emitted NATIVELY by
 * Claude Code, Gemini CLI and OpenAI Codex, so for the coding-agent fleet
 * this list is usually the one that hits.
 *
 * Because this column holds real PII, TraceScrubRuleService scrubs it under
 * the Attributes scope exactly as it scrubs the attribute it was derived from
 * — see the identity-column pass in scrubSpan. A denormalized column that
 * skipped the scrub pass would make a customer's email-redaction rule
 * silently ineffective on the very column most likely to hold an email.
 */
export const LlmUserEmailBaseAttributeKeys: Array<string> = [
  "user.email",
  "traceloop.association.properties.user_email",
  "enduser.email",
];

export const LlmUserEmailAttributeKeys: Array<string> =
  withResourcePrefixedKeys(LlmUserEmailBaseAttributeKeys);

/*
 * The team / cost centre the spend charges to.
 *
 * The first four are not emitted by any instrumentation on their own: they
 * are what an organization sets via OTEL_RESOURCE_ATTRIBUTES on the agent
 * process (OTEL_RESOURCE_ATTRIBUTES=team.id=platform,cost_center=RD-114), and
 * are conventionally the ONLY way a coding-agent CLI learns which budget it
 * belongs to. The remaining entries are the gateway/vendor spellings that
 * arrive without any operator configuration.
 *
 * That first sentence is exactly why the resource tier is not optional here:
 * OTEL_RESOURCE_ATTRIBUTES sets a RESOURCE attribute, which ingest delivers
 * as `resource.team.id`. A list of bare keys alone would mean the one
 * mechanism the docs present as THE way to attribute spend to a cost centre
 * never matches a single row.
 */
export const LlmTeamBaseAttributeKeys: Array<string> = [
  "team.id",
  "team",
  "cost_center",
  "department",
  "litellm.metadata.user_api_key_team_id",
  "litellm.team.id",
  "cursor.team.id",
];

export const LlmTeamAttributeKeys: Array<string> = withResourcePrefixedKeys(
  LlmTeamBaseAttributeKeys,
);

/*
 * DELIBERATELY EXCLUDED — the DOWNSTREAM CUSTOMER, not the employee.
 *
 * Exported so the exclusion is a documented, testable decision rather than an
 * omission somebody "fixes" later:
 *
 *   - gen_ai.user / llm.user
 *       Both carry the OpenAI `user` REQUEST PARAMETER, which the API
 *       documents as the caller's own end user, sent for abuse monitoring. On
 *       a SaaS product's spans this is the SaaS product's customer.
 *   - litellm.metadata.user_api_key_end_user_id
 *       LiteLLM's explicit end-user id, distinct from the key-owner id above
 *       (which IS the employee and IS recognized).
 *
 * None of these is denormalized into a column by this change. They remain
 * available in the raw attributes map for anyone who queries them directly.
 *
 * This list is resource-widened too, and for the OPPOSITE reason to the
 * lists above. Here the widening does not make anything match — it makes the
 * EXCLUSION hold. The exclusion is enforced as a set relation ("no end-user
 * key appears in an employee list"), so if this list stopped at the bare
 * spellings while the employee lists carried both tiers, a future
 * `resource.gen_ai.user` could be appended to an employee list and every
 * exclusion test would still pass. Both tiers here, both tiers there.
 */
export const LlmEndUserBaseAttributeKeys: Array<string> = [
  "gen_ai.user",
  "llm.user",
  "litellm.metadata.user_api_key_end_user_id",
];

export const LlmEndUserAttributeKeys: Array<string> = withResourcePrefixedKeys(
  LlmEndUserBaseAttributeKeys,
);

export const LlmToolNameAttributeKeys: Array<string> = [
  "gen_ai.tool.name",
  "tool.name",
];

/*
 * Request-parameter keys — surfaced only in the display panel, never
 * denormalized to DB columns.
 */
export const LlmTemperatureAttributeKeys: Array<string> = [
  "gen_ai.request.temperature",
  "llm.request.temperature",
];

export const LlmMaxTokensAttributeKeys: Array<string> = [
  "gen_ai.request.max_tokens",
  "llm.request.max_tokens",
];

export const LlmTopPAttributeKeys: Array<string> = [
  "gen_ai.request.top_p",
  "llm.request.top_p",
];

export const LlmFinishReasonAttributeKeys: Array<string> = [
  "gen_ai.response.finish_reasons",
  "gen_ai.response.finish_reason",
  "llm.response.finish_reason",
];

/*
 * Attribute-key namespace prefixes. Any span carrying an attribute in one of
 * these namespaces is treated as an LLM/GenAI span as a last resort.
 */
export const LlmAttributeNamespacePrefixes: Array<string> = [
  "gen_ai.",
  "llm.",
  "traceloop.",
];

/*
 * Indexed prompt/completion message conventions of the shape
 * `${prefix}.${i}.${contentSuffix}` / `${prefix}.${i}.${roleSuffix}`. Used only
 * by the display parser to reconstruct message content for rendering.
 */
export interface LlmIndexedMessageConvention {
  prefix: string;
  contentSuffix: string;
  roleSuffix: string;
}

export const LlmPromptIndexedMessageConventions: Array<LlmIndexedMessageConvention> =
  [
    // OpenLLMetry indexed prompts.
    { prefix: "gen_ai.prompt", contentSuffix: "content", roleSuffix: "role" },
    // OpenInference indexed input messages.
    {
      prefix: "llm.input_messages",
      contentSuffix: "message.content",
      roleSuffix: "message.role",
    },
  ];

export const LlmCompletionIndexedMessageConventions: Array<LlmIndexedMessageConvention> =
  [
    // OpenLLMetry indexed completions.
    {
      prefix: "gen_ai.completion",
      contentSuffix: "content",
      roleSuffix: "role",
    },
    // OpenInference indexed output messages.
    {
      prefix: "llm.output_messages",
      contentSuffix: "message.content",
      roleSuffix: "message.role",
    },
  ];

// JSON-encoded message-array attribute keys (checked in order).
export const LlmPromptJsonAttributeKeys: Array<string> = [
  "gen_ai.input.messages",
  "gen_ai.prompt",
  "input.value",
];

export const LlmCompletionJsonAttributeKeys: Array<string> = [
  "gen_ai.output.messages",
  "gen_ai.completion",
  "output.value",
];

// Span-event names carrying prompt/completion content.
export const LlmPromptEventNames: Array<string> = [
  "gen_ai.system.message",
  "gen_ai.user.message",
  "gen_ai.tool.message",
];

export const LlmCompletionEventNames: Array<string> = [
  "gen_ai.assistant.message",
  "gen_ai.choice",
];
