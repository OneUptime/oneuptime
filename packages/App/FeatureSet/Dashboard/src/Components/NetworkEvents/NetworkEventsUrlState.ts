import { NetworkEventsFilters, NetworkEventsScope } from "./NetworkEventsModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import {
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "Common/Types/NetworkEvent/NetworkEventType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * What an Events page is showing - its time range and its filters - kept
 * in the URL, so a link to a page lands on exactly that view, and a reload
 * keeps it.
 *
 * The query string is untrusted input: anything unreadable drops to its
 * default (the past day, no filter) rather than failing the page.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export const NETWORK_EVENTS_DEFAULT_RANGE: TimeRange = TimeRange.PAST_ONE_DAY;

export const NETWORK_EVENTS_URL_PARAMS: Array<string> = [
  "range",
  "start",
  "end",
  "kind",
  "event",
  "device",
];

// The longest a device's words or an event's name can be in a filter.
const MAX_FILTER_LENGTH: number = 256;

export interface NetworkEventsViewState {
  range: RangeStartAndEndDateTime;
  filters: NetworkEventsFilters;
}

export function getDefaultNetworkEventsView(): NetworkEventsViewState {
  return {
    range: { range: NETWORK_EVENTS_DEFAULT_RANGE },
    filters: {},
  };
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

    return { range: NETWORK_EVENTS_DEFAULT_RANGE };
  }

  if (range && (Object.values(TimeRange) as Array<string>).includes(range)) {
    return { range: range as TimeRange };
  }

  return { range: NETWORK_EVENTS_DEFAULT_RANGE };
}

function readFilters(
  read: (name: string) => string | null,
  scope: NetworkEventsScope,
): NetworkEventsFilters {
  const filters: NetworkEventsFilters = {};

  const kind: string = (read("kind") || "").trim();

  if ((Object.values(NetworkEventKind) as Array<string>).includes(kind)) {
    filters.kind = kind as NetworkEventKind;
  }

  const event: string = (read("event") || "").trim();

  // A built-in event or one a project named: anything else is not a name.
  if (NetworkEventTypeUtil.isValidName(event)) {
    filters.event = event;
  }

  const device: string = (read("device") || "").trim();

  // One device's page is that device's already.
  if (
    scope.kind === "network" &&
    device &&
    device.length <= MAX_FILTER_LENGTH
  ) {
    filters.device = device;
  }

  return filters;
}

export function readNetworkEventsView(
  read: (name: string) => string | null,
  scope: NetworkEventsScope,
): NetworkEventsViewState {
  return {
    range: readRange(read),
    filters: readFilters(read, scope),
  };
}

/*
 * The view as query parameters. Every parameter the page owns is present:
 * an empty value removes it from the URL, so a filter that was taken off
 * does not linger in the address bar.
 */
export function toNetworkEventsUrlParams(
  view: NetworkEventsViewState,
): Dictionary<string> {
  const params: Dictionary<string> = {};

  for (const name of NETWORK_EVENTS_URL_PARAMS) {
    params[name] = "";
  }

  if (view.range.range === TimeRange.CUSTOM) {
    /*
     * A custom range is its two moments. Without them there is nothing to
     * write: "Custom" alone would be read back as the default range.
     */
    if (view.range.startAndEndDate) {
      params["range"] = TimeRange.CUSTOM;
      params["start"] = view.range.startAndEndDate.startValue.toISOString();
      params["end"] = view.range.startAndEndDate.endValue.toISOString();
    }
  } else if (view.range.range !== NETWORK_EVENTS_DEFAULT_RANGE) {
    params["range"] = view.range.range;
  }

  params["kind"] = view.filters.kind || "";
  params["event"] = view.filters.event || "";
  params["device"] = view.filters.device || "";

  return params;
}

export function hasNetworkEventsFilters(
  filters: NetworkEventsFilters,
): boolean {
  return Boolean(filters.kind || filters.event || filters.device);
}
