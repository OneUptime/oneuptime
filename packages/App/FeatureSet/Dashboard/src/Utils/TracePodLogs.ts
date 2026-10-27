import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import EntityType from "Common/Types/Telemetry/EntityType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  InventoryEntityKeyDisplaySource,
  buildInventoryEntityKeyDisplays,
} from "../Components/Inventory/InventoryTelemetryScope";
import { getInventoryTypeLabel } from "../Components/Inventory/InventoryTypeCatalog";
import { LockedEntityKeyDisplayMap } from "./LockedEntityKeyChips";
import { formatDurationNano } from "./TraceDetailPresentation";

/*
 * Logs from the pod a span ran in, read by pod and time instead of by trace
 * ID.
 *
 * An eBPF (OBI) span is recorded from outside the process, so the lines the
 * pod writes while serving it carry no trace context, and the trace's Logs -
 * read by trace ID - are empty for it. The span and those lines do share the pod: ingest stamps
 * the same `k8sPodEntityKey` (Common/Utils/Telemetry/EntityKey: cluster,
 * namespace and pod name) on both. That pod's logs over the span's own time,
 * with a little either side, show what it wrote while serving the request -
 * and, since a pod serves many requests at once, what it wrote for others
 * then too, which is why every place that shows them says so.
 *
 * Pure, so App/Tests can pin it in plain Node.
 */

/*
 * What a window adds either side of a span: a tenth of its length, at least
 * 100 ms and at most a second. The span and the pod's lines are timed by the
 * same node's clock, so they line up to the millisecond; the slack is for the
 * line a request writes as it finishes, and for writes the runtime buffers.
 */
export const POD_LOG_MIN_PADDING_MS: number = 100;
export const POD_LOG_MAX_PADDING_MS: number = 1000;
const POD_LOG_PADDING_SHARE: number = 0.1;

// The wider looks the span panel's Advanced section offers.
export const POD_LOG_WIDER_PADDINGS_MS: ReadonlyArray<number> = [
  1000, 10000, 60000,
];

/*
 * The span panel reads its window in two parts, split at the span's start:
 * the lines nearest before it, newest first, and the lines from its start
 * on, oldest first. One read, oldest first, would spend its whole limit on a
 * busy pod's lines from long before the span once the window is widened.
 */
export const SPAN_POD_LOG_LIMIT: number = 200;
export const SPAN_POD_LOG_BEFORE_LIMIT: number = 50;

/*
 * Most pods the trace's Logs tab reads. An eBPF trace crosses a pod or
 * three; past this the tab reads the first pods its spans name.
 */
export const TRACE_POD_LIMIT: number = 20;

const NANOS_PER_MS: number = 1000000;

export interface PodLogWindow {
  startTime: Date;
  endTime: Date;
  // Added either side of the span, in milliseconds.
  paddingMs: number;
}

export type PodLogLinePosition = "before" | "during" | "after";

export interface PodLogLineTiming {
  position: PodLogLinePosition;
  // From the span's start: "+1.27 ms", "-232 ms".
  offsetLabel: string;
}

export interface PodEntityKeySet {
  // Distinct keys in the order the spans name them, at most the limit.
  keys: Array<string>;
  // Distinct pods named, before the limit.
  totalCount: number;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }

  return Number.NaN;
}

/** The padding a span of this length gets either side by default. */
export function getPodLogPaddingMs(durationUnixNano: number): number {
  const durationMs: number = toNumber(durationUnixNano) / NANOS_PER_MS;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return POD_LOG_MIN_PADDING_MS;
  }

  return Math.min(
    POD_LOG_MAX_PADDING_MS,
    Math.max(
      POD_LOG_MIN_PADDING_MS,
      Math.round(durationMs * POD_LOG_PADDING_SHARE),
    ),
  );
}

/*
 * The window a span's pod logs are read over. Null when the span has no
 * usable start. A log's time is kept to the nanosecond and a Date to the
 * millisecond, so the span's own edges round outwards: its first and last
 * lines are never cut off.
 */
export function getPodLogWindow(args: {
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  paddingMs?: number | undefined;
}): PodLogWindow | null {
  const start: number = toNumber(args.startTimeUnixNano);

  if (!Number.isFinite(start) || start <= 0) {
    return null;
  }

  const rawEnd: number = toNumber(args.endTimeUnixNano);
  const end: number =
    Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start;

  const paddingMs: number =
    typeof args.paddingMs === "number" &&
    Number.isFinite(args.paddingMs) &&
    args.paddingMs >= 0
      ? Math.round(args.paddingMs)
      : getPodLogPaddingMs(end - start);

  return {
    startTime: new Date(Math.floor(start / NANOS_PER_MS) - paddingMs),
    endTime: new Date(Math.ceil(end / NANOS_PER_MS) + paddingMs),
    paddingMs,
  };
}

/*
 * The paddings the span panel offers: the span's own default first, then the
 * wider looks, each once and widest last.
 */
export function getPodLogPaddingChoices(
  defaultPaddingMs: number,
): Array<number> {
  const choices: Array<number> = [defaultPaddingMs];

  for (const padding of POD_LOG_WIDER_PADDINGS_MS) {
    if (padding > defaultPaddingMs) {
      choices.push(padding);
    }
  }

  return choices;
}

/** "100 ms", "1 s", "1m": a padding as the panel names it. */
export function formatPodLogPadding(paddingMs: number): string {
  return formatDurationNano(paddingMs * NANOS_PER_MS);
}

/*
 * The pods a trace's spans ran in: trimmed, without blanks (a span outside a
 * pod carries ''), each once, in the order the spans name them - the spans
 * arrive in start order, so the request's first pod leads.
 */
export function collectPodEntityKeys(
  values: Iterable<string | null | undefined>,
  limit: number = TRACE_POD_LIMIT,
): PodEntityKeySet {
  const seen: Set<string> = new Set<string>();

  for (const value of values) {
    const key: string = typeof value === "string" ? value.trim() : "";

    if (key.length > 0) {
      seen.add(key);
    }
  }

  const all: Array<string> = Array.from(seen);

  return {
    keys: all.slice(0, Math.max(0, limit)),
    totalCount: all.length,
  };
}

export interface SpanPodLogReads {
  // From the window's start to the span's start: read newest first.
  before: Query<Log>;
  // From the span's start to the window's end: read oldest first.
  fromStart: Query<Log>;
}

/*
 * The span panel's two reads: the pod's scalar key column, which has a bloom
 * filter index of its own, over each part of the window. They meet at the
 * millisecond the span starts in, so a line logged at exactly that instant
 * comes back from both (mergePodLogReads keeps it once). Null without a pod
 * or a start.
 */
export function buildSpanPodLogReads(args: {
  podEntityKey: string | null | undefined;
  startTimeUnixNano: number;
  window: PodLogWindow;
}): SpanPodLogReads | null {
  const podEntityKey: string = (args.podEntityKey || "").trim();
  const start: number = toNumber(args.startTimeUnixNano);

  if (!podEntityKey || !Number.isFinite(start) || start <= 0) {
    return null;
  }

  const spanStart: Date = new Date(
    Math.min(
      args.window.endTime.getTime(),
      Math.max(
        args.window.startTime.getTime(),
        Math.floor(start / NANOS_PER_MS),
      ),
    ),
  );

  return {
    before: {
      k8sPodEntityKey: podEntityKey,
      time: new InBetween<Date>(args.window.startTime, spanStart),
    } as Query<Log>,
    fromStart: {
      k8sPodEntityKey: podEntityKey,
      time: new InBetween<Date>(spanStart, args.window.endTime),
    } as Query<Log>,
  };
}

export interface MergedPodLogReads<T> {
  // Oldest first.
  logs: Array<T>;
  // The before read came back full: older lines in the window are not shown.
  isBeforeCut: boolean;
  // The from-start read came back full: later lines are not shown.
  isAfterCut: boolean;
}

function getLogRowKey(log: {
  _id?: unknown;
  timeUnixNano?: unknown;
  time?: unknown;
  body?: unknown;
}): string {
  const id: string = log._id ? String(log._id) : "";

  if (id) {
    return `id:${id}`;
  }

  return `line:${getLogTimeUnixNano(log)}|${String(log.body ?? "")}`;
}

/*
 * The two reads as one list, oldest first. The before read arrives newest
 * first and is turned round; a row both reads returned (logged at the very
 * millisecond they meet) is kept once, by its id.
 */
export function mergePodLogReads<
  T extends {
    _id?: unknown;
    timeUnixNano?: unknown;
    time?: unknown;
    body?: unknown;
  },
>(args: {
  before: ReadonlyArray<T>;
  fromStart: ReadonlyArray<T>;
  beforeLimit?: number | undefined;
  fromStartLimit?: number | undefined;
}): MergedPodLogReads<T> {
  const seen: Set<string> = new Set<string>();
  const logs: Array<T> = [];

  for (const log of [...args.before].reverse().concat(args.fromStart)) {
    const key: string = getLogRowKey(log);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    logs.push(log);
  }

  return {
    logs,
    isBeforeCut:
      args.before.length >= (args.beforeLimit ?? SPAN_POD_LOG_BEFORE_LIMIT),
    isAfterCut:
      args.fromStart.length >= (args.fromStartLimit ?? SPAN_POD_LOG_LIMIT),
  };
}

/*
 * The trace Logs tab's scope for the full log viewer. Its chart, facets and
 * locked chips read an entity scope from `entityKeys` and from nothing else,
 * so a `k8sPodEntityKey` filter there would narrow the list while the chart
 * counted the whole project. For a pod both select the same rows: the scalar
 * column is the pod's member of `entityKeys`. Null without a pod.
 */
export function buildTracePodLogQuery(args: {
  podEntityKeys: ReadonlyArray<string>;
  window: PodLogWindow;
}): Query<Log> | null {
  const podEntityKeys: Array<string> = collectPodEntityKeys(
    args.podEntityKeys,
    Number.MAX_SAFE_INTEGER,
  ).keys;

  if (podEntityKeys.length === 0) {
    return null;
  }

  return {
    entityKeys: new Includes(podEntityKeys),
    time: new InBetween<Date>(args.window.startTime, args.window.endTime),
  } as Query<Log>;
}

/*
 * A log line's time in nanoseconds: its own timeUnixNano when it has one,
 * else its time. NaN when it has neither.
 */
export function getLogTimeUnixNano(log: {
  timeUnixNano?: unknown;
  time?: unknown;
}): number {
  const nanos: number = toNumber(log.timeUnixNano);

  if (Number.isFinite(nanos) && nanos > 0) {
    return nanos;
  }

  if (log.time instanceof Date) {
    return log.time.getTime() * NANOS_PER_MS;
  }

  if (typeof log.time === "string") {
    const parsed: number = Date.parse(log.time);

    if (Number.isFinite(parsed)) {
      return parsed * NANOS_PER_MS;
    }
  }

  return Number.NaN;
}

/*
 * Where a line falls against the span - before it, during it or after it -
 * and how far from its start. Null for a line with no usable time.
 */
export function getPodLogLineTiming(args: {
  logTimeUnixNano: number;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
}): PodLogLineTiming | null {
  const logTime: number = toNumber(args.logTimeUnixNano);
  const start: number = toNumber(args.startTimeUnixNano);

  if (!Number.isFinite(logTime) || !Number.isFinite(start)) {
    return null;
  }

  const rawEnd: number = toNumber(args.endTimeUnixNano);
  const end: number =
    Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start;
  const offset: number = logTime - start;

  let position: PodLogLinePosition = "during";

  if (logTime < start) {
    position = "before";
  } else if (logTime > end) {
    position = "after";
  }

  return {
    position,
    offsetLabel:
      offset < 0
        ? `-${formatDurationNano(-offset)}`
        : `+${formatDurationNano(offset)}`,
  };
}

/*
 * The pod's name as the span's resource gives it (k8s.pod.name, stored with
 * the "resource." prefix); "" when it does not.
 */
export function getPodNameFromSpanAttributes(
  attributes: JSONObject | null | undefined,
): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  const value: unknown =
    attributes["resource.k8s.pod.name"] ?? attributes["k8s.pod.name"];

  return typeof value === "string" ? value.trim() : "";
}

/*
 * How the trace Logs tab's locked chips name its pods: by their Inventory
 * item where the project has one ("Kubernetes Pod: checkout-7d9f"), else as
 * a Kubernetes pod by its key - never the bare "Resource: <key>" a key
 * without a display falls back to.
 */
export function buildTracePodEntityKeyDisplays(args: {
  podEntityKeys: ReadonlyArray<string>;
  items: ReadonlyArray<InventoryEntityKeyDisplaySource>;
}): LockedEntityKeyDisplayMap {
  const wanted: Set<string> = new Set<string>(args.podEntityKeys);
  const displays: LockedEntityKeyDisplayMap = {};

  for (const key of args.podEntityKeys) {
    Object.defineProperty(displays, key, {
      value: {
        displayKey: getInventoryTypeLabel(EntityType.KubernetesPod),
        displayValue: key,
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  for (const item of args.items) {
    const key: string = (item.entityKey || "").trim();

    if (!wanted.has(key)) {
      continue;
    }

    const fromItem: LockedEntityKeyDisplayMap =
      buildInventoryEntityKeyDisplays(item);

    if (Object.prototype.hasOwnProperty.call(fromItem, key)) {
      Object.defineProperty(displays, key, {
        value: fromItem[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return displays;
}

export type TraceLogScope = "trace" | "pods";

/*
 * Which logs the trace's Logs tab opens on: those linked by its ID, unless
 * the trace ran in a pod and no log carries its ID - an eBPF trace - when it
 * opens on what its pods wrote while it ran. Null while the linked logs are
 * still being counted; a count that failed (undefined) keeps the linked view.
 */
export function getDefaultTraceLogScope(args: {
  podCount: number;
  linkedLogCount: number | null | undefined;
}): TraceLogScope | null {
  if (args.podCount <= 0) {
    return "trace";
  }

  if (args.linkedLogCount === null) {
    return null;
  }

  return args.linkedLogCount === 0 ? "pods" : "trace";
}

export interface PodLogLine<T> {
  log: T;
  offsetLabel: string;
}

export interface PodLogLineGroup<T> {
  position: PodLogLinePosition;
  lines: Array<PodLogLine<T>>;
}

const POD_LOG_LINE_POSITIONS: ReadonlyArray<PodLogLinePosition> = [
  "before",
  "during",
  "after",
];

/*
 * The lines read, split into what the pod wrote before the span, during it
 * and after it, in that order and each in the order read (oldest first).
 * Empty groups are left out; a line with no usable time is too, since it
 * cannot be placed.
 */
export function groupPodLogLines<
  T extends { timeUnixNano?: unknown; time?: unknown },
>(args: {
  logs: ReadonlyArray<T>;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
}): Array<PodLogLineGroup<T>> {
  const linesByPosition: Map<
    PodLogLinePosition,
    Array<PodLogLine<T>>
  > = new Map();

  for (const log of args.logs) {
    const timing: PodLogLineTiming | null = getPodLogLineTiming({
      logTimeUnixNano: getLogTimeUnixNano(log),
      startTimeUnixNano: args.startTimeUnixNano,
      endTimeUnixNano: args.endTimeUnixNano,
    });

    if (!timing) {
      continue;
    }

    const lines: Array<PodLogLine<T>> =
      linesByPosition.get(timing.position) || [];
    lines.push({ log, offsetLabel: timing.offsetLabel });
    linesByPosition.set(timing.position, lines);
  }

  return POD_LOG_LINE_POSITIONS.filter(
    (position: PodLogLinePosition): boolean => {
      return (linesByPosition.get(position) || []).length > 0;
    },
  ).map((position: PodLogLinePosition): PodLogLineGroup<T> => {
    return { position, lines: linesByPosition.get(position)! };
  });
}

/*
 * The words. Each sentence is looked up whole with the reader's translator,
 * so it reads wholly in their language or wholly in English.
 */

export const SPAN_POD_LOGS_TITLE: string = translationKey(
  "Logs from this pod during this span (not linked by trace ID)",
);

export const POD_LOGS_OTHER_REQUESTS: string = translationKey(
  "A pod serves many requests at once, so some of these lines may belong to other requests.",
);

export const SPAN_POD_LOGS_EMPTY: string = translationKey(
  "The pod wrote nothing in this window.",
);

export const SPAN_POD_LOGS_LOOK_AROUND: string = translationKey(
  "Look around the span",
);

export const SPAN_LOGS_NONE_LINKED: string = translationKey(
  "No logs carry this span's ID.",
);

export const TRACE_LOG_SCOPE_LABEL: string = translationKey("Which logs");

export const TRACE_LOG_SCOPE_LINKED: string =
  translationKey("Linked by trace ID");

export const TRACE_LOGS_LINKED_DESCRIPTION: string = translationKey(
  "Logs that carry this trace's ID, from every service it touched.",
);

const POD_LOG_GROUP_TITLES: Readonly<Record<PodLogLinePosition, string>> = {
  before: translationKey("Before the span"),
  during: translationKey("During the span"),
  after: translationKey("After the span"),
};

/** The heading over one group of the span panel's lines. */
export function getPodLogGroupTitle(
  translator: Translator,
  position: PodLogLinePosition,
): string {
  return translator.translateText(POD_LOG_GROUP_TITLES[position]) || "";
}

/*
 * The span panel's line under its heading: whose lines these are and over
 * which window.
 */
export function describeSpanPodLogWindow(args: {
  translator: Translator;
  podName?: string | null | undefined;
  paddingMs: number;
}): string {
  const padding: string = formatPodLogPadding(args.paddingMs);
  const podName: string = (args.podName || "").trim();

  if (podName) {
    return args.translator.translateTemplate(
      "What {{pod}} wrote from {{padding}} before this span to {{padding}} after it.",
      { pod: podName, padding },
    );
  }

  return args.translator.translateTemplate(
    "What the pod wrote from {{padding}} before this span to {{padding}} after it.",
    { padding },
  );
}

/*
 * Under a part of the list its read cut short: the lines before the span keep
 * the ones nearest it, the rest keep the first ones from its start.
 */
export function describePodLogCut(args: {
  translator: Translator;
  part: "before" | "fromStart";
}): string {
  if (args.part === "before") {
    return args.translator.translateTemplate(
      "Only the {{count}} lines nearest the span are shown.",
      { count: args.translator.formatNumber(SPAN_POD_LOG_BEFORE_LIMIT) },
    );
  }

  return args.translator.translateTemplate(
    "Only the first {{count}} lines from the span's start are shown.",
    { count: args.translator.formatNumber(SPAN_POD_LOG_LIMIT) },
  );
}

export const TRACE_LOG_SCOPE_ONE_POD: string = translationKey(
  "Same pod, same time",
);

export const TRACE_LOG_SCOPE_PODS: string = translationKey(
  "Same pods, same time",
);

/*
 * The trace Logs tab's choice that reads the pods by time, as an English key:
 * the segmented control looks its labels up itself.
 */
export function getTracePodLogScopeLabel(podCount: number): string {
  return podCount === 1 ? TRACE_LOG_SCOPE_ONE_POD : TRACE_LOG_SCOPE_PODS;
}

/*
 * The line over the trace Logs tab's pod view: which pods, over which window,
 * and that the lines are matched by pod and time rather than linked.
 */
export function describeTracePodLogScope(args: {
  translator: Translator;
  // Every pod the trace's spans name.
  podCount: number;
  // The pods read, at most TRACE_POD_LIMIT.
  shownPodCount: number;
  paddingMs: number;
}): string {
  const padding: string = formatPodLogPadding(args.paddingMs);

  if (args.shownPodCount < args.podCount) {
    return args.translator.translateTemplate(
      "What the first {{shown}} of this trace's {{count}} pods wrote from {{padding}} before the trace to {{padding}} after it, not linked by trace ID.",
      {
        shown: args.translator.formatNumber(args.shownPodCount),
        count: args.translator.formatNumber(args.podCount),
        padding,
      },
    );
  }

  if (args.podCount === 1) {
    return args.translator.translateTemplate(
      "What this trace's pod wrote from {{padding}} before the trace to {{padding}} after it, not linked by trace ID.",
      { padding },
    );
  }

  return args.translator.translateTemplate(
    "What this trace's {{count}} pods wrote from {{padding}} before the trace to {{padding}} after it, not linked by trace ID.",
    { count: args.translator.formatNumber(args.podCount), padding },
  );
}
