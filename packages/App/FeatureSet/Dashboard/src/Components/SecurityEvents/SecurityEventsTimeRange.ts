import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * The time window the Security Events page is on - what the range picker
 * shows, what the volume chart buckets, and what the table under it lists.
 *
 * It lives in the URL (range / start / end, the same names the Logs, Traces
 * and Exceptions explorers use) so Back, a refresh and a pasted link all land
 * on the same window. Pure functions over the query string; the page does the
 * reading and writing.
 */

export const SECURITY_EVENTS_TABLE_ID: string = "security-events-table";

export const SECURITY_EVENTS_RANGE_PARAM: string = "range";
export const SECURITY_EVENTS_START_PARAM: string = "start";
export const SECURITY_EVENTS_END_PARAM: string = "end";

/*
 * A day rather than the explorers' hour: security events arrive in bursts
 * (a poll every few minutes, a detection now and then), and a day is the
 * shortest window that shows the shape of one.
 */
export const DEFAULT_SECURITY_EVENTS_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return isNaN(date.getTime()) ? null : date;
}

function toCustomRange(
  start: Date,
  end: Date,
): RangeStartAndEndDateTime | null {
  if (start.getTime() >= end.getTime()) {
    return null;
  }

  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  };
}

/*
 * The range named by the page's own params, or null when there is none (or it
 * does not parse - a hand-edited link falls back to the default rather than
 * erroring).
 */
export function parseSecurityEventsTimeRange(
  search: string,
): RangeStartAndEndDateTime | null {
  const params: URLSearchParams = new URLSearchParams(search);
  const range: string | null = params.get(SECURITY_EVENTS_RANGE_PARAM);

  if (!range || !(Object.values(TimeRange) as Array<string>).includes(range)) {
    return null;
  }

  if (range !== TimeRange.CUSTOM) {
    return { range: range as TimeRange };
  }

  const start: Date | null = parseDate(params.get(SECURITY_EVENTS_START_PARAM));
  const end: Date | null = parseDate(params.get(SECURITY_EVENTS_END_PARAM));

  if (!start || !end) {
    return null;
  }

  return toCustomRange(start, end);
}

/*
 * Before the page had a range picker, time was one of the table's column
 * filters, and links were written that way - the connection diagnostics'
 * "view these events" among them. Such a link still names a window, so it is
 * honoured as the page's range; the table then drops the slice itself, since
 * it no longer offers a Time filter to put it in.
 */
export function parseLegacyTableTimeFilter(
  search: string,
): RangeStartAndEndDateTime | null {
  const raw: string | null = new URLSearchParams(search).get(
    TableFilterUrlState.getParamName(SECURITY_EVENTS_TABLE_ID, "filter"),
  );

  if (!raw) {
    return null;
  }

  try {
    const filter: JSONObject = JSONFunctions.deserialize(
      JSONFunctions.parseJSONObject(raw),
    );
    const time: unknown = filter["time"];

    if (!(time instanceof InBetween)) {
      return null;
    }

    const start: Date = new Date(time.startValue as Date);
    const end: Date = new Date(time.endValue as Date);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return null;
    }

    return toCustomRange(start, end);
  } catch {
    return null;
  }
}

/*
 * The attribute filters a legacy table-filter link carries.
 *
 * Before the events page was an explorer, "view the events this connection
 * imported" was written as a column filter on the model table -
 * `{"attributes": {"oneuptime.security.connection.id": "<id>"}}` under the
 * table's own URL param. Those links are in run histories and in people's
 * notes, so the explorer reads them back into its own facet chips rather
 * than silently opening an unfiltered list that looks like the right answer.
 *
 * Returns one entry per attribute key, in the `attributes.<key>` facet
 * grammar. Non-string values are dropped: a chip holds one literal, and an
 * operator object stringified into one would filter for nothing.
 */
export function parseLegacyTableAttributeFilters(
  search: string,
): Array<[string, string]> {
  const raw: string | null = new URLSearchParams(search).get(
    TableFilterUrlState.getParamName(SECURITY_EVENTS_TABLE_ID, "filter"),
  );

  if (!raw) {
    return [];
  }

  try {
    const filter: JSONObject = JSONFunctions.deserialize(
      JSONFunctions.parseJSONObject(raw),
    );
    const attributes: unknown = filter["attributes"];

    if (!attributes || typeof attributes !== "object") {
      return [];
    }

    const pairs: Array<[string, string]> = [];

    for (const [key, value] of Object.entries(
      attributes as Record<string, unknown>,
    )) {
      if (!key || typeof value !== "string" || value.length === 0) {
        continue;
      }

      pairs.push([`attributes.${key}`, value]);
    }

    return pairs;
  } catch {
    return [];
  }
}

export function readSecurityEventsTimeRange(
  search: string,
): RangeStartAndEndDateTime {
  return (
    parseSecurityEventsTimeRange(search) ||
    parseLegacyTableTimeFilter(search) ||
    DEFAULT_SECURITY_EVENTS_TIME_RANGE
  );
}

/*
 * The params to hand Navigation.setQueryString for a range. start / end are
 * nulled (so removed) for a relative range: "Past 1 Day" has to mean the day
 * before whenever the link is opened, not the day before it was copied.
 */
export function getSecurityEventsTimeRangeParams(
  timeRange: RangeStartAndEndDateTime,
): Dictionary<string | null> {
  const isCustom: boolean =
    timeRange.range === TimeRange.CUSTOM && Boolean(timeRange.startAndEndDate);

  return {
    [SECURITY_EVENTS_RANGE_PARAM]: isCustom
      ? TimeRange.CUSTOM
      : timeRange.range === TimeRange.CUSTOM
        ? DEFAULT_SECURITY_EVENTS_TIME_RANGE.range
        : timeRange.range,
    [SECURITY_EVENTS_START_PARAM]: isCustom
      ? new Date(timeRange.startAndEndDate!.startValue).toISOString()
      : null,
    [SECURITY_EVENTS_END_PARAM]: isCustom
      ? new Date(timeRange.startAndEndDate!.endValue).toISOString()
      : null,
  };
}

/*
 * The same, for a link built elsewhere (Route.addQueryParams takes values
 * verbatim, so they are encoded here).
 */
export function getSecurityEventsTimeRangeLinkParams(
  startDate: Date,
  endDate: Date,
): Dictionary<string> {
  return {
    [SECURITY_EVENTS_RANGE_PARAM]: encodeURIComponent(TimeRange.CUSTOM),
    [SECURITY_EVENTS_START_PARAM]: encodeURIComponent(startDate.toISOString()),
    [SECURITY_EVENTS_END_PARAM]: encodeURIComponent(endDate.toISOString()),
  };
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * Relative ranges widest-last, with how far back each is sure to reach. The
 * empty state uses this to offer the narrowest one that would bring the
 * newest event back into view. The month ranges step back calendar months,
 * so they are counted at their shortest (a February, and the 89 days of the
 * shortest three).
 */
const RELATIVE_RANGE_SPANS: Array<{ range: TimeRange; spanMs: number }> = [
  { range: TimeRange.PAST_ONE_HOUR, spanMs: 60 * 60 * 1000 },
  { range: TimeRange.PAST_ONE_DAY, spanMs: DAY_MS },
  { range: TimeRange.PAST_ONE_WEEK, spanMs: 7 * DAY_MS },
  { range: TimeRange.PAST_ONE_MONTH, spanMs: 28 * DAY_MS },
  { range: TimeRange.PAST_THREE_MONTHS, spanMs: 89 * DAY_MS },
];

/*
 * Kept off the very edge: "Past 1 Day" is reckoned from when it is picked, so
 * an event 23h59m old would slip out of it before the page finished loading.
 */
const COVERING_RANGE_MARGIN_MS: number = 5 * 60 * 1000;

export function getTimeRangeCovering(
  date: Date,
  now: Date,
): RangeStartAndEndDateTime {
  const ageMs: number = now.getTime() - date.getTime();

  for (const candidate of RELATIVE_RANGE_SPANS) {
    if (ageMs + COVERING_RANGE_MARGIN_MS <= candidate.spanMs) {
      return { range: candidate.range };
    }
  }

  // Older than every preset: from a day before it up to now.
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(date.getTime() - DAY_MS),
      now,
    ),
  };
}
