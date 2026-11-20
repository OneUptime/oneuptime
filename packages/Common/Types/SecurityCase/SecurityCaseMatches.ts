import { SECURITY_CASE_CONTEXT_API_PATH } from "./SecurityCaseContext";
import {
  SecurityCaseEventSnapshot,
  readSecurityCaseEventSnapshot,
} from "./SecurityCaseEventEvidence";
import { JSONObject, JSONValue } from "../JSON";
import {
  DetectionRuleResponseStep,
  readDetectionRuleResponseSteps,
} from "../SecurityEvent/DetectionRuleResponseSteps";
import {
  SecurityEntity,
  inferSecurityEntityType,
  securityEntityTypeForField,
} from "./SecurityEntity";

/*
 * WHY A CASE WAS OPENED, AND WHAT MATCHED.
 *
 * A case's Overview said "Detection rule Path traversal attempts matched 12
 * security events" and showed one sample, and the twelve were nowhere on
 * the case (#9556). This is what the case's detections actually matched,
 * read again from the events table with the reader's own permissions:
 *
 *   - for a detection rule: the rule as it counts - its threshold, what it
 *     groups by, how long a window it counts in - and the events its
 *     condition matches for the detection's group over the time it fired,
 *     each with the request, log line, trace, span and session it came
 *     from, so the case links to all of them;
 *   - for a threat-intel match: the events carrying the indicator;
 *   - for an alert a connected product raised: the event it was recorded as;
 *   - for anything else (an entity's risk, Data Security, a rule that is
 *     gone): the events naming what the detection is about, said to be so.
 *
 * Shared by the server (Server/Utils/SecurityCase/Context/
 * SecurityCaseMatches.ts), which reads it, and the Dashboard, which draws
 * it on the case's Overview and builds the case's response plan from it.
 * Free of anything server-only and of React.
 *
 *   POST /security-case-context/matches   { caseId }
 */
export const SECURITY_CASE_MATCHES_API_PATH: string = `${SECURITY_CASE_CONTEXT_API_PATH}/matches`;

// The most detections an answer explains: the one that opened the case first.
export const SECURITY_CASE_MATCHES_MAX_DETECTIONS: number = 5;

// The most events listed for one detection; how many matched is counted apart.
export const SECURITY_CASE_MATCHES_MAX_EVENTS: number = 25;

/*
 * The time either side of a detection's firings its events are read over,
 * for one that does not say how long a window it counts in (a feed's, a
 * connected product's).
 */
export const SECURITY_CASE_MATCHES_PADDING_IN_MINUTES: number = 5;

// The longest stretch of time one detection's events are read over.
export const SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS: number = 24;

// The most values a rule is shown to look for, and the longest of them.
export const SECURITY_CASE_MATCHES_MAX_LOOK_FOR: number = 20;
export const SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH: number = 100;

// The most false positives and references kept from a rule's YAML.
export const SECURITY_CASE_MATCHES_MAX_GUIDANCE_LINES: number = 10;
export const SECURITY_CASE_MATCHES_GUIDANCE_MAX_LENGTH: number = 300;

/*
 * How a detection's events were found, so the page says what they are:
 * exactly what it matched, or what it is about.
 */
export enum SecurityCaseMatchBasis {
  // The rule's own condition, for the detection's group, over its windows.
  RuleCondition = "RuleCondition",
  /*
   * A correlation's steps, for the detection's group as the correlation's
   * own group-by groups them, over the window its runs read (#9939).
   */
  CorrelationSteps = "CorrelationSteps",
  // The events that carry the indicator a threat-intel feed listed.
  Indicator = "Indicator",
  // The event the detection was recorded as: a connected product's alert.
  RecordedEvent = "RecordedEvent",
  // The events naming what the detection is about, around when it fired.
  NamedEntities = "NamedEntities",
}

export const SECURITY_CASE_MATCH_BASES: ReadonlyArray<SecurityCaseMatchBasis> =
  [
    SecurityCaseMatchBasis.RuleCondition,
    SecurityCaseMatchBasis.CorrelationSteps,
    SecurityCaseMatchBasis.Indicator,
    SecurityCaseMatchBasis.RecordedEvent,
    SecurityCaseMatchBasis.NamedEntities,
  ];

// Where the answer's facts come from: each read on its own, said when it could not be.
export enum SecurityCaseMatchesSource {
  Detections = "Detections",
  Rules = "Rules",
  Events = "Events",
}

export const SECURITY_CASE_MATCHES_SOURCES: ReadonlyArray<SecurityCaseMatchesSource> =
  [
    SecurityCaseMatchesSource.Detections,
    SecurityCaseMatchesSource.Rules,
    SecurityCaseMatchesSource.Events,
  ];

// What a rule's condition looks for in one field: the values it matches on.
export interface SecurityCaseMatchLookForJson {
  // The field as the rule names it ("targetResource", "CommandLine").
  field: string;
  // Literal text the field holds when the rule matches: "../", "/etc/passwd".
  values: Array<string>;
}

// The detection rule behind a detection, as it counts.
export interface SecurityCaseMatchRuleJson {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  isRealTime: boolean;
  isCorrelation: boolean;
  /*
   * A single rule fires when one group reaches its threshold of matches -
   * or of distinct values of distinctCountField - within one window of
   * windowInMinutes. A correlation counts by its own YAML (sigmaRuleYaml).
   */
  threshold: number;
  groupByField: string;
  distinctCountField: string;
  windowInMinutes: number;
  sigmaRuleYaml: string;
  // The rule's own guidance, from its Sigma YAML's falsepositives and references.
  falsePositives: Array<string>;
  references: Array<string>;
  lookFor: Array<SecurityCaseMatchLookForJson>;
  /*
   * What to do when it fires, in its author's words (#9621): the case's
   * Response Plan shows them ahead of its general steps. A Rule Library
   * rule added before rules had steps reads its library entry's.
   */
  responseSteps: Array<DetectionRuleResponseStep>;
}

/*
 * One event a detection matched: the event as the case's Evidence keeps one
 * (its who, what and where, and its source attributes), with the request it
 * happened in - its trace, span, session and how far it got.
 */
export interface SecurityCaseMatchedEventJson
  extends SecurityCaseEventSnapshot {
  /*
   * When the events table deletes the event, as an ISO string, for an
   * event the detection kept (#9619); "" or none where it is not known.
   */
  retentionDate?: string | undefined;
}

export interface SecurityCaseMatchedDetectionJson {
  id: string;
  // SecurityDetectionSource.
  source: string;
  title: string;
  severity: string;
  // What the detection is about: the value its rule or feed grouped on.
  groupValue: string;
  ruleName: string;
  // The detection's own counts, as its firings added them up.
  eventCount: number;
  fireCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sampleMessage: string;
  // The detection that opened the case: the first to fire.
  isOpening: boolean;
  // Its rule, when it is a rule's and the reader may read the rule.
  rule: SecurityCaseMatchRuleJson | null;
  threatIntelFeedId: string;
  securityEventConnectionId: string;
  basis: SecurityCaseMatchBasis;
  // The time its events were read over; null when none were read.
  windowStart: string | null;
  windowEnd: string | null;
  // The events, oldest first, at most SECURITY_CASE_MATCHES_MAX_EVENTS.
  events: Array<SecurityCaseMatchedEventJson>;
  /*
   * The events are the ones the detection kept when it fired (#9619):
   * exactly what it matched then, whatever its rule says now. False for
   * one that kept none - it fired before OneUptime kept events, or its
   * source keeps none - whose events were read again.
   */
  isKept: boolean;
  // Of the events listed, the ones past the events table's retention: shown as kept.
  keptPastRetentionCount: number;
  // The events it kept of sources the reader's role cannot read: not listed.
  hiddenEventCount: number;
  /*
   * How many events matched over the window, and how many of them took
   * each request outcome ("" for those no request was followed for). Null
   * when the events could not be read.
   */
  matchedEventCount: number | null;
  outcomes: Record<string, number>;
}

export interface SecurityCaseMatchesJson {
  // The detections explained, the one that opened the case first, then the latest.
  detections: Array<SecurityCaseMatchedDetectionJson>;
  // Every detection on the case, explained or not.
  detectionCount: number;
  unreadableSources: Array<SecurityCaseMatchesSource>;
  failedSources: Array<SecurityCaseMatchesSource>;
}

// ---------- Reading an answer ----------

function readString(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function readNullableNumber(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function readTime(value: JSONValue | undefined): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function readStrings(value: JSONValue | undefined): Array<string> {
  const strings: Array<string> = [];

  if (!Array.isArray(value)) {
    return strings;
  }

  for (const item of value as Array<JSONValue>) {
    if (typeof item === "string" && item.length > 0) {
      strings.push(item);
    }
  }

  return strings;
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readEnumList<T extends string>(
  value: JSONValue | undefined,
  allowed: ReadonlyArray<T>,
): Array<T> {
  return readStrings(value).filter((item: string): item is T => {
    return (allowed as ReadonlyArray<string>).includes(item);
  });
}

function readLookFor(
  value: JSONValue | undefined,
): Array<SecurityCaseMatchLookForJson> {
  if (!Array.isArray(value)) {
    return [];
  }

  const list: Array<SecurityCaseMatchLookForJson> = [];

  for (const item of value) {
    const record: JSONObject | null = readObject(item);
    const field: string = record ? readString(record["field"]) : "";
    const values: Array<string> = record ? readStrings(record["values"]) : [];

    if (field && values.length > 0) {
      list.push({ field, values });
    }
  }

  return list;
}

export function parseSecurityCaseMatchRule(
  value: JSONValue | undefined,
): SecurityCaseMatchRuleJson | null {
  const record: JSONObject | null = readObject(value);
  const id: string = record ? readString(record["id"]) : "";

  if (!record || !id) {
    return null;
  }

  return {
    id,
    name: readString(record["name"]),
    description: readString(record["description"]),
    isEnabled: record["isEnabled"] === true,
    isRealTime: record["isRealTime"] === true,
    isCorrelation: record["isCorrelation"] === true,
    threshold: Math.max(1, Math.trunc(readNumber(record["threshold"]))),
    groupByField: readString(record["groupByField"]),
    distinctCountField: readString(record["distinctCountField"]),
    windowInMinutes: Math.max(
      1,
      Math.trunc(readNumber(record["windowInMinutes"])),
    ),
    sigmaRuleYaml: readString(record["sigmaRuleYaml"]),
    falsePositives: readStrings(record["falsePositives"]),
    references: readStrings(record["references"]),
    lookFor: readLookFor(record["lookFor"]),
    responseSteps: readDetectionRuleResponseSteps(record["responseSteps"]),
  };
}

function readOutcomes(value: JSONValue | undefined): Record<string, number> {
  const record: JSONObject | null = readObject(value);
  const outcomes: Record<string, number> = {};

  if (!record) {
    return outcomes;
  }

  for (const key of Object.keys(record)) {
    const count: number = readNumber(record[key]);

    if (count > 0) {
      outcomes[key] = Math.trunc(count);
    }
  }

  return outcomes;
}

function readEvents(
  value: JSONValue | undefined,
): Array<SecurityCaseMatchedEventJson> {
  if (!Array.isArray(value)) {
    return [];
  }

  const events: Array<SecurityCaseMatchedEventJson> = [];

  for (const item of value) {
    const snapshot: SecurityCaseEventSnapshot | null =
      readSecurityCaseEventSnapshot(item);

    if (snapshot) {
      const retentionDate: string | null = readTime(
        readObject(item)?.["retentionDate"],
      );

      events.push(retentionDate ? { ...snapshot, retentionDate } : snapshot);
    }
  }

  return events;
}

/*
 * The route's answer, read defensively: a field an older server left out,
 * or one of the wrong shape, reads as nothing.
 */
export function parseSecurityCaseMatches(
  json: JSONObject | null | undefined,
): SecurityCaseMatchesJson {
  const body: JSONObject = json || {};
  const detections: Array<SecurityCaseMatchedDetectionJson> = [];

  for (const item of Array.isArray(body["detections"])
    ? body["detections"]
    : []) {
    const record: JSONObject | null = readObject(item);
    const id: string = record ? readString(record["id"]) : "";

    if (!record || !id) {
      continue;
    }

    const basis: string = readString(record["basis"]);

    detections.push({
      id,
      source: readString(record["source"]),
      title: readString(record["title"]),
      severity: readString(record["severity"]),
      groupValue: readString(record["groupValue"]),
      ruleName: readString(record["ruleName"]),
      eventCount: Math.trunc(readNumber(record["eventCount"])),
      fireCount: Math.max(1, Math.trunc(readNumber(record["fireCount"]))),
      firstSeenAt: readTime(record["firstSeenAt"]),
      lastSeenAt: readTime(record["lastSeenAt"]),
      sampleMessage: readString(record["sampleMessage"]),
      isOpening: record["isOpening"] === true,
      rule: parseSecurityCaseMatchRule(record["rule"]),
      threatIntelFeedId: readString(record["threatIntelFeedId"]),
      securityEventConnectionId: readString(
        record["securityEventConnectionId"],
      ),
      basis: (SECURITY_CASE_MATCH_BASES as ReadonlyArray<string>).includes(
        basis,
      )
        ? (basis as SecurityCaseMatchBasis)
        : SecurityCaseMatchBasis.NamedEntities,
      windowStart: readTime(record["windowStart"]),
      windowEnd: readTime(record["windowEnd"]),
      events: readEvents(record["events"]),
      isKept: record["isKept"] === true,
      keptPastRetentionCount: Math.trunc(
        readNumber(record["keptPastRetentionCount"]),
      ),
      hiddenEventCount: Math.trunc(readNumber(record["hiddenEventCount"])),
      matchedEventCount: readNullableNumber(record["matchedEventCount"]),
      outcomes: readOutcomes(record["outcomes"]),
    });
  }

  return {
    detections,
    detectionCount: Math.max(
      detections.length,
      Math.trunc(readNumber(body["detectionCount"])),
    ),
    unreadableSources: readEnumList(
      body["unreadableSources"],
      SECURITY_CASE_MATCHES_SOURCES,
    ),
    failedSources: readEnumList(
      body["failedSources"],
      SECURITY_CASE_MATCHES_SOURCES,
    ),
  };
}

// The detection that opened the case, or the first explained.
export function getOpeningMatchedDetection(
  matches: Pick<SecurityCaseMatchesJson, "detections">,
): SecurityCaseMatchedDetectionJson | null {
  return (
    matches.detections.find(
      (detection: SecurityCaseMatchedDetectionJson): boolean => {
        return detection.isOpening;
      },
    ) ||
    matches.detections[0] ||
    null
  );
}

/*
 * The entity a detection is about, typed by the field its rule groups by or
 * by its shape. Null for a detection grouped on nothing, or on several
 * values at once ("a / b").
 */
export function getDetectionEntity(
  detection: Pick<SecurityCaseMatchedDetectionJson, "groupValue" | "rule">,
): SecurityEntity | null {
  const value: string = detection.groupValue.trim();

  if (!value || value.includes(" / ")) {
    return null;
  }

  return {
    type:
      securityEntityTypeForField(detection.rule?.groupByField) ||
      inferSecurityEntityType(value),
    value,
  };
}
