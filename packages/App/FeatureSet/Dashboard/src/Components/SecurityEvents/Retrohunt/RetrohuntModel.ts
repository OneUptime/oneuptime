import {
  CORRELATION_FOUND_NOTHING,
  EVERY_MATCH,
  EXCEPTIONS_PREVENTED,
  EXCEPTIONS_SKIPPED,
  EXCEPTIONS_SKIPPED_NOTHING,
  FIRINGS_A_DAY,
  FOR_ADDRESSES,
  FOR_GROUPS,
  FOR_HOSTS,
  FOR_USERS,
  MATCHING_EVENTS,
  NEAR_MISS,
  NO_MATCHES,
  PERIOD_LAST_DAY,
  PERIOD_LAST_MONTH,
  PERIOD_LAST_WEEK,
  WOULD_HAVE_FIRED,
  WOULD_NOT_HAVE_FIRED,
} from "./RetrohuntCopy";
import { JSONObject } from "Common/Types/JSON";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  DETECTION_RETROHUNT_PERIODS_IN_HOURS,
  DetectionRetrohuntGroup,
  DetectionRetrohuntResult,
  getDetectionRetrohuntFiringsPerDay,
} from "Common/Types/SecurityEvent/DetectionRetrohunt";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * What Run on Past Events says about an answer, worked out without React so
 * a plain test pins it: the headline, the facts under it, what the rule's
 * exceptions did, what each group is called - and the request it sends.
 * Each sentence is a key and its values; the panel puts it into the
 * reader's words (DetectionRuleRetrohuntPanel).
 */

// A sentence to look up: a fixed or plural template, its count and other values.
export interface RetrohuntSentence {
  template: string | PluralTemplate;
  count?: number | undefined;
  values?: Record<string, string | number> | undefined;
}

export function isPluralSentence(
  sentence: RetrohuntSentence,
): sentence is RetrohuntSentence & { template: PluralTemplate } {
  return typeof sentence.template !== "string";
}

// The periods offered, as the choice lists them: the shared order.
const PERIOD_LABELS: Readonly<Record<number, string>> = {
  24: PERIOD_LAST_DAY,
  168: PERIOD_LAST_WEEK,
  720: PERIOD_LAST_MONTH,
};

export interface RetrohuntPeriodOption {
  label: string;
  value: string;
}

export function getRetrohuntPeriodOptions(): Array<RetrohuntPeriodOption> {
  return DETECTION_RETROHUNT_PERIODS_IN_HOURS.map(
    (hours: number): RetrohuntPeriodOption => {
      return { label: PERIOD_LABELS[hours] || `${hours}`, value: `${hours}` };
    },
  );
}

export const RETROHUNT_DEFAULT_PERIOD_IN_HOURS: number =
  DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS;

// The headline: how often it would have fired, or that it would not have.
export function getRetrohuntHeadline(
  result: DetectionRetrohuntResult,
): RetrohuntSentence {
  if (result.firedCount > 0) {
    return { template: WOULD_HAVE_FIRED, count: result.firedCount };
  }

  return { template: WOULD_NOT_HAVE_FIRED };
}

/*
 * What a group of the answer is called by what the rule grouped by: users,
 * hosts or addresses when every group listed is one, groups otherwise.
 */
export function getRetrohuntGroupsNoun(
  groups: ReadonlyArray<DetectionRetrohuntGroup>,
): PluralTemplate {
  const types: Set<string> = new Set(
    groups.map((group: DetectionRetrohuntGroup): string => {
      return group.entityType;
    }),
  );

  if (types.size === 1) {
    if (types.has(SecurityEntityType.User)) {
      return FOR_USERS;
    }

    if (types.has(SecurityEntityType.Host)) {
      return FOR_HOSTS;
    }

    if (types.has(SecurityEntityType.IpAddress)) {
      return FOR_ADDRESSES;
    }
  }

  return FOR_GROUPS;
}

/*
 * Whether the answer is about one group with no value: a single rule with
 * no Group By Field, whose every match is one group. Saying "for 1 group"
 * of it says nothing.
 */
export function isRetrohuntUngrouped(
  result: DetectionRetrohuntResult,
): boolean {
  return (
    !result.isCorrelation &&
    result.groups.length === 1 &&
    result.groups[0]!.value === ""
  );
}

/*
 * The facts under the headline, joined with " · ": how often a day, for
 * how many, out of how many matching events - or, when it would not have
 * fired, how close it came.
 */
export function getRetrohuntFacts(
  result: DetectionRetrohuntResult,
): Array<RetrohuntSentence> {
  const matched: number =
    result.matchedEventCount === null
      ? result.eventCount
      : result.matchedEventCount;

  if (result.firedCount === 0) {
    if (result.isCorrelation) {
      return [{ template: CORRELATION_FOUND_NOTHING }];
    }

    if (matched > 0 && result.threshold !== null) {
      return [
        {
          template: NEAR_MISS,
          count: matched,
          values: { threshold: result.threshold },
        },
      ];
    }

    return [{ template: NO_MATCHES }];
  }

  const facts: Array<RetrohuntSentence> = [];
  const firingsPerDay: number = getDetectionRetrohuntFiringsPerDay(result);

  /*
   * How many a day, over a week or a month: over the last 24 hours it is
   * the headline's count again, and under one a day ("0.1 a day") it says
   * nothing the headline does not.
   */
  if (result.periodInHours > 24 && firingsPerDay >= 1) {
    facts.push({ template: FIRINGS_A_DAY, values: { count: firingsPerDay } });
  }

  if (!isRetrohuntUngrouped(result) && result.groupCount > 0) {
    facts.push({
      template: getRetrohuntGroupsNoun(result.groups),
      count: result.groupCount,
    });
  }

  if (matched > 0) {
    facts.push({ template: MATCHING_EVENTS, count: matched });
  }

  return facts;
}

/*
 * What the rule's exceptions did: the matching events they skipped, and the
 * firings that would have come without them - or that they skipped nothing.
 * Nothing for a rule with no exception that applies, or for a correlation
 * (read once with them, so there is nothing to compare).
 */
export function getRetrohuntExceptionLines(
  result: DetectionRetrohuntResult,
): Array<RetrohuntSentence> {
  if (
    result.exceptionCount === 0 ||
    result.skippedEventCount === null ||
    result.preventedFiredCount === null
  ) {
    return [];
  }

  if (result.skippedEventCount === 0) {
    return [
      { template: EXCEPTIONS_SKIPPED_NOTHING, count: result.exceptionCount },
    ];
  }

  const lines: Array<RetrohuntSentence> = [
    { template: EXCEPTIONS_SKIPPED, count: result.skippedEventCount },
  ];

  if (result.preventedFiredCount > 0) {
    lines.push({
      template: EXCEPTIONS_PREVENTED,
      count: result.preventedFiredCount,
    });
  }

  return lines;
}

// What a group's row says it fired for: its value, or "Every match" for a rule that groups nothing.
export function getRetrohuntGroupLabel(group: DetectionRetrohuntGroup): {
  text: string;
  isKey: boolean;
} {
  return group.value
    ? { text: group.value, isKey: false }
    : { text: EVERY_MATCH, isKey: true };
}

// The groups the list shows: the first few until Show all is pressed.
export const RETROHUNT_GROUPS_SHOWN_FIRST: number = 10;

export function getRetrohuntVisibleGroups(
  groups: ReadonlyArray<DetectionRetrohuntGroup>,
  isShowingAll: boolean,
): Array<DetectionRetrohuntGroup> {
  return isShowingAll
    ? [...groups]
    : groups.slice(0, RETROHUNT_GROUPS_SHOWN_FIRST);
}

/*
 * The rule a run is asked about: a saved rule by its id (its exceptions
 * apply), the rule as a form holds it, or both - the form's values over
 * the saved rule, for an edit.
 */
export interface RetrohuntRuleInput {
  detectionRuleId?: string | undefined;
  sigmaRuleYaml?: string | undefined;
  groupByField?: string | undefined | null;
  distinctCountField?: string | undefined | null;
  matchCountThreshold?: number | string | undefined | null;
  evaluationIntervalInMinutes?: number | string | undefined | null;
}

function readNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number: number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// The request's body (POST /detection-rule/retrohunt).
export function buildRetrohuntRequest(
  rule: RetrohuntRuleInput,
  periodInHours: number,
): JSONObject {
  const body: JSONObject = { periodInHours };

  if (rule.detectionRuleId) {
    body["detectionRuleId"] = rule.detectionRuleId;
  }

  if (typeof rule.sigmaRuleYaml === "string" && rule.sigmaRuleYaml.trim()) {
    body["sigmaRuleYaml"] = rule.sigmaRuleYaml;
    // The form's own counting, empty included: an emptied field is the form's.
    body["groupByField"] = (rule.groupByField || "").trim();
    body["distinctCountField"] = (rule.distinctCountField || "").trim();

    const threshold: number | undefined = readNumber(rule.matchCountThreshold);
    const interval: number | undefined = readNumber(
      rule.evaluationIntervalInMinutes,
    );

    if (threshold !== undefined) {
      body["matchCountThreshold"] = threshold;
    }

    if (interval !== undefined) {
      body["evaluationIntervalInMinutes"] = interval;
    }
  }

  return body;
}

// Whether two requests ask about the same rule, the period aside: a form changed after its run.
export function isSameRetrohuntRule(
  first: JSONObject,
  second: JSONObject,
): boolean {
  const withoutPeriod: (body: JSONObject) => string = (
    body: JSONObject,
  ): string => {
    const copy: JSONObject = { ...body };
    delete copy["periodInHours"];

    return JSON.stringify(
      Object.keys(copy)
        .sort()
        .map((key: string): [string, unknown] => {
          return [key, copy[key]];
        }),
    );
  };

  return withoutPeriod(first) === withoutPeriod(second);
}

// Whether the form holds a rule to run: some YAML, or a saved rule to read it from.
export function canRunRetrohunt(rule: RetrohuntRuleInput): boolean {
  return Boolean(
    (typeof rule.sigmaRuleYaml === "string" && rule.sigmaRuleYaml.trim()) ||
      rule.detectionRuleId,
  );
}
