import {
  REAL_TIME_CORRELATION_PROBLEM,
  REAL_TIME_DISTINCT_COUNT_PROBLEM,
  REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
  REAL_TIME_THRESHOLD_PROBLEM,
  getRealTimeDetectionProblem,
} from "Common/Types/SecurityEvent/RealTimeDetection";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * RUN IN REAL TIME on the rule form: whether the form's rule checks each
 * event as it arrives, and - while the switch is on - why the rule as it
 * stands cannot, said under the switch before the rule is saved, in the
 * reader's language. The sentences are the ones the server refuses such a
 * rule with (Common/Types/SecurityEvent/RealTimeDetection), each saying
 * what to change.
 *
 * React-free, so it is pinned in plain tests.
 */

/*
 * Common's sentences, as keys the extractor reads (it does not read
 * Common/Types). A test holds them to Common's, word for word.
 */
export const REAL_TIME_PROBLEM_KEYS: Readonly<Record<string, string>> = {
  [REAL_TIME_CORRELATION_PROBLEM]: translationKey(
    "A correlation reads several events together over its timespan, so it runs on its interval.",
  ),
  [REAL_TIME_THRESHOLD_PROBLEM]: translationKey(
    "It waits for a count of matches, so it runs on its interval: set Match Count Threshold to 1 to run it in real time.",
  ),
  [REAL_TIME_DISTINCT_COUNT_PROBLEM]: translationKey(
    "It counts different values, so it runs on its interval: clear Distinct Count Field to run it in real time.",
  ),
  [REAL_TIME_REGULAR_EXPRESSION_PROBLEM]: translationKey(
    "It uses a regular expression (|re), which only runs on a schedule: use contains, startswith or endswith to run it in real time.",
  ),
};

// What the rule form holds that real time depends on.
export interface RealTimeFormValues {
  sigmaRuleYaml?: unknown;
  matchCountThreshold?: unknown;
  distinctCountField?: unknown;
  isRealTime?: unknown;
}

// Whether the form's rule checks each event as it arrives (a switch Postgres may hand back as "true").
export function runsInRealTime(values: RealTimeFormValues): boolean {
  return values.isRealTime === true || values.isRealTime === "true";
}

// The threshold as the server reads it: a number, or what a number field holds as text.
function readThreshold(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed: number = Number(value);

    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

/*
 * Why the form's rule cannot run in real time, in the reader's words, or
 * null - while Run in Real Time is off, when it can, and while its YAML
 * does not read (the YAML field says what is wrong with it).
 */
export function getRealTimeFormProblem(
  values: RealTimeFormValues,
  translator: Translator,
): string | null {
  const yaml: unknown = values.sigmaRuleYaml;

  if (!runsInRealTime(values) || typeof yaml !== "string" || !yaml.trim()) {
    return null;
  }

  let definition: DetectionRuleDefinition;

  try {
    definition = SigmaRuleSetParser.parse(yaml);
  } catch {
    return null;
  }

  const problem: string | null = getRealTimeDetectionProblem({
    definition,
    matchCountThreshold: readThreshold(values.matchCountThreshold),
    distinctCountField:
      typeof values.distinctCountField === "string"
        ? values.distinctCountField
        : undefined,
  });

  if (!problem) {
    return null;
  }

  const key: string = REAL_TIME_PROBLEM_KEYS[problem] || problem;

  return translator.translateText(key) || key;
}
