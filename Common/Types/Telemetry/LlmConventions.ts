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

// Cost in USD. Only populated when the SDK reports it (no built-in pricing).
export const LlmCostAttributeKeys: Array<string> = [
  "gen_ai.usage.cost",
  "gen_ai.usage.cost_usd",
  "gen_ai.usage.total_cost",
  "llm.usage.total_cost",
];

export const LlmAgentNameAttributeKeys: Array<string> = [
  "gen_ai.agent.name",
  "agent.name",
];

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
