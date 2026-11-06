import {
  REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
  doesRealTimeRuleCountInWindows,
  getRealTimeDetectionProblem,
} from "Common/Types/SecurityEvent/RealTimeDetection";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * RUN IN REAL TIME on the rule form: whether the form's rule checks events
 * as they arrive, whether - so - it counts in windows of its interval
 * (Common/Types/SecurityEvent/RealTimeDetection), and, while the switch is
 * on, why the rule as it stands cannot, said under the switch before the
 * rule is saved, in the reader's language. The sentence is the one the
 * server refuses such a rule with, saying what to change.
 *
 * React-free, so it is pinned in plain tests.
 */

/*
 * Common's sentences, as keys the extractor reads (it does not read
 * Common/Types). A test holds them to Common's, word for word.
 */
export const REAL_TIME_PROBLEM_KEYS: Readonly<Record<string, string>> = {
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

// Whether the form's rule checks events as they arrive (a switch Postgres may hand back as "true").
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

// The form's YAML, parsed - or null while it does not read (its own field says why).
function readDefinition(
  values: RealTimeFormValues,
): DetectionRuleDefinition | null {
  const yaml: unknown = values.sigmaRuleYaml;

  if (typeof yaml !== "string" || !yaml.trim()) {
    return null;
  }

  try {
    return SigmaRuleSetParser.parse(yaml);
  } catch {
    return null;
  }
}

/*
 * Whether the form's rule, in real time, counts in windows of its interval
 * - a correlation, or a rule with a threshold above 1 or a distinct count -
 * so its interval still matters. A rule whose YAML does not read yet is
 * taken to: the interval stays on the form until the YAML says otherwise.
 */
export function countsInWindows(values: RealTimeFormValues): boolean {
  const definition: DetectionRuleDefinition | null = readDefinition(values);

  if (!definition) {
    return true;
  }

  return doesRealTimeRuleCountInWindows({
    definition,
    matchCountThreshold: readThreshold(values.matchCountThreshold),
    distinctCountField:
      typeof values.distinctCountField === "string"
        ? values.distinctCountField
        : undefined,
  });
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
  if (!runsInRealTime(values)) {
    return null;
  }

  const definition: DetectionRuleDefinition | null = readDefinition(values);

  if (!definition) {
    return null;
  }

  const problem: string | null = getRealTimeDetectionProblem({ definition });

  if (!problem) {
    return null;
  }

  const key: string = REAL_TIME_PROBLEM_KEYS[problem] || problem;

  return translator.translateText(key) || key;
}
