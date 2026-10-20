/*
 * What an AI / LLM observability connection reads. Each value is the stable
 * identifier stored on LlmObservabilityConnection.provider: it picks the
 * server connector (LlmConnectorRegistry) and the form, docs and labels
 * (LlmConnectionCatalog).
 *
 * Two kinds, decided by the catalog:
 *
 *   - a provider account (OpenAI, Anthropic, Azure OpenAI / Foundry, Amazon
 *     Bedrock, Google Vertex AI): what the account used and what it cost,
 *     read from the provider's own usage, cost or metrics API;
 *   - a company AI tool (Claude Enterprise, Microsoft 365 Copilot): what the
 *     company's people asked it and what it answered, read from the tool's
 *     compliance or interaction-history API.
 *
 * Not to be confused with LlmProvider / LlmType, which configure the model
 * OneUptime's own AI features call.
 */
enum LlmConnectionProvider {
  OpenAI = "openai",
  Anthropic = "anthropic",
  AzureOpenAI = "azure-openai",
  AwsBedrock = "aws-bedrock",
  GoogleVertexAI = "google-vertex-ai",
  ClaudeEnterprise = "claude-enterprise",
  Microsoft365Copilot = "microsoft-365-copilot",
}

export default LlmConnectionProvider;

// In the order the Connect page offers them.
export const AllLlmConnectionProviders: Array<LlmConnectionProvider> = [
  LlmConnectionProvider.OpenAI,
  LlmConnectionProvider.Anthropic,
  LlmConnectionProvider.AzureOpenAI,
  LlmConnectionProvider.AwsBedrock,
  LlmConnectionProvider.GoogleVertexAI,
  LlmConnectionProvider.ClaudeEnterprise,
  LlmConnectionProvider.Microsoft365Copilot,
];

export function isLlmConnectionProvider(
  value: unknown,
): value is LlmConnectionProvider {
  return (
    typeof value === "string" &&
    (AllLlmConnectionProviders as Array<string>).includes(value)
  );
}
