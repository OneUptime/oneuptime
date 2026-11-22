import { JSONArray, JSONObject, JSONValue } from "../JSON";
import {
  RefusedTelemetry,
  readRefusedTelemetryList,
} from "../../Utils/SecurityEvent/RefusedTelemetry";

/*
 * RETROHUNT: A DETECTION RULE RUN OVER PAST EVENTS.
 *
 * What a new or changed rule would have found had it been running: the
 * rule - as saved, or as it stands in the form, before it is saved - read
 * over the last day, week or month of events, with its exceptions, and
 * counted the way its scheduled runs count. Nothing is opened, sent or
 * written: no case, alert, incident, finding or risk.
 *
 * A single rule is counted in windows as long as its interval, each group
 * firing in a window when its count there reaches the rule's threshold, as
 * its runs fire. A correlation is read over the whole period at once, and
 * names the groups it would have matched.
 *
 * Only the events the project still keeps are read (#10432). A period that
 * starts before the kept events do says where they start (keptFrom): the
 * part before holds only events that arrived late, and an answer about it
 * is never "nothing found". A First seen rule says how much of the history
 * before the period it could see (firstSeenHistory).
 *
 * Shared by the server, which runs it (DetectionRuleRetrohunt), and the
 * Dashboard, which asks for it and draws the answer.
 */

// The periods a retrohunt reads, in hours: the last day, week and month.
export const DETECTION_RETROHUNT_PERIODS_IN_HOURS: ReadonlyArray<number> = [
  24,
  24 * 7,
  24 * 30,
];

export const DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS: number = 24 * 7;

// The groups an answer lists, the ones that fired most first.
export const DETECTION_RETROHUNT_MAX_GROUPS: number = 50;

/*
 * More firings a day than a person can look at: past this the answer says
 * how to make the rule quieter.
 */
export const DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY: number = 20;

export function isDetectionRetrohuntPeriod(value: unknown): value is number {
  return (
    typeof value === "number" &&
    DETECTION_RETROHUNT_PERIODS_IN_HOURS.includes(value)
  );
}

// One value the rule groups by - a user, a host, an address - and what the rule would have done about it.
export interface DetectionRetrohuntGroup {
  // The group's value; '' for a rule that groups nothing (every match one group).
  value: string;
  /*
   * The kind of entity the value is, by the field the rule groups by or by
   * its shape: User, Host, IP Address... ("" when it is none).
   */
  entityType: string;
  // The windows it would have fired in; 1 for a correlation's group.
  firedCount: number;
  // The events behind those firings.
  eventCount: number;
  // The start of the first and the last window it fired in; null for a correlation.
  firstFiredAt: Date | null;
  lastFiredAt: Date | null;
  sampleMessage: string;
  // A correlation's sentence: what happened.
  summary: string;
}

/*
 * What a single rule that counts per value could not count over the period
 * (#10415): the events it matched that had no value for its group field -
 * left out, so they never add up as one value - and how many of them had
 * their client address hidden by a scrub rule, by the kind of record the
 * rule's logs' or traces' Scrub Rules hold.
 */
export interface DetectionRetrohuntUncounted {
  // The rule's Group By Field, as the rule names it: principalIp.
  field: string;
  eventCount: number;
  hiddenInLogsCount: number;
  hiddenInTracesCount: number;
}

/*
 * A First seen rule tells a value is new by the history before the period:
 * its timespan, and how much of that the project still keeps.
 */
export interface DetectionRetrohuntFirstSeenHistory {
  lookbackInSeconds: number;
  // 0: none of it is kept, so it could not tell what was new.
  keptLookbackInSeconds: number;
}

export interface DetectionRetrohuntResult {
  startTime: Date;
  endTime: Date;
  periodInHours: number;
  /*
   * How long the project keeps its security events, and - when the period
   * starts before them - where the kept events start; null when the period
   * is all kept. Null retention: an answer from before it was said.
   */
  retentionInDays: number | null;
  keptFrom: Date | null;
  /*
   * A First seen rule whose history before the period is not all kept:
   * how far back it needed, and how far it could see. Null otherwise.
   */
  firstSeenHistory: DetectionRetrohuntFirstSeenHistory | null;
  isCorrelation: boolean;
  // How long each counting window is: the rule's interval (a single rule).
  windowInMinutes: number;
  /*
   * A single rule's Match Count Threshold: how many matches (or distinct
   * values) a group needs in one window to fire. Null for a correlation,
   * which says how it counts in its own YAML.
   */
  threshold: number | null;
  // Every firing: a window and a group (a single rule), or a group (a correlation).
  firedCount: number;
  // The groups that fired.
  groupCount: number;
  // The events behind every firing.
  eventCount: number;
  /*
   * A single rule's: every event it matched that its exceptions left,
   * whether or not a group reached the threshold with it - so a rule that
   * would not have fired can still say how close it came. Null for a
   * correlation.
   */
  matchedEventCount: number | null;
  // The rule's exceptions the run read with.
  exceptionCount: number;
  /*
   * A single rule's: the events the rule matched that its exceptions
   * skipped, and the firings they prevented. Null for a correlation, which
   * is read once with its exceptions.
   */
  skippedEventCount: number | null;
  preventedFiredCount: number | null;
  // The groups that fired most, at most DETECTION_RETROHUNT_MAX_GROUPS.
  groups: Array<DetectionRetrohuntGroup>;
  // More groups fired than are listed.
  hasMoreGroups: boolean;
  /*
   * A correlation that had more groups to check than it may: the number of
   * most recently active groups it checked (others may have matched too).
   * Null when it checked every group, and for a single rule.
   */
  candidateLimit: number | null;
  /*
   * The events a single rule that counts per value left out, having no
   * value for its group field. Null for a rule that leaves none out - no
   * group field, or one that fires on each event - and for a correlation,
   * which leaves out groups with no value as it always did.
   */
  uncounted: DetectionRetrohuntUncounted | null;
  /*
   * What an ingestion budget or rate refused, over the period, of the logs
   * and traces Security Events reads (#10431): the events those would have
   * made were never stored, so the rule could not have matched them, and a
   * rule that "would not have fired" may only have been blind. Oldest
   * first; empty when nothing was refused.
   */
  refusedTelemetry: Array<RefusedTelemetry>;
}

/*
 * The hours of the period its events are kept for: the whole period, or
 * from where the kept events start - what a rate is worked out over, since
 * the part before holds only the few events that arrived late.
 */
export function getDetectionRetrohuntKeptHours(
  result: Pick<DetectionRetrohuntResult, "periodInHours"> &
    Partial<Pick<DetectionRetrohuntResult, "keptFrom" | "endTime">>,
): number {
  if (!result.keptFrom || !result.endTime) {
    return result.periodInHours;
  }

  const keptHours: number =
    (result.endTime.getTime() - result.keptFrom.getTime()) / (60 * 60 * 1000);

  return Math.max(0, Math.min(result.periodInHours, keptHours));
}

// Firings per day over the period's kept events, rounded to one decimal place.
export function getDetectionRetrohuntFiringsPerDay(
  result: Pick<DetectionRetrohuntResult, "firedCount" | "periodInHours"> &
    Partial<Pick<DetectionRetrohuntResult, "keptFrom" | "endTime">>,
): number {
  const days: number = Math.max(1, getDetectionRetrohuntKeptHours(result) / 24);
  return Math.round((result.firedCount / days) * 10) / 10;
}

// Whether the rule would have fired more often than a person can look at.
export function isDetectionRetrohuntNoisy(
  result: Pick<DetectionRetrohuntResult, "firedCount" | "periodInHours"> &
    Partial<Pick<DetectionRetrohuntResult, "keptFrom" | "endTime">>,
): boolean {
  return (
    getDetectionRetrohuntFiringsPerDay(result) >
    DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY
  );
}

function dateToJSON(date: Date | null): JSONValue {
  return date ? date.toISOString() : null;
}

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readNullableNumber(value: JSONValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return readNumber(value);
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

// What a rule left out, as the API sends it: null for none, or a count of none.
function readUncounted(
  value: JSONValue | undefined,
): DetectionRetrohuntUncounted | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const uncounted: JSONObject = value as JSONObject;
  const eventCount: number = readNumber(uncounted["eventCount"]);

  if (eventCount <= 0) {
    return null;
  }

  return {
    field: readText(uncounted["field"]),
    eventCount,
    hiddenInLogsCount: readNumber(uncounted["hiddenInLogsCount"]),
    hiddenInTracesCount: readNumber(uncounted["hiddenInTracesCount"]),
  };
}

export function detectionRetrohuntResultToJSON(
  result: DetectionRetrohuntResult,
): JSONObject {
  return {
    startTime: dateToJSON(result.startTime),
    endTime: dateToJSON(result.endTime),
    periodInHours: result.periodInHours,
    retentionInDays: result.retentionInDays,
    keptFrom: dateToJSON(result.keptFrom),
    firstSeenHistory: result.firstSeenHistory
      ? {
          lookbackInSeconds: result.firstSeenHistory.lookbackInSeconds,
          keptLookbackInSeconds: result.firstSeenHistory.keptLookbackInSeconds,
        }
      : null,
    isCorrelation: result.isCorrelation,
    windowInMinutes: result.windowInMinutes,
    threshold: result.threshold,
    firedCount: result.firedCount,
    groupCount: result.groupCount,
    eventCount: result.eventCount,
    matchedEventCount: result.matchedEventCount,
    exceptionCount: result.exceptionCount,
    skippedEventCount: result.skippedEventCount,
    preventedFiredCount: result.preventedFiredCount,
    hasMoreGroups: result.hasMoreGroups,
    candidateLimit: result.candidateLimit,
    uncounted: result.uncounted
      ? {
          field: result.uncounted.field,
          eventCount: result.uncounted.eventCount,
          hiddenInLogsCount: result.uncounted.hiddenInLogsCount,
          hiddenInTracesCount: result.uncounted.hiddenInTracesCount,
        }
      : null,
    refusedTelemetry: result.refusedTelemetry.map(
      (refusal: RefusedTelemetry): JSONObject => {
        return { ...refusal } as unknown as JSONObject;
      },
    ),
    groups: result.groups.map((group: DetectionRetrohuntGroup): JSONObject => {
      return {
        value: group.value,
        entityType: group.entityType,
        firedCount: group.firedCount,
        eventCount: group.eventCount,
        firstFiredAt: dateToJSON(group.firstFiredAt),
        lastFiredAt: dateToJSON(group.lastFiredAt),
        sampleMessage: group.sampleMessage,
        summary: group.summary,
      };
    }),
  };
}

// A First seen rule's history, as the API sends it: null for none.
function readFirstSeenHistory(
  value: JSONValue | undefined,
): DetectionRetrohuntFirstSeenHistory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const history: JSONObject = value as JSONObject;
  const lookbackInSeconds: number = readNumber(history["lookbackInSeconds"]);

  if (lookbackInSeconds <= 0) {
    return null;
  }

  return {
    lookbackInSeconds,
    keptLookbackInSeconds: Math.max(
      0,
      Math.min(lookbackInSeconds, readNumber(history["keptLookbackInSeconds"])),
    ),
  };
}

// A whole number of days, or null for none.
function readRetentionInDays(value: JSONValue | undefined): number | null {
  const days: number = readNumber(value);
  return days > 0 ? days : null;
}

// The answer as the API sends it, read defensively.
export function parseDetectionRetrohuntResult(
  json: JSONObject,
): DetectionRetrohuntResult {
  const groups: JSONArray = Array.isArray(json["groups"])
    ? (json["groups"] as JSONArray)
    : [];

  return {
    startTime: readDate(json["startTime"]) || new Date(0),
    endTime: readDate(json["endTime"]) || new Date(0),
    periodInHours: readNumber(json["periodInHours"]),
    retentionInDays: readRetentionInDays(json["retentionInDays"]),
    keptFrom: readDate(json["keptFrom"]),
    firstSeenHistory: readFirstSeenHistory(json["firstSeenHistory"]),
    isCorrelation: json["isCorrelation"] === true,
    windowInMinutes: readNumber(json["windowInMinutes"]),
    threshold: readNullableNumber(json["threshold"]),
    firedCount: readNumber(json["firedCount"]),
    groupCount: readNumber(json["groupCount"]),
    eventCount: readNumber(json["eventCount"]),
    matchedEventCount: readNullableNumber(json["matchedEventCount"]),
    exceptionCount: readNumber(json["exceptionCount"]),
    skippedEventCount: readNullableNumber(json["skippedEventCount"]),
    preventedFiredCount: readNullableNumber(json["preventedFiredCount"]),
    hasMoreGroups: json["hasMoreGroups"] === true,
    candidateLimit: readNullableNumber(json["candidateLimit"]),
    uncounted: readUncounted(json["uncounted"]),
    refusedTelemetry: readRefusedTelemetryList(json["refusedTelemetry"]),
    groups: groups
      .filter((item: JSONValue): boolean => {
        return (
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
        );
      })
      .map((item: JSONValue): DetectionRetrohuntGroup => {
        const group: JSONObject = item as JSONObject;

        return {
          value: readText(group["value"]),
          entityType: readText(group["entityType"]),
          firedCount: readNumber(group["firedCount"]),
          eventCount: readNumber(group["eventCount"]),
          firstFiredAt: readDate(group["firstFiredAt"]),
          lastFiredAt: readDate(group["lastFiredAt"]),
          sampleMessage: readText(group["sampleMessage"]),
          summary: readText(group["summary"]),
        };
      }),
  };
}
