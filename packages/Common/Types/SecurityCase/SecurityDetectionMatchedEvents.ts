import {
  SecurityCaseEventSnapshot,
  buildSecurityCaseEventSnapshot,
} from "./SecurityCaseEventEvidence";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "./SecurityConnection";
import { SECURITY_REQUEST_ATTRIBUTES } from "../SecurityEvent/SecurityEventRequestOutcome";
import {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SECURITY_LOG_ID_ATTRIBUTE,
} from "../SecurityEvent/SecurityLogFormat";

/*
 * THE EVENTS A DETECTION MATCHED, KEPT WHEN IT FIRED (#9619).
 *
 * A case's "Why This Case Was Opened" card listed a detection's events by
 * running its rule again over the windows it fired in. Once the events were
 * past the Security Events table's retention the list was empty, and a rule
 * edited since showed what it matches now, not what it matched then. So
 * when a detection fires, OneUptime keeps the events it matched on the
 * detection (SecurityDetection.matchedEvents), read from the events table
 * (or the alert as it was stored) by the source that fired it:
 *
 *   - a detection rule: the events its condition counted for the group, in
 *     the window the run read, with the run's own exceptions and bounds;
 *   - a correlation: the events of its steps, grouped as its group-by
 *     groups them, for every group it fires for at once (#9795);
 *   - a threat intel feed: the events carrying the indicator;
 *   - a connected product, or a threat in Your logs: the event it was
 *     recorded as.
 *
 * What is kept is what the event itself stores - after the project's
 * scrub rules, which run before an event is stored - and never more: each
 * event is the case Evidence's snapshot (SecurityCaseEventEvidence), with
 * its longer text cut shorter and its attributes kept to the ones the card
 * reads first. The card checks the reader's own access to each event's
 * source before it shows one, as it checks the events table.
 *
 * WHAT IT COSTS. At most SECURITY_DETECTION_MATCHED_EVENTS_MAX events and
 * SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES of them per detection, in its
 * Postgres row - the earliest first, as the card lists them, plus a count of
 * how far their requests got - and at most SECURITY_DETECTION_MATCHED_EVENTS_
 * FIRING_MAX events and SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX_BYTES
 * across every group one firing fires for, shared equally (below). An event
 * read from a log line or an alert is well under a kilobyte, so a detection
 * keeps some 5 to 25 KB. A detection that fires again adds to what it keeps
 * until it is full; one that is full takes in no more events, only how far
 * their requests got. Deleting the case deletes its detections and what
 * they kept.
 *
 * Shared by the server, which keeps and reads them, and the Dashboard,
 * which shows them. Free of anything server-only and of React.
 */

// The most events a detection keeps: as many as the card lists.
export const SECURITY_DETECTION_MATCHED_EVENTS_MAX: number = 25;

// The most a detection's kept events take, as JSON.
export const SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES: number = 64 * 1024;

/*
 * WHAT ONE FIRING KEEPS, ACROSS EVERY GROUP IT FIRES FOR (#9795).
 *
 * A source fires for many groups at once - a rule's run opens up to
 * DETECTION_MAX_GROUPS_PER_EVALUATION (100) of them, a threat intel feed's
 * check as many indicators - and each group's detection keeps the events
 * it matched. Every group keeps some: the firing keeps at most as much as
 * SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS full detections do -
 * 1,000 events and 2.5 MB of them - shared equally by its groups
 * (getSecurityDetectionMatchedEventsShare). Up to 40 groups each keep a
 * full detection's 25 events and 64 KB; at the most a run opens, 100
 * groups, each keeps 10 events and about 26 KB - twice the five the card
 * lists before "Show more" - and a group whose detection fires again tops
 * it up to the full 25 then.
 *
 * Why a budget at all: what is kept is one read of the events table and a
 * write of each detection's row in Postgres, inside the run. Without one, a
 * run that opens 100 groups kept up to 2,500 events and 6.4 MB; with it,
 * one firing's read returns at most 1,000 rows, and its detections take in
 * at most 2.5 MB, however many groups it fires for. A group's first event
 * is always kept, whatever its size, so no group fires with nothing.
 */
export const SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS: number = 40;

// The most events one firing keeps, across all its groups: 1,000.
export const SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX: number =
  SECURITY_DETECTION_MATCHED_EVENTS_MAX *
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS;

// ...and the most they take, as JSON: 2.5 MB.
export const SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX_BYTES: number =
  SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES *
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS;

// How much of a firing's events one of its groups keeps.
export interface SecurityDetectionMatchedEventsShare {
  // At most this many events: at least 1, at most a detection's 25.
  maxEvents: number;
  // ...taking at most this much, as JSON: at most a detection's 64 KB.
  maxBytes: number;
}

// A detection's whole bound: what a group keeps when its firing has room for all of it.
export const SECURITY_DETECTION_MATCHED_EVENTS_FULL_SHARE: SecurityDetectionMatchedEventsShare =
  {
    maxEvents: SECURITY_DETECTION_MATCHED_EVENTS_MAX,
    maxBytes: SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
  };

/*
 * Each group's equal share of what a firing for `groupCount` groups keeps:
 * a detection's whole bound while the firing's budget has room for it,
 * less as there are more groups, and never less than one event.
 */
export function getSecurityDetectionMatchedEventsShare(
  groupCount: number,
): SecurityDetectionMatchedEventsShare {
  const groups: number = Number.isFinite(groupCount)
    ? Math.max(1, Math.floor(groupCount))
    : 1;

  return {
    maxEvents: Math.max(
      1,
      Math.min(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX,
        Math.floor(SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX / groups),
      ),
    ),
    maxBytes: Math.max(
      1,
      Math.min(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
        Math.floor(SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX_BYTES / groups),
      ),
    ),
  };
}

// What a kept event keeps of its longer text: a message, a command line.
export const SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH: number = 1000;

// ...and of a short value: a user, a host, an address, a vendor's name.
export const SECURITY_DETECTION_MATCHED_EVENT_VALUE_MAX_LENGTH: number = 300;

// The most observables and ATT&CK ids a kept event keeps.
export const SECURITY_DETECTION_MATCHED_EVENT_LIST_MAX: number = 20;

// The most attributes a kept event keeps, and the longest value of one.
export const SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTES_MAX: number = 40;
export const SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTE_VALUE_MAX_LENGTH: number = 500;

/*
 * The attributes a kept event keeps before any other: what the card reads
 * of it - the request it happened in, its trace's answer and exception, and
 * the log line it was read from, with the service and the record it was
 * sent under - so a kept event opens the same trace, logs and exception.
 */
export const SECURITY_DETECTION_MATCHED_EVENT_KEY_ATTRIBUTES: ReadonlyArray<string> =
  [
    SECURITY_REQUEST_ATTRIBUTES.url,
    SECURITY_REQUEST_ATTRIBUTES.route,
    SECURITY_REQUEST_ATTRIBUTES.method,
    SECURITY_REQUEST_ATTRIBUTES.statusCode,
    SECURITY_REQUEST_ATTRIBUTES.serverSpanId,
    SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint,
    SECURITY_REQUEST_ATTRIBUTES.exceptionType,
    SECURITY_LOG_ID_ATTRIBUTE,
    "oneuptime.log.service",
    SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
    SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
    SECURITY_LOG_FORMAT_ATTRIBUTE,
  ];

// An event as a detection kept it.
export interface SecurityDetectionMatchedEvent
  extends SecurityCaseEventSnapshot {
  /*
   * When the events table deletes the event - its row's retentionDate - as
   * an ISO string; "" where it was not known. Past it, the event is gone
   * and this is the copy OneUptime kept.
   */
  retentionDate: string;
}

// What a detection kept of the events it matched.
export interface SecurityDetectionMatchedEvents {
  // The events, oldest first, at most SECURITY_DETECTION_MATCHED_EVENTS_MAX.
  events: Array<SecurityDetectionMatchedEvent>;
  /*
   * How many of the events its firings matched took each request outcome
   * (SecurityEventRequestOutcome; "" for those no request was followed for):
   * every matched event, not only the kept ones.
   */
  outcomes: Record<string, number>;
}

function cut(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength) : text;
}

function readTime(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "string" && value) {
    // ClickHouse writes "2026-10-14 13:05:00" (UTC) for a DateTime.
    const date: Date = new Date(
      value.includes("T") || value.endsWith("Z")
        ? value
        : `${value.replace(" ", "T")}Z`,
    );

    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  return "";
}

// The attributes a kept event keeps: the card's own first, then the rest by key.
function compactAttributes(attributes: { [key: string]: string }): {
  [key: string]: string;
} {
  const kept: { [key: string]: string } = {};
  const keys: Array<string> = [
    ...SECURITY_DETECTION_MATCHED_EVENT_KEY_ATTRIBUTES.filter(
      (key: string): boolean => {
        return Boolean(attributes[key]);
      },
    ),
    ...Object.keys(attributes)
      .filter((key: string): boolean => {
        return !SECURITY_DETECTION_MATCHED_EVENT_KEY_ATTRIBUTES.includes(key);
      })
      .sort(),
  ];

  for (const key of keys) {
    if (
      Object.keys(kept).length >=
      SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTES_MAX
    ) {
      break;
    }

    const value: string = cut(
      attributes[key] || "",
      SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTE_VALUE_MAX_LENGTH,
    );

    if (value) {
      kept[key] = value;
    }
  }

  return kept;
}

/*
 * A snapshot as a detection keeps it: its longer text cut to
 * SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH, its short values to
 * SECURITY_DETECTION_MATCHED_EVENT_VALUE_MAX_LENGTH, its lists and its
 * attributes to their own bounds.
 */
export function compactSecurityDetectionMatchedEvent(data: {
  snapshot: SecurityCaseEventSnapshot;
  retentionDate: string;
}): SecurityDetectionMatchedEvent {
  const { snapshot } = data;
  const value: (text: string) => string = (text: string): string => {
    return cut(text, SECURITY_DETECTION_MATCHED_EVENT_VALUE_MAX_LENGTH);
  };
  const list: (items: Array<string>) => Array<string> = (
    items: Array<string>,
  ): Array<string> => {
    return items
      .slice(0, SECURITY_DETECTION_MATCHED_EVENT_LIST_MAX)
      .map((item: string): string => {
        return value(item);
      });
  };

  return {
    time: snapshot.time,
    eventUid: value(snapshot.eventUid),
    sourceId: value(snapshot.sourceId),
    severityName: value(snapshot.severityName),
    className: value(snapshot.className),
    categoryName: value(snapshot.categoryName),
    activityName: value(snapshot.activityName),
    statusName: value(snapshot.statusName),
    message: cut(
      snapshot.message,
      SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH,
    ),
    vendorName: value(snapshot.vendorName),
    productName: value(snapshot.productName),
    ruleName: value(snapshot.ruleName),
    principalUser: value(snapshot.principalUser),
    principalHost: value(snapshot.principalHost),
    principalIp: value(snapshot.principalIp),
    targetUser: value(snapshot.targetUser),
    targetHost: value(snapshot.targetHost),
    targetIp: value(snapshot.targetIp),
    targetPort: snapshot.targetPort,
    processName: value(snapshot.processName),
    processCommandLine: cut(
      snapshot.processCommandLine,
      SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH,
    ),
    observables: list(snapshot.observables),
    mitreTactics: list(snapshot.mitreTactics),
    mitreTechniques: list(snapshot.mitreTechniques),
    attributes: compactAttributes(snapshot.attributes),
    traceId: snapshot.traceId,
    spanId: snapshot.spanId,
    sessionId: snapshot.sessionId,
    requestOutcome: snapshot.requestOutcome,
    hunt: null,
    retentionDate: data.retentionDate,
  };
}

/*
 * An event row OneUptime read or stored - the columns of
 * SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS, and its retentionDate - as a
 * detection keeps it. Null for a row that names no event.
 */
export function buildSecurityDetectionMatchedEvent(row: {
  [column: string]: unknown;
}): SecurityDetectionMatchedEvent | null {
  const snapshot: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
    event: row,
  });

  if (!snapshot.eventUid && !snapshot.time) {
    return null;
  }

  return compactSecurityDetectionMatchedEvent({
    snapshot,
    retentionDate: readTime(row["retentionDate"]),
  });
}

// Whether two kept events are the same event: by its id, else by when and what it said.
function getEventIdentity(event: SecurityDetectionMatchedEvent): string {
  return event.eventUid
    ? `uid:${event.eventUid}`
    : `at:${event.time}:${event.message}`;
}

function getTime(event: SecurityDetectionMatchedEvent): number {
  const time: number = event.time ? new Date(event.time).getTime() : NaN;

  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function readCount(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function addOutcomes(
  into: Record<string, number>,
  from: Record<string, number> | undefined,
): void {
  for (const outcome of Object.keys(from || {})) {
    const count: number = readCount((from || {})[outcome]);

    if (count > 0) {
      into[outcome] = (into[outcome] || 0) + count;
    }
  }
}

/*
 * What a detection keeps once it fires: what it kept already, then the
 * firing's events - each once, the earliest first - for as long as there is
 * room (SECURITY_DETECTION_MATCHED_EVENTS_MAX events, and
 * SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES of them; a detection that
 * keeps nothing yet always keeps its first). The firing's request outcomes
 * add to the ones it counted before.
 *
 * `share` holds it to less room: a group's share of a firing for many
 * groups (getSecurityDetectionMatchedEventsShare), never more than the
 * whole bound.
 */
export function keepSecurityDetectionMatchedEvents(data: {
  kept: SecurityDetectionMatchedEvents | null;
  firing: SecurityDetectionMatchedEvents;
  share?: SecurityDetectionMatchedEventsShare | undefined;
}): SecurityDetectionMatchedEvents {
  const maxEvents: number = Math.min(
    SECURITY_DETECTION_MATCHED_EVENTS_MAX,
    Math.max(1, Math.floor(data.share?.maxEvents ?? Number.POSITIVE_INFINITY)),
  );
  const maxBytes: number = Math.min(
    SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
    Math.max(1, Math.floor(data.share?.maxBytes ?? Number.POSITIVE_INFINITY)),
  );
  const events: Array<SecurityDetectionMatchedEvent> = [
    ...(data.kept?.events || []),
  ];
  const seen: Set<string> = new Set<string>(events.map(getEventIdentity));
  let bytes: number = JSON.stringify(events).length;

  const added: Array<SecurityDetectionMatchedEvent> = [
    ...data.firing.events,
  ].sort(
    (
      a: SecurityDetectionMatchedEvent,
      b: SecurityDetectionMatchedEvent,
    ): number => {
      return getTime(a) - getTime(b);
    },
  );

  for (const event of added) {
    if (events.length >= maxEvents) {
      break;
    }

    const identity: string = getEventIdentity(event);

    if (seen.has(identity)) {
      continue;
    }

    // A comma between it and the one before, and the event itself.
    const size: number = JSON.stringify(event).length + 1;

    if (events.length > 0 && bytes + size > maxBytes) {
      break;
    }

    seen.add(identity);
    events.push(event);
    bytes += size;
  }

  const outcomes: Record<string, number> = {};

  addOutcomes(outcomes, data.kept?.outcomes);
  addOutcomes(outcomes, data.firing.outcomes);

  return { events, outcomes };
}

// Whether a detection keeps as many events as it can: a firing adds nothing more.
export function isSecurityDetectionMatchedEventsFull(
  kept: SecurityDetectionMatchedEvents | null,
): boolean {
  return Boolean(
    kept && kept.events.length >= SECURITY_DETECTION_MATCHED_EVENTS_MAX,
  );
}

/*
 * What a detection kept, read back: null for a detection that kept nothing
 * (one that fired before OneUptime kept events, or a source that keeps
 * none) or a value of another shape. Every event is read as the builder
 * writes it, so nothing trusts a stored value's type.
 */
export function readSecurityDetectionMatchedEvents(
  value: unknown,
): SecurityDetectionMatchedEvents | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: { [key: string]: unknown } = value as {
    [key: string]: unknown;
  };
  const events: Array<SecurityDetectionMatchedEvent> = [];

  for (const item of Array.isArray(record["events"]) ? record["events"] : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const stored: { [key: string]: unknown } = item as {
      [key: string]: unknown;
    };
    const event: SecurityDetectionMatchedEvent | null =
      buildSecurityDetectionMatchedEvent({
        ...stored,
        primaryEntityId: stored["sourceId"],
      });

    if (event && events.length < SECURITY_DETECTION_MATCHED_EVENTS_MAX) {
      events.push(event);
    }
  }

  const outcomes: Record<string, number> = {};
  const storedOutcomes: unknown = record["outcomes"];

  if (
    storedOutcomes &&
    typeof storedOutcomes === "object" &&
    !Array.isArray(storedOutcomes)
  ) {
    addOutcomes(outcomes, storedOutcomes as Record<string, number>);
  }

  if (events.length === 0 && Object.keys(outcomes).length === 0) {
    return null;
  }

  return { events, outcomes };
}

// Whether a kept event is past its retention: the events table no longer has it.
export function isSecurityDetectionMatchedEventPastRetention(data: {
  event: Pick<SecurityDetectionMatchedEvent, "retentionDate">;
  now: Date;
}): boolean {
  if (!data.event.retentionDate) {
    return false;
  }

  const retentionDate: number = new Date(data.event.retentionDate).getTime();

  return !Number.isNaN(retentionDate) && retentionDate <= data.now.getTime();
}
