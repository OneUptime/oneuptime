import { JSONObject } from "../JSON";
import { getKvValue, kvListToPlainObject } from "./KubernetesObjectParser";

/*
 * KUBERNETES EVENTS, AS LOGS.
 *
 * The Kubernetes agent watches every Event of the cluster - every
 * namespace, every kind of object, Warning and Normal alike - with the
 * OpenTelemetry Collector's k8sobjects receiver, and sends each change it
 * sees as a log record: the record's attributes say `event.domain` = "k8s"
 * and `k8s.resource.name` = "events", and its body is the watch event, the
 * Event object under `object` as an OTLP kvlist:
 *
 *   { type: "MODIFIED", object: { type: "Warning", reason: "OOMKilling",
 *     note: "Memory cgroup out of memory: Killed process 318623 ...",
 *     regarding: { kind: "Node", name: "aks-userpool-..." },
 *     reportingController: "kernel-monitor", deprecatedCount: 2, ... } }
 *
 * Nothing a person or a query can filter on is outside that body. So a
 * warning was stored as an Information log (the agent's severity rule read
 * the watch's own `type`, ADDED or MODIFIED, never the Event's), filters
 * and monitors could not tell a Warning from a Normal event, and every
 * Dashboard page read the newest few hundred event logs of the whole
 * project and picked its cluster's warnings out of them afterwards - on a
 * busy cluster the Normal events of the last few minutes filled that window
 * and every older warning was gone from view (issue #5179).
 *
 * Ingest now reads the Event out of the body once, with this module, and
 * stamps what it says onto the record as attributes (KubernetesEventAttribute):
 * its type, reason, message, the object it is about, its namespace, who
 * reported it, how many times it happened and when. A Warning is stored as a
 * Warning log. Pages, searches, drop filters and monitors filter on the
 * attributes; the body is left exactly as it arrived, so a search or a
 * monitor that already reads it keeps working.
 *
 * The parser reads both shapes an Event comes in: events.k8s.io/v1, which
 * the agent watches (`note`, `regarding`, `reportingController`, `series`,
 * `deprecatedCount`, ...), and core/v1 (`message`, `involvedObject`,
 * `source`, `count`, ...), which a collector configured to watch the core
 * API sends. One parser serves ingest and the Dashboard alike, so a page
 * reading an event stored before these attributes existed reads it the way
 * ingest reads one today.
 *
 * These keys are stored in customers' logs and in the filters and group-by
 * lists of their monitors: never rename one.
 */
enum KubernetesEventAttribute {
  // "k8s" on every Kubernetes event (the receiver's own marker).
  Domain = "event.domain",
  // "events" on every record of the k8sobjects receiver's Event watch.
  ResourceName = "k8s.resource.name",

  // Warning or Normal, as the Event says.
  Type = "k8s.event.type",
  // The Event's reason: OOMKilling, FailedGetResourceMetric, BackOff, ...
  Reason = "k8s.event.reason",
  // What it says, in the reporter's words.
  Message = "k8s.event.message",
  // What the reporter did or failed to do, when it says (events.k8s.io).
  Action = "k8s.event.action",
  // The Event object's own uid: every update of one Event carries the same.
  Uid = "k8s.event.uid",
  // How many times it has happened so far (the Event's count).
  Count = "k8s.event.count",
  // When it first and last happened, as ISO 8601.
  FirstSeen = "k8s.event.first_seen",
  LastSeen = "k8s.event.last_seen",
  // Who reported it: the controller (kubelet, kernel-monitor,
  // horizontal-pod-autoscaler) and the instance of it (usually a node).
  ReportingController = "k8s.event.reporting_controller",
  ReportingInstance = "k8s.event.reporting_instance",

  /*
   * The namespace the Event is in - the namespace kubectl, Lens and the
   * cloud consoles list it under. A namespaced object's Events are in its
   * own namespace; a Node's, like any cluster-wide object's, are in
   * "default".
   */
  Namespace = "k8s.namespace.name",

  // The object it is about, as the OpenTelemetry k8sevents receiver names it.
  ObjectKind = "k8s.object.kind",
  ObjectName = "k8s.object.name",
  ObjectUid = "k8s.object.uid",
  ObjectApiVersion = "k8s.object.api_version",
  // Which part of the object, when the Event says: spec.containers{app}.
  ObjectFieldPath = "k8s.object.fieldpath",
}

export default KubernetesEventAttribute;

export const KUBERNETES_EVENT_DOMAIN: string = "k8s";

// What the k8sobjects receiver calls the Event resource it watches.
export const KUBERNETES_EVENTS_RESOURCE_NAME: string = "events";

// The two types Kubernetes gives an Event.
export enum KubernetesEventType {
  Warning = "Warning",
  Normal = "Normal",
}

/*
 * The OpenTelemetry SeverityNumbers an Event's type maps to: a Warning is a
 * WARN log, anything else an INFO log.
 */
export const KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER: number = 13;
export const KUBERNETES_NORMAL_EVENT_SEVERITY_NUMBER: number = 9;

/*
 * The longest message stamped as an attribute. The Event API holds a
 * message to 1 KB (events.k8s.io) and the recorders cut theirs to that; a
 * longer one - from a core/v1 writer that does not - is cut here, and the
 * body still holds all of it.
 */
export const MAX_KUBERNETES_EVENT_MESSAGE_LENGTH: number = 2048;

/*
 * The longest body read for an Event. An Event object, its metadata and its
 * managed fields included, is a few kilobytes; a body this long is not one,
 * and is not parsed.
 */
export const MAX_KUBERNETES_EVENT_BODY_LENGTH: number = 512 * 1024;

/*
 * A time before this is not a time an Event happened: a zero timestamp
 * (`0001-01-01T00:00:00Z`) is how an unset one can arrive.
 */
const EARLIEST_EVENT_TIME_MS: number = Date.UTC(2000, 0, 1);

export interface KubernetesEventObjectReference {
  kind: string;
  name: string;
  // The object's own namespace: empty for a Node, a PV, a Namespace.
  namespace: string;
  uid: string;
  apiVersion: string;
  fieldPath: string;
}

export interface ParsedKubernetesEvent {
  // The Event object's uid ("" when it came without one).
  uid: string;
  // The Event object's name: istiod.17a0c3e2b5f8e1d4.
  name: string;
  // The namespace the Event is in (see KubernetesEventAttribute.Namespace).
  namespace: string;
  // "Warning", "Normal", or "" when the Event gives none.
  type: string;
  reason: string;
  message: string;
  action: string;
  object: KubernetesEventObjectReference;
  reportingController: string;
  reportingInstance: string;
  // How many times it has happened: 1 at least.
  count: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  /*
   * ADDED, MODIFIED or DELETED - which change of the watch the record is.
   * Empty for an Event a pull (not a watch) sent, and for one read from its
   * attributes.
   */
  watchType: string;
}

type PlainObject = Record<string, unknown>;

function asObject(value: unknown): PlainObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as PlainObject;
  }

  return null;
}

function text(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

// A count as Kubernetes writes it: a whole number, as a number or a string.
function wholeNumber(value: unknown): number {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

// An RFC 3339 time (a Time or a MicroTime), or null for an unset one.
function toEventDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ||
      value.getTime() < EARLIEST_EVENT_TIME_MS
      ? null
      : value;
  }

  const raw: string = text(value);

  if (!raw) {
    return null;
  }

  const parsed: Date = new Date(raw);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getTime() < EARLIEST_EVENT_TIME_MS
  ) {
    return null;
  }

  return parsed;
}

function newest(dates: Array<Date | null>): Date | null {
  let result: Date | null = null;

  for (const date of dates) {
    if (date && (!result || date.getTime() > result.getTime())) {
      result = date;
    }
  }

  return result;
}

function oldest(dates: Array<Date | null>): Date | null {
  let result: Date | null = null;

  for (const date of dates) {
    if (date && (!result || date.getTime() < result.getTime())) {
      result = date;
    }
  }

  return result;
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_KUBERNETES_EVENT_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_KUBERNETES_EVENT_MESSAGE_LENGTH - 1)}…`;
}

/*
 * Whether a plain object is an Event: it says so (kind Event), or - for a
 * writer that leaves the kind out - it names the object it is about and why.
 */
function isEventObject(object: PlainObject): boolean {
  const kind: string = text(object["kind"]);

  if (kind) {
    return kind === "Event";
  }

  return (
    Boolean(
      asObject(object["regarding"]) || asObject(object["involvedObject"]),
    ) && Boolean(text(object["reason"]) || text(object["type"]))
  );
}

/*
 * An Event, as a plain object (both API versions), read into what a page,
 * a filter or a monitor needs of it. Null when the object is not an Event.
 */
export function parseKubernetesEventPlainObject(
  object: PlainObject | null | undefined,
  watchType: string = "",
): ParsedKubernetesEvent | null {
  if (!object || !isEventObject(object)) {
    return null;
  }

  const metadata: PlainObject = asObject(object["metadata"]) || {};
  const reference: PlainObject =
    asObject(object["regarding"]) || asObject(object["involvedObject"]) || {};
  // events.k8s.io keeps the core/v1 source as deprecatedSource.
  const source: PlainObject =
    asObject(object["deprecatedSource"]) || asObject(object["source"]) || {};
  const series: PlainObject = asObject(object["series"]) || {};

  const firstTimestamp: Date | null = toEventDate(
    object["deprecatedFirstTimestamp"] ?? object["firstTimestamp"],
  );
  const lastTimestamp: Date | null = toEventDate(
    object["deprecatedLastTimestamp"] ?? object["lastTimestamp"],
  );
  const eventTime: Date | null = toEventDate(object["eventTime"]);
  const seriesLastObservedTime: Date | null = toEventDate(
    series["lastObservedTime"],
  );
  const createdAt: Date | null = toEventDate(metadata["creationTimestamp"]);

  const count: number = Math.max(
    1,
    wholeNumber(series["count"]),
    wholeNumber(object["deprecatedCount"]),
    wholeNumber(object["count"]),
  );

  const objectReference: KubernetesEventObjectReference = {
    kind: text(reference["kind"]),
    name: text(reference["name"]),
    namespace: text(reference["namespace"]),
    uid: text(reference["uid"]),
    apiVersion: text(reference["apiVersion"]),
    fieldPath: text(reference["fieldPath"]),
  };

  return {
    uid: text(metadata["uid"]),
    name: text(metadata["name"]),
    // A core/v1 writer may leave the Event's own namespace to its object's.
    namespace: text(metadata["namespace"]) || objectReference.namespace,
    type: text(object["type"]),
    reason: text(object["reason"]),
    message: truncateMessage(text(object["note"]) || text(object["message"])),
    action: text(object["action"]),
    object: objectReference,
    reportingController:
      text(object["reportingController"]) ||
      text(object["reportingComponent"]) ||
      text(source["component"]),
    reportingInstance:
      text(object["reportingInstance"]) || text(source["host"]),
    count: count,
    // eventTime is when an events.k8s.io Event was first seen.
    firstSeenAt: oldest([firstTimestamp, eventTime, createdAt]),
    lastSeenAt: newest([
      seriesLastObservedTime,
      lastTimestamp,
      eventTime,
      firstTimestamp,
      createdAt,
    ]),
    watchType: text(watchType).toUpperCase(),
  };
}

/*
 * An Event out of a stored log body: the OTLP AnyValue JSON the ingest keeps
 * (`{"kvlistValue":{"values":[...]}}`, or the snake_case a protobuf payload
 * decodes to). A watch's body wraps the Event under `object` beside the
 * watch's own `type`; a pull's body is the Event itself. Null for any body
 * that is not an Event.
 */
export function parseKubernetesEventFromLogBody(
  body: string | null | undefined,
): ParsedKubernetesEvent | null {
  if (
    typeof body !== "string" ||
    !body ||
    body.length > MAX_KUBERNETES_EVENT_BODY_LENGTH
  ) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const wrapper: PlainObject | null = asObject(parsed);

  if (!wrapper) {
    return null;
  }

  const topKvList: JSONObject | undefined = (asObject(wrapper["kvlistValue"]) ||
    asObject(wrapper["kvlist_value"]) ||
    undefined) as JSONObject | undefined;

  if (!topKvList) {
    return null;
  }

  const objectValue: string | JSONObject | null = getKvValue(
    topKvList,
    "object",
  );

  if (objectValue && typeof objectValue !== "string") {
    const watchType: string | JSONObject | null = getKvValue(topKvList, "type");

    return parseKubernetesEventPlainObject(
      kvListToPlainObject(objectValue) as PlainObject,
      typeof watchType === "string" ? watchType : "",
    );
  }

  return parseKubernetesEventPlainObject(
    kvListToPlainObject(topKvList) as PlainObject,
  );
}

// Whether a log record is one of the k8sobjects receiver's Event records.
export function isKubernetesEventLogRecord(
  attributes: Record<string, unknown> | null | undefined,
): boolean {
  if (!attributes || typeof attributes !== "object") {
    return false;
  }

  const resourceName: unknown =
    attributes[KubernetesEventAttribute.ResourceName];

  return (
    typeof resourceName === "string" &&
    resourceName.trim().toLowerCase() === KUBERNETES_EVENTS_RESOURCE_NAME
  );
}

/*
 * The attributes an Event's log record is stamped with at ingest. A value
 * the Event does not have is left out rather than stamped empty, so a filter
 * on it never matches a blank.
 */
export function getKubernetesEventLogAttributes(
  event: ParsedKubernetesEvent,
): Record<string, string> {
  const attributes: Record<string, string> = {
    [KubernetesEventAttribute.Domain]: KUBERNETES_EVENT_DOMAIN,
    [KubernetesEventAttribute.Count]: String(event.count),
  };

  const values: Array<[KubernetesEventAttribute, string]> = [
    [KubernetesEventAttribute.Type, event.type],
    [KubernetesEventAttribute.Reason, event.reason],
    [KubernetesEventAttribute.Message, event.message],
    [KubernetesEventAttribute.Action, event.action],
    [KubernetesEventAttribute.Uid, event.uid],
    [
      KubernetesEventAttribute.FirstSeen,
      event.firstSeenAt ? event.firstSeenAt.toISOString() : "",
    ],
    [
      KubernetesEventAttribute.LastSeen,
      event.lastSeenAt ? event.lastSeenAt.toISOString() : "",
    ],
    [KubernetesEventAttribute.ReportingController, event.reportingController],
    [KubernetesEventAttribute.ReportingInstance, event.reportingInstance],
    [KubernetesEventAttribute.Namespace, event.namespace],
    [KubernetesEventAttribute.ObjectKind, event.object.kind],
    [KubernetesEventAttribute.ObjectName, event.object.name],
    [KubernetesEventAttribute.ObjectUid, event.object.uid],
    [KubernetesEventAttribute.ObjectApiVersion, event.object.apiVersion],
    [KubernetesEventAttribute.ObjectFieldPath, event.object.fieldPath],
  ];

  for (const [key, value] of values) {
    if (value) {
      attributes[key] = value;
    }
  }

  return attributes;
}

/*
 * An Event read back from the attributes ingest stamped on its record. Null
 * for a record stamped before these attributes existed (no uid and no
 * reason): read its body instead.
 */
export function readKubernetesEventFromAttributes(
  attributes: Record<string, unknown> | null | undefined,
): ParsedKubernetesEvent | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const read: (key: KubernetesEventAttribute) => string = (
    key: KubernetesEventAttribute,
  ): string => {
    return text(attributes[key]);
  };

  if (
    !read(KubernetesEventAttribute.Uid) &&
    !read(KubernetesEventAttribute.Reason)
  ) {
    return null;
  }

  return {
    uid: read(KubernetesEventAttribute.Uid),
    name: text(attributes["event.name"]),
    namespace: read(KubernetesEventAttribute.Namespace),
    type: read(KubernetesEventAttribute.Type),
    reason: read(KubernetesEventAttribute.Reason),
    message: read(KubernetesEventAttribute.Message),
    action: read(KubernetesEventAttribute.Action),
    object: {
      kind: read(KubernetesEventAttribute.ObjectKind),
      name: read(KubernetesEventAttribute.ObjectName),
      namespace: "",
      uid: read(KubernetesEventAttribute.ObjectUid),
      apiVersion: read(KubernetesEventAttribute.ObjectApiVersion),
      fieldPath: read(KubernetesEventAttribute.ObjectFieldPath),
    },
    reportingController: read(KubernetesEventAttribute.ReportingController),
    reportingInstance: read(KubernetesEventAttribute.ReportingInstance),
    count: Math.max(1, wholeNumber(attributes[KubernetesEventAttribute.Count])),
    firstSeenAt: toEventDate(attributes[KubernetesEventAttribute.FirstSeen]),
    lastSeenAt: toEventDate(attributes[KubernetesEventAttribute.LastSeen]),
    watchType: "",
  };
}

// Whether an Event is a Warning, whatever the case it is written in.
export function isKubernetesWarningEvent(
  event: { type: string } | null | undefined,
): boolean {
  return (
    Boolean(event) &&
    text(event!.type).toLowerCase() ===
      KubernetesEventType.Warning.toLowerCase()
  );
}

/*
 * The SeverityNumber an Event's record is stored with. A Warning is raised
 * to WARN - the agent's own rule stamps every Event INFO, and a collector's
 * own may say nothing - but never lowered: a pipeline that already made it
 * an ERROR keeps it. Any other Event is INFO when nothing said otherwise.
 */
export function getKubernetesEventSeverityNumber(data: {
  eventType: string;
  severityNumber: number;
}): number {
  const current: number = Number.isFinite(data.severityNumber)
    ? data.severityNumber
    : 0;

  if (isKubernetesWarningEvent({ type: data.eventType })) {
    return Math.max(current, KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER);
  }

  if (current <= 0) {
    return KUBERNETES_NORMAL_EVENT_SEVERITY_NUMBER;
  }

  return current;
}

/*
 * When an Event's record happened, for its log's time: the last time the
 * Event happened, when the record carries no time of its own (the
 * k8sobjects receiver sets none, so the record would otherwise be stamped
 * with the moment it was ingested - and a watch's DELETED, an hour after
 * the Event, read as a new occurrence). A time ahead of `now` - a node's
 * clock running fast - is taken as `now`. Null when the Event says no time.
 */
export function getKubernetesEventLogTime(data: {
  event: ParsedKubernetesEvent;
  now: Date;
}): Date | null {
  const lastSeenAt: Date | null = data.event.lastSeenAt;

  if (!lastSeenAt) {
    return null;
  }

  if (lastSeenAt.getTime() > data.now.getTime()) {
    return data.now;
  }

  return lastSeenAt;
}
