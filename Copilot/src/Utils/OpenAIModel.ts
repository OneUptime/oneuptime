/** Determines when OpenAI's Responses API must be used. */
export function requiresOpenAIResponsesEndpoint(
  modelName: string | undefined,
): boolean {
  if (!modelName) {
    return false;
  }

  const normalized: string = modelName.toLowerCase();
  return (
    normalized.includes("gpt-5") ||
    normalized.includes("gpt-4.1") ||
    normalized.includes("codex")
  );
}
