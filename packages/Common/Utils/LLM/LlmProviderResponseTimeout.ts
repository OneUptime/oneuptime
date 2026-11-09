import LlmType from "../../Types/LLM/LlmType";

/*
 * How long OneUptime waits for an LLM provider to answer one request when
 * the provider's Response Timeout (LlmProvider.requestTimeoutInSeconds) is
 * left empty: 300 seconds for Ollama, which runs on its owner's own
 * hardware, and 120 for every other provider (issue #6438).
 *
 * Plain values with no server dependency: LLMService waits this long, and
 * the provider's page says so ("120 (default)"), so the two never differ.
 */
export const LLM_PROVIDER_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS: number = 120;
export const OLLAMA_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS: number = 300;

export function getLlmProviderDefaultResponseTimeoutInSeconds(
  llmType: LlmType | null | undefined,
): number {
  return llmType === LlmType.Ollama
    ? OLLAMA_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS
    : LLM_PROVIDER_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS;
}
