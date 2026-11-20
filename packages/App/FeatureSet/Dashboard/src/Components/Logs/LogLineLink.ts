import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TimeRange from "Common/Types/Time/TimeRange";
import OneUptimeDate from "Common/Types/Date";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";

/*
 * A LINK TO ONE LOG LINE (#9794).
 *
 * Copy Link on a line's details (LogDetailsPanel) copies the Logs page's
 * address naming that line: `log`, its id, and `logTime`, when it was
 * written - the address a security event's View log line opens (#9620),
 * read by useOpenedLogLine. Whoever opens it gets that very line above the
 * list, read by its id with their own permissions: a line their role cannot
 * read is said to be not found, exactly as a line that is gone. The address
 * carries no key, no token and no session: only the line, and the list
 * under it.
 *
 * The list under it is the list the line was copied from, and stays so:
 * the explorer's chips (`filters`, as the explorer writes them to its own
 * address), over the window the list showed, pinned (`range=Custom`, its
 * start and end) - a relative window such as "past 1 hour" would show
 * whatever came in last when the link is opened, not the line's
 * neighbours. A list embedded elsewhere - a service's, a host's Logs tab -
 * is scoped by its page, which no chip names; there the line's own service
 * takes its place, so the list under the line is still its service's.
 *
 * React-free, so the address is pinned in a plain test.
 */

export interface LogLineLinkLine {
  // The line's id: a Log row's `_id`.
  id: string;
  // When it was written.
  time: Date | null;
  // What it was sent under: its service, host or other resource.
  primaryEntityId: string;
}

export interface LogLineLinkList {
  // The explorer's chips: facet key to its values.
  facetFilters: Map<string, Set<string>>;
  // The window the list showed; null when it is not known.
  window: { start: Date; end: Date } | null;
  /*
   * Whether the list is the Logs page's own, whose chips are all its
   * scope; else it is scoped by the page it is embedded in.
   */
  isLogsPage: boolean;
}

// The chip the explorer filters its list by service with.
const SERVICE_FACET_KEY: string = "primaryEntityId";

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/*
 * The chips the link carries: the list's own, and - for a list embedded in
 * another page - the line's service, where no chip names one.
 */
export function getLogLineLinkFilters(data: {
  line: LogLineLinkLine;
  list: LogLineLinkList;
}): Array<[string, Array<string>]> {
  const tuples: Array<[string, Array<string>]> = [];

  for (const [key, values] of data.list.facetFilters.entries()) {
    const kept: Array<string> = Array.from(values).filter(
      (value: string): boolean => {
        return typeof value === "string" && value.length > 0;
      },
    );

    if (key && kept.length > 0) {
      tuples.push([key, kept]);
    }
  }

  const serviceId: string = (data.line.primaryEntityId || "").trim();

  if (
    !data.list.isLogsPage &&
    serviceId &&
    !tuples.some((tuple: [string, Array<string>]): boolean => {
      return tuple[0] === SERVICE_FACET_KEY;
    })
  ) {
    tuples.push([SERVICE_FACET_KEY, [serviceId]]);
  }

  return tuples;
}

/*
 * The Logs page's query that opens the line, with the list under it. Null
 * for a line the link cannot name: one with no id, or an id that is not
 * one, which the Logs page would not open.
 */
export function getLogLineLinkParams(data: {
  line: LogLineLinkLine;
  list: LogLineLinkList;
}): Dictionary<string> | null {
  const logId: string = (data.line.id || "").trim();

  if (!logId || !ObjectID.isValidUUID(logId)) {
    return null;
  }

  const query: CrossSignalQueryParams = toLogsExplorerQueryParams({
    logId,
    logTime: isValidDate(data.line.time) ? data.line.time : undefined,
  });
  const params: Dictionary<string> = {};
  const filters: Array<[string, Array<string>]> = getLogLineLinkFilters(data);

  if (filters.length > 0) {
    params["filters"] = JSON.stringify(filters);
  }

  const window: { start: Date; end: Date } | null = data.list.window;

  if (window && isValidDate(window.start) && isValidDate(window.end)) {
    params["range"] = TimeRange.CUSTOM;
    params["start"] = OneUptimeDate.toString(window.start);
    params["end"] = OneUptimeDate.toString(window.end);
  }

  return { ...params, ...query.params };
}

/*
 * The whole address to copy: the Logs page (`logsPageUrl`, absolute) and
 * the query that opens the line. Null for a line the link cannot name.
 */
export function buildLogLineLink(data: {
  logsPageUrl: string;
  line: LogLineLinkLine;
  list: LogLineLinkList;
}): string | null {
  const params: Dictionary<string> | null = getLogLineLinkParams(data);

  if (!params) {
    return null;
  }

  let url: globalThis.URL;

  try {
    url = new globalThis.URL(data.logsPageUrl);
  } catch {
    return null;
  }

  // Only the line and its list: nothing the page's own address carried.
  url.search = "";
  url.hash = "";

  for (const key of Object.keys(params)) {
    url.searchParams.set(key, params[key] as string);
  }

  return url.toString();
}
