/*
 * SECURITY EVENTS BOOKMARKED ONTO A CASE.
 *
 * A person who finds events that belong to a case - with a hunt, or any
 * search on Security Events > Events - keeps them on the case as evidence
 * (SecurityCaseEvidenceKind.Event). OneUptime reads each event itself, as
 * that person (only an event they can read is kept), and keeps what it read
 * as the event's snapshot: the case still shows the event once the event is
 * past its retention, and what is kept is what OneUptime read, never what a
 * request said it was.
 *
 * Shared by the server, which reads and keeps the events
 * (SecurityCaseEvidenceService.addEvents), and the Dashboard, which asks for
 * it and draws each kept event on the case's Evidence page.
 */

// The most events one request keeps on a case: a page of a list, ticked.
export const SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD: number = 100;

/*
 * What a snapshot keeps of an event's longer text: enough to read it on
 * the case. The event's full record is a click away while it is kept.
 */
export const SECURITY_CASE_EVENT_SNAPSHOT_TEXT_MAX_LENGTH: number = 4000;
export const SECURITY_CASE_EVENT_SNAPSHOT_LIST_MAX: number = 100;
export const SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTES_MAX: number = 100;
export const SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTE_VALUE_MAX_LENGTH: number = 1000;

/*
 * The SecurityEvent columns a snapshot is read from: who, what and where,
 * as the event's panel on Events shows them, and its source attributes.
 */
export const SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS: ReadonlyArray<string> = [
  "time",
  "eventUid",
  "primaryEntityId",
  "severityName",
  "className",
  "categoryName",
  "activityName",
  "statusName",
  "message",
  "vendorName",
  "productName",
  "ruleName",
  "principalUser",
  "principalHost",
  "principalIp",
  "targetUser",
  "targetHost",
  "targetIp",
  "targetPort",
  "processName",
  "processCommandLine",
  "observables",
  "mitreTactics",
  "mitreTechniques",
  "attributes",
];

// The hunt that found a kept event, as it was named when the event was kept.
export interface SecurityCaseEventHunt {
  id: string;
  name: string;
}

// An event as it was kept on a case.
export interface SecurityCaseEventSnapshot {
  // When the event happened, as an ISO string.
  time: string;
  eventUid: string;
  // The source (a Telemetry Service) the event arrived from.
  sourceId: string;
  severityName: string;
  className: string;
  categoryName: string;
  activityName: string;
  statusName: string;
  message: string;
  vendorName: string;
  productName: string;
  ruleName: string;
  principalUser: string;
  principalHost: string;
  principalIp: string;
  targetUser: string;
  targetHost: string;
  targetIp: string;
  targetPort: number | null;
  processName: string;
  processCommandLine: string;
  observables: Array<string>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  attributes: { [key: string]: string };
  hunt: SecurityCaseEventHunt | null;
}

// An event a request names to keep: its id and when it happened.
export interface SecurityCaseEventReference {
  eventUid: string;
  time: Date;
}

/*
 * What happened to each event a request named: kept now, kept on the case
 * already (left as it was), or not found - gone, or not one the person can
 * read, said the same way so the answer never tells what exists.
 */
export interface SecurityCaseEventsAddResult {
  added: Array<string>;
  alreadyOnCase: Array<string>;
  notFound: Array<string>;
}

// The answer as the Dashboard reads it: each list of event ids, or none.
export function readSecurityCaseEventsAddResult(
  value: unknown,
): SecurityCaseEventsAddResult {
  const record: { [key: string]: unknown } =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { [key: string]: unknown })
      : {};
  const ids: (key: string) => Array<string> = (key: string): Array<string> => {
    const list: unknown = record[key];

    return Array.isArray(list)
      ? list.filter((item: unknown): item is string => {
          return typeof item === "string" && item.length > 0;
        })
      : [];
  };

  return {
    added: ids("added"),
    alreadyOnCase: ids("alreadyOnCase"),
    notFound: ids("notFound"),
  };
}

/*
 * The reasons the answer gives per event, in words the Dashboard's result
 * shows (and translates).
 */
export const SECURITY_CASE_EVENTS_ADD_REASONS: {
  alreadyOnCase: { message: string };
  notFound: { message: string };
} = {
  alreadyOnCase: { message: "Already kept on this case." },
  notFound: {
    message:
      "This event was not found. It may be past its retention, or one you cannot read.",
  },
};

/*
 * A value as text, kept to `maxLength`: text, a number or a yes/no as
 * written, and a value of a class of its own (an ObjectID) as it writes
 * itself. Anything else - a list, a plain object - is not text.
 */
function readText(value: unknown, maxLength: number): string {
  let text: string = "";

  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    text = String(value);
  }

  return text.length > maxLength ? text.substring(0, maxLength) : text;
}

function readList(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const list: Array<string> = [];

  for (const item of value) {
    const text: string = readText(
      item,
      SECURITY_CASE_EVENT_SNAPSHOT_TEXT_MAX_LENGTH,
    );

    if (text && !list.includes(text)) {
      list.push(text);
    }

    if (list.length >= SECURITY_CASE_EVENT_SNAPSHOT_LIST_MAX) {
      break;
    }
  }

  return list;
}

function readAttributes(value: unknown): { [key: string]: string } {
  const attributes: { [key: string]: string } = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return attributes;
  }

  const keys: Array<string> = Object.keys(
    value as Record<string, unknown>,
  ).sort();

  for (const key of keys) {
    if (
      Object.keys(attributes).length >=
      SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTES_MAX
    ) {
      break;
    }

    const text: string = readText(
      (value as { [key: string]: unknown })[key],
      SECURITY_CASE_EVENT_SNAPSHOT_ATTRIBUTE_VALUE_MAX_LENGTH,
    );

    if (key && text) {
      attributes[key] = text;
    }
  }

  return attributes;
}

function readTime(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "string" && value) {
    // ClickHouse writes "2026-10-14 13:05:00.123" (UTC) for a DateTime64.
    const date: Date = new Date(
      value.includes("T") || value.endsWith("Z")
        ? value
        : `${value.replace(" ", "T")}Z`,
    );

    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  return "";
}

function readPort(value: unknown): number | null {
  const port: number = Number(value);

  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function readHunt(value: unknown): SecurityCaseEventHunt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const id: string = readText((value as { id?: unknown }).id, 100);
  const name: string = readText((value as { name?: unknown }).name, 100);

  return id && name ? { id, name } : null;
}

/*
 * An event, as a snapshot: every column of
 * SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS read from the row OneUptime read
 * (each kept to its limit), and the hunt that found it.
 */
export function buildSecurityCaseEventSnapshot(data: {
  event: { [column: string]: unknown };
  hunt?: SecurityCaseEventHunt | null | undefined;
}): SecurityCaseEventSnapshot {
  const row: { [column: string]: unknown } = data.event;
  const text: (column: string) => string = (column: string): string => {
    return readText(row[column], SECURITY_CASE_EVENT_SNAPSHOT_TEXT_MAX_LENGTH);
  };

  return {
    time: readTime(row["time"]),
    eventUid: text("eventUid"),
    sourceId: text("primaryEntityId"),
    severityName: text("severityName"),
    className: text("className"),
    categoryName: text("categoryName"),
    activityName: text("activityName"),
    statusName: text("statusName"),
    message: text("message"),
    vendorName: text("vendorName"),
    productName: text("productName"),
    ruleName: text("ruleName"),
    principalUser: text("principalUser"),
    principalHost: text("principalHost"),
    principalIp: text("principalIp"),
    targetUser: text("targetUser"),
    targetHost: text("targetHost"),
    targetIp: text("targetIp"),
    targetPort: readPort(row["targetPort"]),
    processName: text("processName"),
    processCommandLine: text("processCommandLine"),
    observables: readList(row["observables"]),
    mitreTactics: readList(row["mitreTactics"]),
    mitreTechniques: readList(row["mitreTechniques"]),
    attributes: readAttributes(row["attributes"]),
    hunt: data.hunt ? readHunt(data.hunt) : null,
  };
}

/*
 * A kept snapshot, read back for the page: null when the value is not one
 * (a row written by hand, a shape from before). Every field is read as the
 * builder writes it, so a page never trusts a stored value's type.
 */
export function readSecurityCaseEventSnapshot(
  value: unknown,
): SecurityCaseEventSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: { [key: string]: unknown } = value as {
    [key: string]: unknown;
  };

  const snapshot: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
    event: {
      ...record,
      primaryEntityId: record["sourceId"],
    },
    hunt: readHunt(record["hunt"]),
  });

  return snapshot.eventUid || snapshot.time ? snapshot : null;
}

/*
 * What a kept event is called on the case: its message, else its class
 * and activity, else what it is.
 */
export function getSecurityCaseEventEvidenceName(
  snapshot: Pick<
    SecurityCaseEventSnapshot,
    "message" | "className" | "activityName"
  >,
): string {
  const message: string = snapshot.message.trim();

  if (message) {
    return message.length > 500 ? `${message.substring(0, 499)}…` : message;
  }

  const kind: string = [snapshot.className, snapshot.activityName]
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(": ");

  return kind || "Security event";
}

/*
 * The events a request names, each once (by id), in the order named; any
 * entry without an id or a time it can read is left out.
 */
export function readSecurityCaseEventReferences(
  value: unknown,
): Array<SecurityCaseEventReference> {
  if (!Array.isArray(value)) {
    return [];
  }

  const references: Array<SecurityCaseEventReference> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const eventUid: string = readText(
      (item as { eventUid?: unknown }).eventUid,
      500,
    ).trim();
    const time: string = readTime((item as { time?: unknown }).time);

    if (!eventUid || !time || seen.has(eventUid)) {
      continue;
    }

    seen.add(eventUid);
    references.push({ eventUid, time: new Date(time) });
  }

  return references;
}
