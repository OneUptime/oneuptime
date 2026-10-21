import BadDataException from "../../Types/Exception/BadDataException";
import { MetricPipelineRuleFilterConditionType } from "../../Types/Metrics/MetricPipelineRuleFilterCondition";
import { getRegexSyntaxErrorReason } from "../../Types/Telemetry/ScrubRule";
import {
  describePatternProblem,
  getLinearRegExp,
} from "../../Utils/LinearRegExp/PatternCache";

/*
 * Save-time validation of a metric pipeline rule's regex filters.
 *
 * A Matches Regex or Does Not Match Regex filter is matched, on the ingest
 * every project shares, with the linear-time matcher
 * (Utils/LinearRegExp) - JavaScript's syntax and answers, in time in line
 * with the metric name or attribute value. A pattern it cannot run - one
 * that is not a regular expression, refers back to a group (\1), or is too
 * large - never matched anything: ingest treats such a filter as one that
 * matches nothing. The person writing the rule is told when they save it,
 * with what to change, rather than finding the rule never applies.
 *
 * Only the filters a create or an update sends are judged: an update that
 * leaves the filters alone - a rename, switching the rule off - is never
 * held up by a filter saved before this check.
 */

const REGEX_CONDITIONS: ReadonlyArray<string> = [
  MetricPipelineRuleFilterConditionType.MatchesRegex,
  MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
];

/*
 * Why a rule's filters cannot be saved - "Filter 2: the pattern refers back
 * to ..." - or null when every regex filter can run.
 */
export function getMetricPipelineRuleFiltersRefusal(
  filters: unknown,
): string | null {
  if (!Array.isArray(filters)) {
    return null;
  }

  for (let index: number = 0; index < filters.length; index++) {
    const filter: unknown = filters[index];

    if (!filter || typeof filter !== "object") {
      continue;
    }

    const conditionType: unknown = (filter as Record<string, unknown>)[
      "conditionType"
    ];
    const value: unknown = (filter as Record<string, unknown>)["value"];

    if (
      typeof conditionType !== "string" ||
      !REGEX_CONDITIONS.includes(conditionType) ||
      typeof value !== "string"
    ) {
      continue;
    }

    try {
      getLinearRegExp(value);
    } catch (error: unknown) {
      const problem: string | null = describePatternProblem(error);

      if (problem !== null) {
        return `Filter ${index + 1}: the pattern ${problem}`;
      }

      return `Filter ${index + 1}: the pattern is not a valid regular expression (${getRegexSyntaxErrorReason(error)}), so the filter would never match. Fix the pattern.`;
    }
  }

  return null;
}

// Throws the refusal, if any, for the filters a create or an update sends.
export function validateMetricPipelineRuleFilters(filters: unknown): void {
  const refusal: string | null = getMetricPipelineRuleFiltersRefusal(filters);

  if (refusal !== null) {
    throw new BadDataException(refusal);
  }
}
