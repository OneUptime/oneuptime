import {
  LlmUsageFigures,
  LlmUsageSource,
} from "Common/Types/Telemetry/LlmUsageApi";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHERE A USAGE FIGURE CAME FROM, IN PLAIN WORDS.
 *
 * The Usage tab counts each service from the signal it sends (LlmUsageUtil):
 * its AI calls (GenAI spans) where they report the figure, its usage metrics
 * (GenAI metrics) where they do not. So a figure is from AI calls, from
 * usage metrics, or - added up over services that send different ones -
 * from both. The tiles say it under each figure, and the breakdown under
 * each row that is not from AI calls alone.
 */
export const LLM_USAGE_SOURCE_WORDS: Record<LlmUsageSource, string> = {
  [LlmUsageSource.Calls]: translationKey("From AI calls"),
  [LlmUsageSource.Metrics]: translationKey("From usage metrics"),
  [LlmUsageSource.Both]: translationKey("From AI calls and usage metrics"),
  [LlmUsageSource.None]: "",
};

// One source for a row's tokens and cost together.
export function getLlmUsageRowSource(
  figures: Pick<LlmUsageFigures, "tokenSource" | "costSource">,
): LlmUsageSource {
  const sources: Array<LlmUsageSource> = [
    figures.tokenSource,
    figures.costSource,
  ].filter((source: LlmUsageSource): boolean => {
    return source !== LlmUsageSource.None;
  });

  const fromCalls: boolean = sources.some((source: LlmUsageSource) => {
    return source === LlmUsageSource.Calls || source === LlmUsageSource.Both;
  });
  const fromMetrics: boolean = sources.some((source: LlmUsageSource) => {
    return source === LlmUsageSource.Metrics || source === LlmUsageSource.Both;
  });

  if (fromCalls && fromMetrics) {
    return LlmUsageSource.Both;
  }

  if (fromMetrics) {
    return LlmUsageSource.Metrics;
  }

  return fromCalls ? LlmUsageSource.Calls : LlmUsageSource.None;
}

// Whether a figure was counted, in part or in whole, from usage metrics.
export function isFromUsageMetrics(source: LlmUsageSource): boolean {
  return source === LlmUsageSource.Metrics || source === LlmUsageSource.Both;
}
