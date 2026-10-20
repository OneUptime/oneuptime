/*
 * THE METRICS A CONNECTED PROVIDER ACCOUNT WRITES.
 *
 * A provider account connection (OpenAI, Anthropic, Azure OpenAI / Foundry,
 * Amazon Bedrock, Google Vertex AI) reads the provider's own figures - one
 * total per UTC day for each model, project, key and person the provider
 * names - and keeps them as three metrics of the connection's telemetry
 * service:
 *
 *   oneuptime.llm.provider.cost      USD (the provider's own cost, or an
 *                                    estimate from the tokens, marked so)
 *   oneuptime.llm.provider.tokens    tokens, one series per token type
 *   oneuptime.llm.provider.requests  requests
 *
 * Each point is stamped at the START of its UTC day, so a day's total is the
 * sum of that day's points whatever the time of the read. A day is read again
 * while the provider may still change it, and only the difference from what
 * is stored is written (LlmProviderUsageWriter), so the sum always equals the
 * provider's latest figure.
 *
 * These names are deliberately NOT the GenAI metric names the AI / LLM
 * Usage tab falls back to (LlmMetricConventions): a provider's bill counts
 * the same calls your app's spans and your coding tools' metrics count, so
 * adding them up would count every call twice. The Usage tab shows them as
 * their own source ("Provider accounts"), and a budget counts one source or
 * the other.
 *
 * Isomorphic: the server writes them, and the dashboard reads them.
 */

export const LLM_PROVIDER_COST_METRIC_NAME: string = "oneuptime.llm.provider.cost";
export const LLM_PROVIDER_TOKENS_METRIC_NAME: string =
  "oneuptime.llm.provider.tokens";
export const LLM_PROVIDER_REQUESTS_METRIC_NAME: string =
  "oneuptime.llm.provider.requests";

export const LlmProviderUsageMetricNames: Array<string> = [
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
  LLM_PROVIDER_REQUESTS_METRIC_NAME,
];

// Which connection a point came from (stable across renames).
export const LLM_CONNECTION_ID_ATTRIBUTE: string = "oneuptime.llm.connection.id";
// The connection's name when the point was written, for charts.
export const LLM_CONNECTION_NAME_ATTRIBUTE: string =
  "oneuptime.llm.connection.name";
// The OpenTelemetry GenAI provider name (openai, anthropic, aws.bedrock ...).
export const LLM_PROVIDER_NAME_ATTRIBUTE: string = "gen_ai.provider.name";
// The model the provider billed.
export const LLM_PROVIDER_MODEL_ATTRIBUTE: string = "gen_ai.request.model";
/*
 * Who used it, when the provider says: an email when it gives one, else the
 * provider's own id for the person. Same key as the identity the Usage tab
 * reads off GenAI metrics, so the two read alike.
 */
export const LLM_PROVIDER_PERSON_ATTRIBUTE: string = "user.email";
/*
 * The provider's own grouping of the usage: an OpenAI project, an Anthropic
 * workspace, an Azure resource, an AWS Region, a Google Cloud project.
 */
export const LLM_PROVIDER_PROJECT_ATTRIBUTE: string =
  "oneuptime.llm.provider.project";
// The name of the API key the usage was made with.
export const LLM_PROVIDER_API_KEY_ATTRIBUTE: string =
  "oneuptime.llm.provider.api_key";
// On token points: input | output | cache_read | cache_write.
export const LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE: string = "gen_ai.token.type";
// On cost points: "true" when OneUptime estimated it from the tokens.
export const LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE: string =
  "oneuptime.llm.cost.estimated";

/*
 * The attributes that tell one series of a connection from another, in the
 * order they are written. A stored point's series is read back with these
 * keys, so a key added here must also be written by every connector, or its
 * series would never match what is stored.
 */
export const LlmProviderSeriesAttributeKeys: Array<string> = [
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_PROJECT_ATTRIBUTE,
  LLM_PROVIDER_API_KEY_ATTRIBUTE,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
];

export enum LlmProviderTokenType {
  Input = "input",
  Output = "output",
  CacheRead = "cache_read",
  CacheWrite = "cache_write",
}

export const AllLlmProviderTokenTypes: Array<LlmProviderTokenType> = [
  LlmProviderTokenType.Input,
  LlmProviderTokenType.Output,
  LlmProviderTokenType.CacheRead,
  LlmProviderTokenType.CacheWrite,
];

// The units the metric picker shows.
export const LLM_PROVIDER_COST_UNIT: string = "USD";
export const LLM_PROVIDER_TOKENS_UNIT: string = "{token}";
export const LLM_PROVIDER_REQUESTS_UNIT: string = "{request}";
