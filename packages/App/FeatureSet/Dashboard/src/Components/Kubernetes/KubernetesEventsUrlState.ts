import { KubernetesEventsTypeFilter } from "./KubernetesEventsModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * What a cluster's Events page is showing - its time range, which types
 * and the namespace, kind and reason it is narrowed to - kept in the URL,
 * so a link (the Overview's "View all warnings", a teammate's) lands on
 * exactly that view, and a reload keeps it.
 *
 * The query string is untrusted input: anything unreadable drops to its
 * default (the past day, warnings first, no filter) rather than failing.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export const KUBERNETES_EVENTS_DEFAULT_RANGE: TimeRange =
  TimeRange.PAST_ONE_DAY;

export const KUBERNETES_EVENTS_URL_PARAMS: Array<string> = [
  "range",
  "start",
  "end",
  "type",
  "namespace",
  "kind",
  "reason",
];

/*
 * The longest value a filter takes: a namespace or a Kind is at most 63
 * characters, a reason a CamelCase word.
 */
const MAX_FILTER_LENGTH: number = 128;

export interface KubernetesEventsViewState {
  range: RangeStartAndEndDateTime;
  /*
   * Which types the reader picked; undefined until they pick, when the page
   * shows the warnings if there are any, and every event otherwise.
   */
  type?: KubernetesEventsTypeFilter | undefined;
  namespace?: string | undefined;
  objectKind?: string | undefined;
  reason?: string | undefined;
}

export function getDefaultKubernetesEventsView(): KubernetesEventsViewState {
  return { range: { range: KUBERNETES_EVENTS_DEFAULT_RANGE } };
}

function readRange(
  read: (name: string) => string | null,
): RangeStartAndEndDateTime {
  const range: string | null = read("range");

  if (range === TimeRange.CUSTOM) {
    const start: Date = new Date(read("start") || "");
    const end: Date = new Date(read("end") || "");

    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      start.getTime() < end.getTime()
    ) {
      return {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      };
    }

    return { range: KUBERNETES_EVENTS_DEFAULT_RANGE };
  }

  if (range && (Object.values(TimeRange) as Array<string>).includes(range)) {
    return { range: range as TimeRange };
  }

  return { range: KUBERNETES_EVENTS_DEFAULT_RANGE };
}

function readText(
  read: (name: string) => string | null,
  name: string,
): string | undefined {
  const value: string = (read(name) || "").trim();

  if (!value || value.length > MAX_FILTER_LENGTH) {
    return undefined;
  }

  return value;
}

export function readKubernetesEventsView(
  read: (name: string) => string | null,
): KubernetesEventsViewState {
  const view: KubernetesEventsViewState = { range: readRange(read) };
  const type: string = (read("type") || "").trim();

  if (
    (Object.values(KubernetesEventsTypeFilter) as Array<string>).includes(type)
  ) {
    view.type = type as KubernetesEventsTypeFilter;
  }

  const namespace: string | undefined = readText(read, "namespace");
  const objectKind: string | undefined = readText(read, "kind");
  const reason: string | undefined = readText(read, "reason");

  if (namespace) {
    view.namespace = namespace;
  }

  if (objectKind) {
    view.objectKind = objectKind;
  }

  if (reason) {
    view.reason = reason;
  }

  return view;
}

/*
 * The view as query parameters. Every parameter the page owns is present:
 * an empty value removes it from the URL, so a filter that was taken off
 * does not linger in the address bar.
 */
export function toKubernetesEventsUrlParams(
  view: KubernetesEventsViewState,
): Dictionary<string> {
  const params: Dictionary<string> = {};

  for (const name of KUBERNETES_EVENTS_URL_PARAMS) {
    params[name] = "";
  }

  if (view.range.range === TimeRange.CUSTOM) {
    if (view.range.startAndEndDate) {
      params["range"] = TimeRange.CUSTOM;
      params["start"] = view.range.startAndEndDate.startValue.toISOString();
      params["end"] = view.range.startAndEndDate.endValue.toISOString();
    }
  } else if (view.range.range !== KUBERNETES_EVENTS_DEFAULT_RANGE) {
    params["range"] = view.range.range;
  }

  params["type"] = view.type || "";
  params["namespace"] = view.namespace || "";
  params["kind"] = view.objectKind || "";
  params["reason"] = view.reason || "";

  return params;
}

export function hasKubernetesEventsFilters(
  view: KubernetesEventsViewState,
): boolean {
  return Boolean(view.namespace || view.objectKind || view.reason);
}
