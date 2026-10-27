import { SpanEvent, SpanEventType } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { SpanSelfTime } from "Common/Utils/Traces/CriticalPath";
import { SpanTree, WaterfallNode, WaterfallSpan } from "./TraceWaterfall";

/*
 * What the trace detail page says about a trace: its headline numbers, the
 * per-service and per-operation rollups, span timing labels, attributes and
 * events. Pure functions over the waterfall model, unit tested.
 */

export const UNKNOWN_SERVICE_COLOR: string = "#94a3b8";
export const UNKNOWN_SERVICE_NAME: string = "Unknown service";

export interface TraceServiceInfo {
  id: string;
  name: string;
  color: string;
}

export function getServiceColor(service: Service | undefined): string {
  const color: string = service?.serviceColor?.toString() || "";
  return color.trim() || UNKNOWN_SERVICE_COLOR;
}

export function buildServiceInfoMap(
  services: Array<Service>,
): Map<string, TraceServiceInfo> {
  const map: Map<string, TraceServiceInfo> = new Map();
  for (const service of services) {
    const id: string = service._id?.toString() || service.id?.toString() || "";
    if (!id) {
      continue;
    }
    map.set(id, {
      id,
      name: service.name?.toString() || UNKNOWN_SERVICE_NAME,
      color: getServiceColor(service),
    });
  }
  return map;
}

export function getServiceInfo(
  serviceInfoById: Map<string, TraceServiceInfo>,
  serviceId: string,
): TraceServiceInfo {
  return (
    serviceInfoById.get(serviceId) || {
      id: serviceId,
      name: UNKNOWN_SERVICE_NAME,
      color: UNKNOWN_SERVICE_COLOR,
    }
  );
}

export function formatDurationNano(nanoseconds: number): string {
  return OneUptimeDate.getHumanizedDurationFromNanoseconds({
    nanoseconds: Math.max(0, nanoseconds),
  });
}

/** When a span starts relative to the trace: "+0 ms", "+12.4 ms". */
export function formatOffsetNano(nanoseconds: number): string {
  return `+${formatDurationNano(nanoseconds)}`;
}

/** The badge colours of a log line's severity in the span panel. */
export function getLogSeverityClassName(severity: string): string {
  const value: string = severity.toLowerCase();
  if (
    value.startsWith("err") ||
    value.startsWith("fatal") ||
    value.startsWith("crit")
  ) {
    return "bg-red-50 text-red-700";
  }
  if (value.startsWith("warn")) {
    return "bg-amber-50 text-amber-700";
  }
  if (value.startsWith("debug") || value.startsWith("trace")) {
    return "bg-gray-100 text-gray-600";
  }
  return "bg-sky-50 text-sky-700";
}

/** A share of a whole: "0%", "<1%", "7.5%", "42%", "100%". */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }
  if (value < 1) {
    return "<1%";
  }
  if (value < 10 && !Number.isInteger(value)) {
    return `${(Math.round(value * 10) / 10).toString()}%`;
  }
  return `${Math.round(Math.min(value, 100))}%`;
}

export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural || `${singular}s`}`;
}

export interface TraceSummary {
  rootSpan: WaterfallSpan | null;
  isError: boolean;
  startTime: Date | null;
  durationUnixNano: number;
  loadedSpanCount: number;
  totalSpanCount: number;
  errorCount: number;
  errorRatePercent: number;
  serviceCount: number;
  maxDepth: number;
  // Spans whose parent is not among the loaded spans.
  orphanCount: number;
}

/**
 * The trace's root is its earliest true root (a span with no parent). A
 * trace missing its root span falls back to its earliest orphan, so the
 * header always names the operation the reader is looking at.
 */
export function getRootSpan(tree: SpanTree): WaterfallSpan | null {
  const trueRoot: WaterfallNode | undefined = tree.roots.find(
    (node: WaterfallNode) => {
      return !node.isOrphan;
    },
  );
  return (trueRoot || tree.roots[0])?.span || null;
}

export function summarizeTrace(
  tree: SpanTree,
  totalSpanCount: number,
): TraceSummary {
  let errorCount: number = 0;
  let orphanCount: number = 0;
  const serviceIds: Set<string> = new Set();

  for (const node of tree.nodesById.values()) {
    if (node.span.isError) {
      errorCount += 1;
    }
    if (node.isOrphan) {
      orphanCount += 1;
    }
    if (node.span.serviceId) {
      serviceIds.add(node.span.serviceId);
    }
  }

  const loadedSpanCount: number = tree.spanCount;

  return {
    rootSpan: getRootSpan(tree),
    isError: errorCount > 0,
    startTime:
      loadedSpanCount > 0
        ? new Date(Math.floor(tree.startTimeUnixNano / 1000000))
        : null,
    durationUnixNano: tree.durationUnixNano,
    loadedSpanCount,
    totalSpanCount: Math.max(totalSpanCount, loadedSpanCount),
    errorCount,
    errorRatePercent:
      loadedSpanCount > 0 ? (errorCount / loadedSpanCount) * 100 : 0,
    serviceCount: serviceIds.size,
    maxDepth: loadedSpanCount > 0 ? tree.maxDepth + 1 : 0,
    orphanCount,
  };
}

export interface ServiceSummary extends TraceServiceInfo {
  spanCount: number;
  errorCount: number;
  selfTimeUnixNano: number;
  // Share of all self time in the trace; the shares add up to 100.
  percent: number;
}

/**
 * Where the trace's time went, per service. Uses self time (a span's
 * duration minus its children's), so time is counted once — a gateway
 * waiting on a slow payment call does not also claim the payment's time.
 */
export function summarizeServices(data: {
  spans: Array<WaterfallSpan>;
  selfTimes: Map<string, SpanSelfTime>;
  serviceInfoById: Map<string, TraceServiceInfo>;
}): Array<ServiceSummary> {
  const byService: Map<string, ServiceSummary> = new Map();
  let totalSelfTime: number = 0;

  for (const span of data.spans) {
    const existing: ServiceSummary | undefined = byService.get(span.serviceId);
    const summary: ServiceSummary = existing || {
      ...getServiceInfo(data.serviceInfoById, span.serviceId),
      spanCount: 0,
      errorCount: 0,
      selfTimeUnixNano: 0,
      percent: 0,
    };
    const selfTime: number = Math.max(
      0,
      data.selfTimes.get(span.spanId)?.selfTimeUnixNano ??
        span.durationUnixNano,
    );
    summary.spanCount += 1;
    summary.errorCount += span.isError ? 1 : 0;
    summary.selfTimeUnixNano += selfTime;
    totalSelfTime += selfTime;
    byService.set(span.serviceId, summary);
  }

  const summaries: Array<ServiceSummary> = [...byService.values()];
  for (const summary of summaries) {
    summary.percent =
      totalSelfTime > 0
        ? (summary.selfTimeUnixNano / totalSelfTime) * 100
        : 100 / summaries.length;
  }

  return summaries.sort(
    (left: ServiceSummary, right: ServiceSummary): number => {
      return (
        right.selfTimeUnixNano - left.selfTimeUnixNano ||
        right.spanCount - left.spanCount ||
        left.name.localeCompare(right.name)
      );
    },
  );
}

export interface OperationSummary {
  key: string;
  name: string;
  serviceId: string;
  count: number;
  errorCount: number;
  totalDurationUnixNano: number;
  selfTimeUnixNano: number;
  averageDurationUnixNano: number;
  maxDurationUnixNano: number;
  // The longest instance, opened when the row is chosen.
  slowestSpanId: string;
  // Most instances sharing a single parent — a high number smells like N+1.
  maxCallsFromOneParent: number;
  // Share of all self time in the trace.
  percentOfSelfTime: number;
}

export const REPEATED_CALL_THRESHOLD: number = 10;

/** Spans grouped by service and name: which operations cost the most. */
export function summarizeOperations(data: {
  spans: Array<WaterfallSpan>;
  selfTimes: Map<string, SpanSelfTime>;
}): Array<OperationSummary> {
  const byKey: Map<string, OperationSummary> = new Map();
  const callsByParent: Map<string, Map<string, number>> = new Map();
  let totalSelfTime: number = 0;

  for (const span of data.spans) {
    const key: string = `${span.serviceId}\u0000${span.name}`;
    const summary: OperationSummary = byKey.get(key) || {
      key,
      name: span.name,
      serviceId: span.serviceId,
      count: 0,
      errorCount: 0,
      totalDurationUnixNano: 0,
      selfTimeUnixNano: 0,
      averageDurationUnixNano: 0,
      maxDurationUnixNano: -1,
      slowestSpanId: span.spanId,
      maxCallsFromOneParent: 0,
      percentOfSelfTime: 0,
    };
    const selfTime: number = Math.max(
      0,
      data.selfTimes.get(span.spanId)?.selfTimeUnixNano ??
        span.durationUnixNano,
    );

    summary.count += 1;
    summary.errorCount += span.isError ? 1 : 0;
    summary.totalDurationUnixNano += span.durationUnixNano;
    summary.selfTimeUnixNano += selfTime;
    totalSelfTime += selfTime;
    if (span.durationUnixNano > summary.maxDurationUnixNano) {
      summary.maxDurationUnixNano = span.durationUnixNano;
      summary.slowestSpanId = span.spanId;
    }

    if (span.parentSpanId) {
      const parents: Map<string, number> = callsByParent.get(key) || new Map();
      const calls: number = (parents.get(span.parentSpanId) || 0) + 1;
      parents.set(span.parentSpanId, calls);
      callsByParent.set(key, parents);
      summary.maxCallsFromOneParent = Math.max(
        summary.maxCallsFromOneParent,
        calls,
      );
    } else {
      summary.maxCallsFromOneParent = Math.max(
        summary.maxCallsFromOneParent,
        1,
      );
    }

    byKey.set(key, summary);
  }

  const summaries: Array<OperationSummary> = [...byKey.values()];
  for (const summary of summaries) {
    summary.averageDurationUnixNano =
      summary.totalDurationUnixNano / summary.count;
    summary.maxDurationUnixNano = Math.max(0, summary.maxDurationUnixNano);
    summary.percentOfSelfTime =
      totalSelfTime > 0 ? (summary.selfTimeUnixNano / totalSelfTime) * 100 : 0;
  }

  return sortOperations(summaries, "selfTime", "desc");
}

export type OperationSortKey =
  | "name"
  | "count"
  | "errors"
  | "selfTime"
  | "total"
  | "average"
  | "max";

export type SortDirection = "asc" | "desc";

export function sortOperations(
  rows: Array<OperationSummary>,
  key: OperationSortKey,
  direction: SortDirection,
): Array<OperationSummary> {
  const valueOf: (row: OperationSummary) => number = (
    row: OperationSummary,
  ): number => {
    switch (key) {
      case "count":
        return row.count;
      case "errors":
        return row.errorCount;
      case "total":
        return row.totalDurationUnixNano;
      case "average":
        return row.averageDurationUnixNano;
      case "max":
        return row.maxDurationUnixNano;
      default:
        return row.selfTimeUnixNano;
    }
  };
  const sign: number = direction === "asc" ? 1 : -1;

  return [...rows].sort(
    (left: OperationSummary, right: OperationSummary): number => {
      const primary: number =
        key === "name"
          ? left.name.localeCompare(right.name)
          : valueOf(left) - valueOf(right);
      return (
        sign * primary ||
        left.name.localeCompare(right.name) ||
        left.key.localeCompare(right.key)
      );
    },
  );
}

export interface SpanLoadState {
  loadedSpanCount: number;
  totalSpanCount: number;
  hasMore: boolean;
  remainingSpanCount: number;
  // What "Load next" would fetch.
  nextBatchSize: number;
}

/**
 * Batch-loading arithmetic for a trace larger than one page of spans. A
 * total the server did not report (0) never claims more spans exist.
 */
export function getSpanLoadState(data: {
  loadedSpanCount: number;
  totalSpanCount: number;
  pageSize: number;
}): SpanLoadState {
  const loadedSpanCount: number = Math.max(0, data.loadedSpanCount);
  const totalSpanCount: number = Math.max(loadedSpanCount, data.totalSpanCount);
  const remainingSpanCount: number = totalSpanCount - loadedSpanCount;
  return {
    loadedSpanCount,
    totalSpanCount,
    hasMore: remainingSpanCount > 0,
    remainingSpanCount,
    nextBatchSize: Math.min(Math.max(1, data.pageSize), remainingSpanCount),
  };
}

export interface AttributeEntry {
  key: string;
  value: string;
}

/** Flatten (possibly nested) attributes into sorted dotted key/value pairs. */
export function flattenSpanAttributes(
  attributes: JSONObject | undefined | null,
  prefix: string = "",
): Array<AttributeEntry> {
  if (!attributes || typeof attributes !== "object") {
    return [];
  }
  const entries: Array<AttributeEntry> = [];
  for (const key of Object.keys(attributes)) {
    const value: unknown = (attributes as Record<string, unknown>)[key];
    const fullKey: string = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenSpanAttributes(value as JSONObject, fullKey));
    } else {
      entries.push({
        key: fullKey,
        value: Array.isArray(value) ? JSON.stringify(value) : String(value),
      });
    }
  }
  return prefix
    ? entries
    : entries.sort((left: AttributeEntry, right: AttributeEntry): number => {
        return left.key.localeCompare(right.key);
      });
}

export function filterAttributeEntries(
  entries: Array<AttributeEntry>,
  text: string,
): Array<AttributeEntry> {
  const needle: string = text.trim().toLowerCase();
  if (!needle) {
    return entries;
  }
  return entries.filter((entry: AttributeEntry) => {
    return (
      entry.key.toLowerCase().includes(needle) ||
      entry.value.toLowerCase().includes(needle)
    );
  });
}

export interface SpanEventRow {
  name: string;
  isException: boolean;
  // Exception message (or type) for exception events; the event name otherwise.
  title: string;
  offsetFromSpanStartUnixNano: number;
  offsetFromTraceStartUnixNano: number;
  attributes: Array<AttributeEntry>;
  // The event's attributes as recorded, types intact, for "Copy JSON".
  rawAttributes: JSONObject;
}

export function buildSpanEventRows(data: {
  events: Array<SpanEvent> | undefined | null;
  spanStartUnixNano: number;
  traceStartUnixNano: number;
}): Array<SpanEventRow> {
  return [...(data.events || [])]
    .map((event: SpanEvent): SpanEventRow => {
      const attributes: JSONObject = (event.attributes as JSONObject) || {};
      const isException: boolean =
        event.name?.toLowerCase() === SpanEventType.Exception;
      const time: number = Number(event.timeUnixNano) || data.spanStartUnixNano;
      return {
        name: event.name || "event",
        isException,
        title: isException
          ? attributes["exception.message"]?.toString() ||
            attributes["exception.type"]?.toString() ||
            "Exception"
          : event.name || "event",
        offsetFromSpanStartUnixNano: Math.max(0, time - data.spanStartUnixNano),
        offsetFromTraceStartUnixNano: Math.max(
          0,
          time - data.traceStartUnixNano,
        ),
        attributes: flattenSpanAttributes(attributes),
        rawAttributes: attributes,
      };
    })
    .sort((left: SpanEventRow, right: SpanEventRow): number => {
      return (
        left.offsetFromTraceStartUnixNano - right.offsetFromTraceStartUnixNano
      );
    });
}

/** The traces list search that finds spans carrying this attribute value. */
export function buildAttributeSearchQuery(key: string, value: string): string {
  return `@${key}:${buildSearchTokenValue(value)}`;
}

/**
 * This page's URL pointing at one span (the page highlights and opens
 * `?spanId=`). Other query parameters are kept.
 */
export function buildSpanShareUrl(currentHref: string, spanId: string): string {
  try {
    const url: globalThis.URL = new globalThis.URL(currentHref);
    url.searchParams.set("spanId", spanId);
    url.hash = "";
    return url.toString();
  } catch {
    return currentHref;
  }
}

export interface SpanTiming {
  offsetUnixNano: number;
  durationUnixNano: number;
  selfTimeUnixNano: number;
  selfTimePercent: number;
  // Position of the span inside the trace, 0..100.
  leftPercent: number;
  widthPercent: number;
}

export function getSpanTiming(data: {
  span: WaterfallSpan;
  selfTime: SpanSelfTime | undefined;
  traceStartUnixNano: number;
  traceDurationUnixNano: number;
}): SpanTiming {
  const offsetUnixNano: number = Math.max(
    0,
    data.span.startTimeUnixNano - data.traceStartUnixNano,
  );
  const selfTimeUnixNano: number = Math.max(
    0,
    data.selfTime?.selfTimeUnixNano ?? data.span.durationUnixNano,
  );
  const duration: number = data.traceDurationUnixNano;
  return {
    offsetUnixNano,
    durationUnixNano: data.span.durationUnixNano,
    selfTimeUnixNano,
    selfTimePercent:
      data.span.durationUnixNano > 0
        ? Math.min(100, (selfTimeUnixNano / data.span.durationUnixNano) * 100)
        : 100,
    leftPercent:
      duration > 0 ? Math.min(100, (offsetUnixNano / duration) * 100) : 0,
    widthPercent:
      duration > 0
        ? Math.min(100, (data.span.durationUnixNano / duration) * 100)
        : 100,
  };
}

export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Split text into plain and matched runs for every search word, so a span
 * name can mark exactly what the search found. Overlapping and adjacent
 * matches merge into one run; matching is case-insensitive.
 */
export function splitHighlightSegments(
  text: string,
  searchText: string,
): Array<HighlightSegment> {
  const terms: Array<string> = searchText
    .toLowerCase()
    .split(/\s+/)
    .filter((term: string) => {
      return term.length > 0;
    });

  if (!text || terms.length === 0) {
    return text ? [{ text, isMatch: false }] : [];
  }

  const lower: string = text.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const term of terms) {
    let from: number = lower.indexOf(term);
    while (from !== -1) {
      ranges.push([from, from + term.length]);
      from = lower.indexOf(term, from + 1);
    }
  }

  if (ranges.length === 0) {
    return [{ text, isMatch: false }];
  }

  ranges.sort((left: [number, number], right: [number, number]): number => {
    return left[0] - right[0];
  });

  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last: [number, number] | undefined = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const segments: Array<HighlightSegment> = [];
  let cursor: number = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), isMatch: false });
    }
    segments.push({ text: text.slice(start, end), isMatch: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
  }

  return segments;
}

/** "4bf92f35…0e4736": enough of a long id to recognise it at a glance. */
export function abbreviateId(id: string, keep: number = 8): string {
  if (id.length <= keep * 2 + 1) {
    return id;
  }
  return `${id.slice(0, keep)}…${id.slice(-6)}`;
}
