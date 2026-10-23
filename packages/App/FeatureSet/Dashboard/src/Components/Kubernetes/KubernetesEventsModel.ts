import Includes from "Common/Types/BaseDatabase/Includes";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import KubernetesEventAttribute, {
  KUBERNETES_EVENT_DOMAIN,
  KUBERNETES_EVENTS_RESOURCE_NAME,
  KubernetesEventType,
  ParsedKubernetesEvent,
  isKubernetesWarningEvent,
  parseKubernetesEventFromLogBody,
  readKubernetesEventFromAttributes,
} from "Common/Types/Kubernetes/KubernetesEvent";

/*
 * WHAT THE KUBERNETES EVENTS VIEWS SHOW, AS DATA.
 *
 * A Kubernetes Event is a log (Common/Types/Kubernetes/KubernetesEvent):
 * the views ask the logs list for one cluster's Event records - scoped and
 * filtered on the server, by the attributes ingest stamps on them, so a
 * cluster's warnings are never crowded out by its Normal events or by
 * another cluster's (issue #5179: the pages used to read the newest 500
 * Event logs of the whole project and pick their cluster's warnings out
 * afterwards) - and turn them into one row per Event.
 *
 * One Event reaches the logs many times: once when it is created, again
 * each time it repeats (its count goes up), and once more when it expires.
 * A row is the Event, as its newest record says it: how many times it
 * happened, first and last.
 *
 * Plain logic, free of React and of the API client, so App/Tests can read it.
 */

// The resource attribute every record of a cluster's agent carries.
export const KUBERNETES_CLUSTER_NAME_ATTRIBUTE: string =
  "resource.k8s.cluster.name";

/*
 * The workloads whose page shows their Pods' Events too: what goes wrong
 * with a Deployment - a crash loop, an image that will not pull, a probe
 * that fails, a pod that cannot be scheduled - is reported about its Pods
 * (and its ReplicaSets), not about the Deployment itself.
 */
export enum KubernetesWorkloadKind {
  Deployment = "Deployment",
  StatefulSet = "StatefulSet",
  DaemonSet = "DaemonSet",
  Job = "Job",
  CronJob = "CronJob",
}

// Which Events a view shows.
export type KubernetesEventsScope =
  // Every Event of the cluster.
  | { kind: "cluster" }
  // Every Event in a namespace.
  | { kind: "namespace"; namespace: string }
  // The Events about one object: a Node, a Pod, an HPA, a PVC, ...
  | {
      kind: "object";
      objectKind: string;
      objectName: string;
      namespace?: string | undefined;
    }
  // A workload's Events and those of the objects it runs.
  | {
      kind: "workload";
      workloadKind: KubernetesWorkloadKind;
      name: string;
      namespace?: string | undefined;
    };

// Which types a view shows.
export enum KubernetesEventsTypeFilter {
  Warning = "warning",
  Normal = "normal",
  All = "all",
}

export interface KubernetesEventsFilters {
  type: KubernetesEventsTypeFilter;
  namespace?: string | undefined;
  reason?: string | undefined;
  objectKind?: string | undefined;
}

export interface KubernetesEventRow {
  // Unique among a view's rows: the Event's uid when it has one.
  id: string;
  // Warning, Normal - as the Event says it.
  type: string;
  isWarning: boolean;
  reason: string;
  message: string;
  objectKind: string;
  objectName: string;
  // Which part of the object, when the Event says: spec.containers{app}.
  objectFieldPath: string;
  namespace: string;
  // Who reported it: kernel-monitor, kubelet, horizontal-pod-autoscaler.
  source: string;
  // Where: usually a node.
  sourceHost: string;
  // How many times it happened.
  count: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface KubernetesEventLogLike {
  _id?: unknown;
  time?: unknown;
  body?: unknown;
  attributes?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value) {
    const parsed: Date = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/*
 * Whether a record was stored before ingest stamped what its Event says:
 * then only its body tells, and it has to be read for it.
 */
export function isUnstampedKubernetesEventLog(
  log: KubernetesEventLogLike,
): boolean {
  return !readKubernetesEventFromAttributes(asRecord(log.attributes));
}

/*
 * The Event one log record is, from the attributes ingest stamped on it -
 * or, for a record stored before that, from its body. Null for a record
 * that is neither (no body was read for it, or it is not an Event).
 */
export function toKubernetesEvent(
  log: KubernetesEventLogLike,
): ParsedKubernetesEvent | null {
  const event: ParsedKubernetesEvent | null =
    readKubernetesEventFromAttributes(asRecord(log.attributes)) ||
    (typeof log.body === "string"
      ? parseKubernetesEventFromLogBody(log.body)
      : null);

  if (!event) {
    return null;
  }

  // An Event that says no time happened when its record did.
  if (!event.lastSeenAt) {
    const time: Date | null = toDate(log.time);
    return {
      ...event,
      lastSeenAt: time,
      firstSeenAt: event.firstSeenAt || time,
    };
  }

  return event;
}

// What tells two Events apart when one came without a uid.
function eventKey(event: ParsedKubernetesEvent): string {
  if (event.uid) {
    return event.uid;
  }

  return [
    event.type,
    event.reason,
    event.object.kind,
    event.object.name,
    event.namespace,
    event.message,
  ].join("\u0000");
}

function newer(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return a.getTime() >= b.getTime() ? a : b;
}

function older(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return a.getTime() <= b.getTime() ? a : b;
}

function toRow(event: ParsedKubernetesEvent, id: string): KubernetesEventRow {
  return {
    id: id,
    type: event.type || KubernetesEventType.Normal,
    isWarning: isKubernetesWarningEvent(event),
    reason: event.reason,
    message: event.message,
    objectKind: event.object.kind,
    objectName: event.object.name,
    objectFieldPath: event.object.fieldPath,
    namespace: event.namespace,
    source: event.reportingController,
    sourceHost: event.reportingInstance,
    count: event.count,
    firstSeenAt: event.firstSeenAt,
    lastSeenAt: event.lastSeenAt,
  };
}

/*
 * One row per Event, newest first. Of an Event's records, the one with the
 * highest count says what the Event is now (a later record of the same
 * count - the expiry - wins a tie); its first and last time span them all.
 */
export function groupKubernetesEvents(
  logs: Array<KubernetesEventLogLike>,
): Array<KubernetesEventRow> {
  const latestByKey: Map<string, ParsedKubernetesEvent> = new Map();
  const firstSeenByKey: Map<string, Date | null> = new Map();
  const lastSeenByKey: Map<string, Date | null> = new Map();

  for (const log of logs) {
    const event: ParsedKubernetesEvent | null = toKubernetesEvent(log);

    if (!event) {
      continue;
    }

    const key: string = eventKey(event);
    const known: ParsedKubernetesEvent | undefined = latestByKey.get(key);

    if (
      !known ||
      event.count > known.count ||
      (event.count === known.count &&
        (event.lastSeenAt?.getTime() || 0) >=
          (known.lastSeenAt?.getTime() || 0))
    ) {
      latestByKey.set(key, event);
    }

    firstSeenByKey.set(
      key,
      older(firstSeenByKey.get(key) || null, event.firstSeenAt),
    );
    lastSeenByKey.set(
      key,
      newer(lastSeenByKey.get(key) || null, event.lastSeenAt),
    );
  }

  const rows: Array<KubernetesEventRow> = [];

  for (const [key, event] of latestByKey.entries()) {
    rows.push(
      toRow(
        {
          ...event,
          firstSeenAt: firstSeenByKey.get(key) || event.firstSeenAt,
          lastSeenAt: lastSeenByKey.get(key) || event.lastSeenAt,
        },
        key,
      ),
    );
  }

  return sortKubernetesEventRows(rows);
}

/*
 * Two reads of one range as one list: an Event in both is one row, as the
 * read that saw it happen more often says it.
 */
export function mergeKubernetesEventRows(
  first: Array<KubernetesEventRow>,
  second: Array<KubernetesEventRow>,
): Array<KubernetesEventRow> {
  const byId: Map<string, KubernetesEventRow> = new Map();

  for (const row of [...first, ...second]) {
    const known: KubernetesEventRow | undefined = byId.get(row.id);

    if (!known) {
      byId.set(row.id, row);
      continue;
    }

    const latest: KubernetesEventRow =
      row.count > known.count ||
      (row.count === known.count &&
        (row.lastSeenAt?.getTime() || 0) > (known.lastSeenAt?.getTime() || 0))
        ? row
        : known;

    byId.set(row.id, {
      ...latest,
      firstSeenAt: older(known.firstSeenAt, row.firstSeenAt),
      lastSeenAt: newer(known.lastSeenAt, row.lastSeenAt),
    });
  }

  return sortKubernetesEventRows(Array.from(byId.values()));
}

// Newest first; of two at the same moment, the one that happened more often.
export function sortKubernetesEventRows(
  rows: Array<KubernetesEventRow>,
): Array<KubernetesEventRow> {
  return [...rows].sort(
    (a: KubernetesEventRow, b: KubernetesEventRow): number => {
      return (
        (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0) ||
        b.count - a.count ||
        a.reason.localeCompare(b.reason) ||
        a.objectName.localeCompare(b.objectName)
      );
    },
  );
}

/*
 * The Kinds a workload's page shows Events about: the workload, and what it
 * creates (a Deployment's ReplicaSets and Pods, a CronJob's Jobs and Pods).
 */
export const WORKLOAD_EVENT_KINDS: Record<
  KubernetesWorkloadKind,
  Array<string>
> = {
  [KubernetesWorkloadKind.Deployment]: ["Deployment", "ReplicaSet", "Pod"],
  [KubernetesWorkloadKind.StatefulSet]: ["StatefulSet", "Pod"],
  [KubernetesWorkloadKind.DaemonSet]: ["DaemonSet", "Pod"],
  [KubernetesWorkloadKind.Job]: ["Job", "Pod"],
  [KubernetesWorkloadKind.CronJob]: ["CronJob", "Job", "Pod"],
};

/*
 * The characters Kubernetes draws generated name suffixes from
 * (k8s.io/apimachinery rand.SafeEncodeString): no vowels, no 0, 1 or 3, so
 * no suffix spells a word. A Deployment's ReplicaSet is `<name>-<hash>`,
 * its Pods `<name>-<hash>-<5 of these>`.
 */
const GENERATED_SUFFIX: RegExp = /^[bcdfghjklmnpqrstvwxz2456789]+$/;
const DIGITS: RegExp = /^[0-9]+$/;

function isGenerated(part: string | undefined): boolean {
  return Boolean(part) && GENERATED_SUFFIX.test(part!);
}

function isDigits(part: string | undefined): boolean {
  return Boolean(part) && DIGITS.test(part!);
}

/*
 * The parts of a name after the workload's own `<name>-`, or null when the
 * name does not start with it. Kubernetes names are at most 253 characters.
 */
function partsAfter(name: string, prefix: string): Array<string> | null {
  if (!name.startsWith(`${prefix}-`)) {
    return null;
  }

  return name.slice(prefix.length + 1).split("-");
}

// A Job's Pod: `<job>-<suffix>`, or `<job>-<index>-<suffix>` for an indexed Job.
function isJobPodSuffix(parts: Array<string>): boolean {
  if (parts.length === 1) {
    return isGenerated(parts[0]);
  }

  return parts.length === 2 && isDigits(parts[0]) && isGenerated(parts[1]);
}

/*
 * Whether an Event is about a workload or about something the workload
 * runs, by the names Kubernetes gives what a controller creates. Another
 * workload whose name starts the same way ("web" and "web-api") is not
 * mistaken for it: what follows its name must be a generated suffix.
 */
export function isKubernetesEventAboutWorkload(
  event: { objectKind: string; objectName: string },
  workload: { kind: KubernetesWorkloadKind; name: string },
): boolean {
  const name: string = event.objectName;

  if (event.objectKind === workload.kind) {
    return name === workload.name;
  }

  const parts: Array<string> | null = partsAfter(name, workload.name);

  if (!parts) {
    return false;
  }

  switch (workload.kind) {
    case KubernetesWorkloadKind.Deployment:
      if (event.objectKind === "ReplicaSet") {
        return parts.length === 1 && isGenerated(parts[0]);
      }
      return (
        event.objectKind === "Pod" &&
        parts.length === 2 &&
        isGenerated(parts[0]) &&
        isGenerated(parts[1])
      );
    case KubernetesWorkloadKind.StatefulSet:
      return (
        event.objectKind === "Pod" && parts.length === 1 && isDigits(parts[0])
      );
    case KubernetesWorkloadKind.DaemonSet:
      return (
        event.objectKind === "Pod" &&
        parts.length === 1 &&
        isGenerated(parts[0])
      );
    case KubernetesWorkloadKind.Job:
      return event.objectKind === "Pod" && isJobPodSuffix(parts);
    case KubernetesWorkloadKind.CronJob:
      if (event.objectKind === "Job") {
        return parts.length === 1 && isDigits(parts[0]);
      }
      return (
        event.objectKind === "Pod" &&
        isDigits(parts[0]) &&
        isJobPodSuffix(parts.slice(1))
      );
    default:
      return false;
  }
}

export type KubernetesEventsAttributeFilter =
  | string
  | Includes
  | StartsWith<string>;

/*
 * The attribute filter of the logs a view reads: one cluster's Event
 * records, of the scope, narrowed by the filters. Everything but the
 * cluster and the Event marker is a stamped attribute, so a record stored
 * before ingest stamped them only matches the cluster's unfiltered list.
 */
export function buildKubernetesEventsAttributes(data: {
  clusterIdentifier: string;
  scope: KubernetesEventsScope;
  filters: KubernetesEventsFilters;
}): Record<string, KubernetesEventsAttributeFilter> {
  const attributes: Record<string, KubernetesEventsAttributeFilter> = {
    [KubernetesEventAttribute.Domain]: KUBERNETES_EVENT_DOMAIN,
    [KubernetesEventAttribute.ResourceName]: KUBERNETES_EVENTS_RESOURCE_NAME,
    [KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: data.clusterIdentifier,
  };

  if (data.filters.type === KubernetesEventsTypeFilter.Warning) {
    attributes[KubernetesEventAttribute.Type] = KubernetesEventType.Warning;
  } else if (data.filters.type === KubernetesEventsTypeFilter.Normal) {
    attributes[KubernetesEventAttribute.Type] = KubernetesEventType.Normal;
  }

  const scope: KubernetesEventsScope = data.scope;

  if (scope.kind === "namespace") {
    attributes[KubernetesEventAttribute.Namespace] = scope.namespace;
  } else if (scope.kind === "object") {
    attributes[KubernetesEventAttribute.ObjectKind] = scope.objectKind;
    attributes[KubernetesEventAttribute.ObjectName] = scope.objectName;

    if (scope.namespace) {
      attributes[KubernetesEventAttribute.Namespace] = scope.namespace;
    }
  } else if (scope.kind === "workload") {
    attributes[KubernetesEventAttribute.ObjectKind] = new Includes(
      WORKLOAD_EVENT_KINDS[scope.workloadKind],
    );
    // The workload itself and every name that starts with it; the rest by name.
    attributes[KubernetesEventAttribute.ObjectName] = new StartsWith<string>(
      scope.name,
    );

    if (scope.namespace) {
      attributes[KubernetesEventAttribute.Namespace] = scope.namespace;
    }
  }

  // A filter on what the scope already fixes is no filter.
  if (data.filters.namespace && scope.kind !== "namespace") {
    attributes[KubernetesEventAttribute.Namespace] = data.filters.namespace;
  }

  if (data.filters.reason) {
    attributes[KubernetesEventAttribute.Reason] = data.filters.reason;
  }

  if (data.filters.objectKind && scope.kind === "cluster") {
    attributes[KubernetesEventAttribute.ObjectKind] = data.filters.objectKind;
  }

  return attributes;
}

/*
 * The rows of a scope, from the records its query returned: a workload's
 * query matches by name prefix, and this keeps only what is the workload's.
 */
export function keepRowsOfScope(
  rows: Array<KubernetesEventRow>,
  scope: KubernetesEventsScope,
): Array<KubernetesEventRow> {
  if (scope.kind !== "workload") {
    return rows;
  }

  return rows.filter((row: KubernetesEventRow): boolean => {
    return isKubernetesEventAboutWorkload(row, {
      kind: scope.workloadKind,
      name: scope.name,
    });
  });
}

export interface KubernetesEventCounts {
  all: number;
  warning: number;
  normal: number;
}

export function countKubernetesEventRows(
  rows: Array<KubernetesEventRow>,
): KubernetesEventCounts {
  const warning: number = rows.filter((row: KubernetesEventRow): boolean => {
    return row.isWarning;
  }).length;

  return { all: rows.length, warning: warning, normal: rows.length - warning };
}

export function filterKubernetesEventRowsByType(
  rows: Array<KubernetesEventRow>,
  type: KubernetesEventsTypeFilter,
): Array<KubernetesEventRow> {
  if (type === KubernetesEventsTypeFilter.All) {
    return rows;
  }

  const wantsWarnings: boolean = type === KubernetesEventsTypeFilter.Warning;

  return rows.filter((row: KubernetesEventRow): boolean => {
    return row.isWarning === wantsWarnings;
  });
}

/*
 * The values a view's pickers offer: those of the rows it read, the most
 * frequent first, plus whatever is picked, so a picked value that matched
 * nothing can still be seen and taken off.
 */
export function getKubernetesEventPickerValues(
  rows: Array<KubernetesEventRow>,
  field: "namespace" | "reason" | "objectKind",
  picked?: string | undefined,
): Array<string> {
  const counts: Map<string, number> = new Map();

  for (const row of rows) {
    const value: string = row[field];

    if (value) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }

  if (picked && !counts.has(picked)) {
    counts.set(picked, 0);
  }

  return Array.from(counts.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map((entry: [string, number]): string => {
      return entry[0];
    });
}

/*
 * The warnings an overview shows: one line per reason and object - three
 * OOM kills on one node are one line that says 3 - newest first.
 */
export interface KubernetesWarningSummary {
  key: string;
  reason: string;
  message: string;
  objectKind: string;
  objectName: string;
  namespace: string;
  source: string;
  sourceHost: string;
  // Every time it happened, across the Events of this reason and object.
  count: number;
  lastSeenAt: Date | null;
}

export function summarizeKubernetesWarnings(
  rows: Array<KubernetesEventRow>,
  limit: number,
): Array<KubernetesWarningSummary> {
  const byKey: Map<string, KubernetesWarningSummary> = new Map();

  for (const row of sortKubernetesEventRows(rows)) {
    if (!row.isWarning) {
      continue;
    }

    const key: string = [
      row.reason,
      row.objectKind,
      row.objectName,
      row.namespace,
    ].join("\u0000");
    const known: KubernetesWarningSummary | undefined = byKey.get(key);

    if (known) {
      known.count += row.count;
      continue;
    }

    byKey.set(key, {
      key: key,
      reason: row.reason,
      message: row.message,
      objectKind: row.objectKind,
      objectName: row.objectName,
      namespace: row.namespace,
      source: row.source,
      sourceHost: row.sourceHost,
      count: row.count,
      lastSeenAt: row.lastSeenAt,
    });
  }

  return Array.from(byKey.values()).slice(0, limit);
}
