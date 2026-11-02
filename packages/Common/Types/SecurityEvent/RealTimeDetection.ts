import SigmaRule, { SigmaFieldRequirement, SigmaSelection } from "./SigmaRule";
import { DetectionRuleDefinition } from "./SigmaCorrelation";

/*
 * REAL-TIME DETECTION RULES: a rule that fires on one event can check each
 * event as it reaches OneUptime, instead of every interval.
 *
 * A scheduled rule reads, every minute at most, the events of the last
 * interval up to two minutes ago - room for events still on their way - so
 * a match lands minutes after the event. A real-time rule is checked as
 * every batch of events is written (RealTimeDetections, on every path that
 * writes security events): the events it may match are confirmed by the
 * same query a scheduled run makes, restricted to them, seconds later, and
 * it then alerts, opens cases, writes findings and adds risk as a
 * scheduled run does. It no longer runs on its interval.
 *
 * Only a rule that fires on one event can: it waits for no count of
 * matches, counts no distinct values and reads no events together, and it
 * holds no regular expression, which only the database checks safely.
 * Shared by the server, which refuses any other, and the Dashboard, which
 * says why.
 */

// The most rules one project runs in real time: each is checked against every event it writes.
export const DETECTION_REAL_TIME_RULES_MAX: number = 50;

export const REAL_TIME_CORRELATION_PROBLEM: string =
  "A correlation reads several events together over its timespan, so it runs on its interval.";
export const REAL_TIME_THRESHOLD_PROBLEM: string =
  "It waits for a count of matches, so it runs on its interval: set Match Count Threshold to 1 to run it in real time.";
export const REAL_TIME_DISTINCT_COUNT_PROBLEM: string =
  "It counts different values, so it runs on its interval: clear Distinct Count Field to run it in real time.";
export const REAL_TIME_REGULAR_EXPRESSION_PROBLEM: string =
  "It uses a regular expression (|re), which only runs on a schedule: use contains, startswith or endswith to run it in real time.";

// Whether a rule holds a regular expression anywhere in its detection.
export function doesSigmaRuleUseRegularExpression(rule: SigmaRule): boolean {
  return rule.selections.some((selection: SigmaSelection): boolean => {
    return selection.fieldMaps.some(
      (requirements: Array<SigmaFieldRequirement>): boolean => {
        return requirements.some(
          (requirement: SigmaFieldRequirement): boolean => {
            return requirement.modifiers.includes("re");
          },
        );
      },
    );
  });
}

/*
 * Why a rule cannot run in real time, in a sentence that says what to
 * change - or null when it can.
 */
export function getRealTimeDetectionProblem(data: {
  definition: DetectionRuleDefinition;
  matchCountThreshold?: number | null | undefined;
  distinctCountField?: string | null | undefined;
}): string | null {
  if (data.definition.kind === "correlation") {
    return REAL_TIME_CORRELATION_PROBLEM;
  }

  if ((data.matchCountThreshold ?? 1) > 1) {
    return REAL_TIME_THRESHOLD_PROBLEM;
  }

  if ((data.distinctCountField || "").trim()) {
    return REAL_TIME_DISTINCT_COUNT_PROBLEM;
  }

  if (doesSigmaRuleUseRegularExpression(data.definition.rule)) {
    return REAL_TIME_REGULAR_EXPRESSION_PROBLEM;
  }

  return null;
}
