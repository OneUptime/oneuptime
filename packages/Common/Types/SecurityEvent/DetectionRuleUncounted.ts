import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT A DETECTION RULE COULD NOT COUNT, WHERE IT IS LISTED (#10547).
 *
 * A rule that counts per value - a Group By Field with a threshold above
 * one, or a distinct count - leaves out the events that have no value for
 * its field (#10415, DetectionUncountedEvents): they are no value it can
 * count. Run on Past Events says so. A rule's row on Detection Rules says
 * it too now, for the last day, with how many a scrub rule hid - and a
 * rule that could count none of what it matched says that plainly, since
 * it cannot fire.
 *
 * POST /detection-rule/uncounted answers for the rules a page lists
 * (Server/Utils/SecurityEvent/DetectionRuleUncounted): only those that
 * leave events out and left some out in the last day. Its JSON is written
 * and read here, so the server and the page agree on it.
 */

export const DETECTION_RULE_UNCOUNTED_PATH: string =
  "/detection-rule/uncounted";

// The period a rule's row speaks of: the last day.
export const DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS: number = 24;

// The most rules one ask names: a page of Detection Rules.
export const MAX_DETECTION_RULES_UNCOUNTED_PER_ASK: number = 50;

export interface DetectionRuleUncounted {
  detectionRuleId: string;
  // The rule's Group By Field, as the rule names it: principalIp.
  field: string;
  // The events it matched in the period, its exceptions applied.
  matchedCount: number;
  // Of those, the ones with no value for its field: it could not count them.
  uncountedCount: number;
  // Of those, the ones whose value a scrub rule hid, in logs and in traces.
  hiddenInLogsCount: number;
  hiddenInTracesCount: number;
}

export interface DetectionRulesUncounted {
  periodInHours: number;
  // Only the rules that left events out: a rule not named left none out.
  rules: Array<DetectionRuleUncounted>;
}

/*
 * Whether a rule could count none of what it matched: every event had no
 * value for its field. Such a rule cannot fire, so its row says so plainly.
 */
export function didRuleCountNothing(
  uncounted: DetectionRuleUncounted,
): boolean {
  return (
    uncounted.uncountedCount > 0 &&
    uncounted.uncountedCount >= uncounted.matchedCount
  );
}

// How many of what it could not count a scrub rule hid.
export function getUncountedHiddenCount(
  uncounted: DetectionRuleUncounted,
): number {
  return uncounted.hiddenInLogsCount + uncounted.hiddenInTracesCount;
}

export function detectionRulesUncountedToJSON(
  answer: DetectionRulesUncounted,
): JSONObject {
  return {
    periodInHours: answer.periodInHours,
    rules: answer.rules.map((rule: DetectionRuleUncounted): JSONObject => {
      return {
        detectionRuleId: rule.detectionRuleId,
        field: rule.field,
        matchedCount: rule.matchedCount,
        uncountedCount: rule.uncountedCount,
        hiddenInLogsCount: rule.hiddenInLogsCount,
        hiddenInTracesCount: rule.hiddenInTracesCount,
      };
    }),
  };
}

function readCount(value: JSONValue | undefined): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * What the server answered, read: a rule it cannot read, or that left
 * nothing out, is left out. A hidden count never says more than it could
 * not count, nor that more were left out than it matched.
 */
export function readDetectionRulesUncounted(
  value: JSONValue | undefined,
): DetectionRulesUncounted {
  const data: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};
  const rules: Array<DetectionRuleUncounted> = [];

  for (const item of Array.isArray(data["rules"]) ? data["rules"] : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const rule: JSONObject = item as JSONObject;
    const detectionRuleId: string = readText(rule["detectionRuleId"]);
    const field: string = readText(rule["field"]);
    const uncountedCount: number = readCount(rule["uncountedCount"]);

    if (!detectionRuleId || !field || uncountedCount <= 0) {
      continue;
    }

    const hiddenInLogsCount: number = Math.min(
      uncountedCount,
      readCount(rule["hiddenInLogsCount"]),
    );

    rules.push({
      detectionRuleId,
      field,
      matchedCount: Math.max(uncountedCount, readCount(rule["matchedCount"])),
      uncountedCount,
      hiddenInLogsCount,
      hiddenInTracesCount: Math.min(
        uncountedCount - hiddenInLogsCount,
        readCount(rule["hiddenInTracesCount"]),
      ),
    });
  }

  const periodInHours: number = readCount(data["periodInHours"]);

  return {
    periodInHours: periodInHours || DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS,
    rules,
  };
}
