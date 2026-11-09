import SigmaRule, { SigmaFieldRequirement, SigmaSelection } from "./SigmaRule";
import {
  DetectionRuleDefinition,
  SigmaCorrelationStep,
} from "./SigmaCorrelation";

/*
 * REAL-TIME DETECTION RULES: a rule can check events as they reach
 * OneUptime, instead of every interval.
 *
 * A scheduled rule reads, every minute at most, the events of the last
 * interval up to two minutes ago - room for events still on their way - so
 * a match lands minutes after the event. A real-time rule is checked as
 * every batch of events is written (RealTimeDetections, on every path that
 * writes security events): the events it may match are confirmed by the
 * same query a scheduled run makes, seconds later, and it then alerts,
 * opens cases, writes findings and adds risk as a scheduled run does. It no
 * longer runs on its interval. Two ways, by what the rule waits for:
 *
 *  - A rule that fires on one event (a Match Count Threshold of 1, no
 *    Distinct Count Field): every event it matches is a match.
 *  - A rule that counts - a threshold above 1, a distinct count - and every
 *    correlation: the windows its schedule would read, back to back and as
 *    long as its interval (getRealTimeCountWindow), each checked as its
 *    events arrive. A group fires the moment its window reaches what the
 *    rule waits for, and at most once a window, as on its schedule: real
 *    time changes when a rule fires, never what it fires on. The window's
 *    events are read where the scheduled engine keeps them, in the events
 *    table, with nothing counted anywhere else.
 *
 * Only a rule with a regular expression cannot: only the database checks
 * one safely, so the screen would hand it every event. Shared by the
 * server, which refuses such a rule, and the Dashboard, which says why.
 */

// The most rules one project runs in real time: each is checked against every event it writes.
export const DETECTION_REAL_TIME_RULES_MAX: number = 50;

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
 * The Sigma rules a detection reads: the rule itself, or each rule of a
 * correlation's steps that is resolved - a step that counts reads every
 * rule it counts. A step the file names but does not hold, and that was
 * not resolved against the project's rules, reads none here.
 */
export function getDetectionDefinitionRules(
  definition: DetectionRuleDefinition,
): Array<SigmaRule> {
  if (definition.kind === "single") {
    return [definition.rule];
  }

  return definition.steps.flatMap(
    (step: SigmaCorrelationStep): Array<SigmaRule> => {
      if (step.rule) {
        return [step.rule];
      }

      return step.count ? step.count.rules : [];
    },
  );
}

/*
 * Why a rule cannot run in real time, in a sentence that says what to
 * change - or null when it can. A correlation is held to every rule it
 * reads.
 */
export function getRealTimeDetectionProblem(data: {
  definition: DetectionRuleDefinition;
}): string | null {
  const usesRegularExpression: boolean = getDetectionDefinitionRules(
    data.definition,
  ).some((rule: SigmaRule): boolean => {
    return doesSigmaRuleUseRegularExpression(rule);
  });

  return usesRegularExpression ? REAL_TIME_REGULAR_EXPRESSION_PROBLEM : null;
}

/*
 * Whether a rule in real time counts in windows rather than firing on each
 * event: a correlation, and a single rule that waits for a count of matches
 * or counts distinct values. Thresholds and fields left out are the
 * defaults: one match, no distinct count.
 */
export function doesRealTimeRuleCountInWindows(data: {
  definition: DetectionRuleDefinition;
  matchCountThreshold?: number | string | null | undefined;
  distinctCountField?: string | null | undefined;
}): boolean {
  if (data.definition.kind === "correlation") {
    return true;
  }

  const threshold: number = Number(data.matchCountThreshold ?? 1);

  if (Number.isFinite(threshold) && threshold > 1) {
    return true;
  }

  return Boolean((data.distinctCountField || "").trim());
}

// One window a rule that counts reads in real time: from its start, up to (not including) its end.
export interface RealTimeCountWindow {
  startTime: Date;
  endTime: Date;
}

/*
 * The window a moment falls in, for a rule that counts in real time: the
 * rule's interval, back to back from the Unix epoch, so every process and
 * every job cuts time the same way - a 5-minute rule's windows start at
 * :00, :05, :10, and a group that fired in one fires again only in the
 * next. An interval left out, or under a minute, is a minute.
 */
export function getRealTimeCountWindow(data: {
  time: Date;
  evaluationIntervalInMinutes?: number | null | undefined;
}): RealTimeCountWindow {
  const minutes: number = Math.max(
    1,
    Math.floor(Number(data.evaluationIntervalInMinutes) || 1),
  );
  const length: number = minutes * 60 * 1000;
  const start: number = Math.floor(data.time.getTime() / length) * length;

  return {
    startTime: new Date(start),
    endTime: new Date(start + length),
  };
}
