/*
 * What an LLM cost budget counts.
 *
 *   - Calls: the cost of the project's AI calls - GenAI spans, or the GenAI
 *     metrics of tools that send no spans (the budget's behaviour before
 *     provider accounts could be connected, and still the default).
 *   - Providers: what the connected AI provider accounts report
 *     (oneuptime.llm.provider.cost): the bill, every app and person
 *     included, whatever sends telemetry.
 *
 * The two count the same calls more than once when both exist, which is why
 * a budget counts one or the other, never both.
 */
enum LlmBudgetSpendSource {
  Calls = "calls",
  Providers = "providers",
}

export default LlmBudgetSpendSource;

export const AllLlmBudgetSpendSources: Array<LlmBudgetSpendSource> = [
  LlmBudgetSpendSource.Calls,
  LlmBudgetSpendSource.Providers,
];

export function isLlmBudgetSpendSource(
  value: unknown,
): value is LlmBudgetSpendSource {
  return (
    typeof value === "string" &&
    (AllLlmBudgetSpendSources as Array<string>).includes(value)
  );
}
