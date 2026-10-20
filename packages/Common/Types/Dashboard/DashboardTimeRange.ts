import TimeRange from "../Time/TimeRange";
import {
  DashboardSetting,
  resolveDashboardSetting,
} from "./DashboardViewerChoice";

/*
 * A dashboard's time range: the window every chart, number, log and trace
 * widget on it reads.
 *
 * What a viewer opens on comes from the first of these that says one
 * (DashboardViewerChoice.ts):
 *
 *   1. the link's own range, ?range=1d - a wall screen's address, a
 *      colleague's link;
 *   2. the viewer's own pick from the toolbar's time range picker, which
 *      their browser remembers for that dashboard;
 *   3. the dashboard's default time range, DashboardViewConfig.timeRange,
 *      which its editors set in edit mode and save with it;
 *   4. the past hour, which every dashboard opened on before the setting -
 *      so a dashboard saved without one opens as it always has.
 *
 * Only a range that moves with the clock - one of the picker's presets,
 * "Past 5 Mins" to "Past 3 Months" - can be a default, be remembered or be
 * named by a link. A custom start and end, or a window a drag zoomed into,
 * is a moment in the past: kept, it would hold a wall screen on that moment
 * for good. Picking one still works; it lasts until the page is left.
 *
 * Through the API and Terraform the default is `timeRange` in the
 * dashboard's dashboardViewConfig, spelled as TimeRange spells it ("Past 1
 * Day"); a write holding anything else is refused (DashboardService), and a
 * stored value no reader can use is read as none (StoredDashboardViewConfig).
 *
 * React-free and browser-free: the API, the dashboard, the public dashboard
 * and their tests read it.
 */

// The key the default is kept under in a dashboard's dashboardViewConfig.
export const DASHBOARD_TIME_RANGE_FIELD: string = "timeRange";

/*
 * What a dashboard that names no time range opens on: the past hour, as
 * every dashboard did before the setting.
 */
export const DASHBOARD_TIME_RANGE_FALLBACK: TimeRange = TimeRange.PAST_ONE_HOUR;

/*
 * The ranges a dashboard may open on, a viewer's browser may remember and a
 * link may name: the time range picker's presets, shortest first. Never
 * Custom.
 */
export const DASHBOARD_TIME_RANGES: ReadonlyArray<TimeRange> = [
  TimeRange.PAST_FIVE_MINS,
  TimeRange.PAST_FIFTEEN_MINS,
  TimeRange.PAST_THIRTY_MINS,
  TimeRange.PAST_ONE_HOUR,
  TimeRange.PAST_TWO_HOURS,
  TimeRange.PAST_THREE_HOURS,
  TimeRange.PAST_ONE_DAY,
  TimeRange.PAST_TWO_DAYS,
  TimeRange.PAST_ONE_WEEK,
  TimeRange.PAST_TWO_WEEKS,
  TimeRange.PAST_ONE_MONTH,
  TimeRange.PAST_THREE_MONTHS,
];

/*
 * Whether a value is one of those ranges, exactly as TimeRange spells it:
 * what a dashboard's config may hold.
 */
export function isDashboardTimeRange(value: unknown): value is TimeRange {
  return (
    typeof value === "string" &&
    (DASHBOARD_TIME_RANGES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The range a stored or sent value stands for, or null when it is none a
 * dashboard can open on: nothing at all, Custom, a value from an older or
 * newer server, a typo. Read as none, so the next place down decides.
 */
export function parseDashboardTimeRange(value: unknown): TimeRange | null {
  return isDashboardTimeRange(value) ? value : null;
}

/*
 * Why a write's dashboardViewConfig cannot be saved for its time range, or
 * null when it can: one of the presets, spelled exactly as TimeRange spells
 * it, or nothing, which is the past hour. A value a reader would ignore is
 * refused instead, so an API or Terraform user learns at once that the
 * dashboard would not open where they meant it to.
 */
export const DASHBOARD_TIME_RANGE_PROBLEM: string = `dashboardViewConfig.timeRange must be one of ${DASHBOARD_TIME_RANGES.slice(
  0,
  -1,
).join(", ")} or ${
  DASHBOARD_TIME_RANGES[DASHBOARD_TIME_RANGES.length - 1]
}, or left out for ${DASHBOARD_TIME_RANGE_FALLBACK}.`;

export function getDashboardTimeRangeProblem(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return isDashboardTimeRange(value) ? null : DASHBOARD_TIME_RANGE_PROBLEM;
}

/*
 * The query parameter a link names its own time range in, beside the
 * variables' var-<name>: ?range=1d. The same name the Logs, Traces and
 * Metrics explorers keep their range in.
 */
export const DASHBOARD_TIME_RANGE_LINK_PARAMETER: string = "range";

/*
 * How a link writes each range, short enough to type into a wall screen's
 * address: the first form is what the dashboard writes into the address bar
 * when a viewer picks a range, the others are read too. A link may also
 * spell a range as TimeRange does ("Past 1 Day"), as the explorers write it.
 */
const LINK_VALUES_BY_RANGE: ReadonlyArray<{
  range: TimeRange;
  linkValues: ReadonlyArray<string>;
}> = [
  { range: TimeRange.PAST_FIVE_MINS, linkValues: ["5m"] },
  { range: TimeRange.PAST_FIFTEEN_MINS, linkValues: ["15m"] },
  { range: TimeRange.PAST_THIRTY_MINS, linkValues: ["30m"] },
  { range: TimeRange.PAST_ONE_HOUR, linkValues: ["1h"] },
  { range: TimeRange.PAST_TWO_HOURS, linkValues: ["2h"] },
  { range: TimeRange.PAST_THREE_HOURS, linkValues: ["3h"] },
  { range: TimeRange.PAST_ONE_DAY, linkValues: ["1d", "24h"] },
  { range: TimeRange.PAST_TWO_DAYS, linkValues: ["2d", "48h"] },
  { range: TimeRange.PAST_ONE_WEEK, linkValues: ["7d", "1w"] },
  { range: TimeRange.PAST_TWO_WEEKS, linkValues: ["14d", "2w"] },
  { range: TimeRange.PAST_ONE_MONTH, linkValues: ["1mo"] },
  { range: TimeRange.PAST_THREE_MONTHS, linkValues: ["3mo"] },
];

/*
 * The short forms the dashboard writes for each range, in the presets'
 * order: 5m, 15m, 30m, 1h, 2h, 3h, 1d, 2d, 7d, 14d, 1mo, 3mo.
 */
export const DASHBOARD_TIME_RANGE_LINK_VALUES: ReadonlyArray<string> =
  LINK_VALUES_BY_RANGE.map(
    (entry: { range: TimeRange; linkValues: ReadonlyArray<string> }) => {
      return entry.linkValues[0] as string;
    },
  );

// How the address bar names a range: its short form, or null for Custom.
export function getDashboardTimeRangeLinkValue(
  range: TimeRange,
): string | null {
  for (const entry of LINK_VALUES_BY_RANGE) {
    if (entry.range === range) {
      return entry.linkValues[0] || null;
    }
  }

  return null;
}

// A run of spaces, as one: "Past  1 Day" is "Past 1 Day".
const SPACES: RegExp = /\s+/;

/*
 * Longer than any way a link may name a range ("Past 3 Months" is the
 * longest): such a value is read as none without being looked at.
 */
const MAX_LINK_VALUE_LENGTH: number = 64;

/*
 * The range a link names, or null when it names none it can be read as.
 * Read in any case and with spaces around it, as people type links; any
 * other value is no range at all, so the link opens as it would without it.
 */
export function parseDashboardLinkTimeRange(value: unknown): TimeRange | null {
  if (typeof value !== "string" || value.length > MAX_LINK_VALUE_LENGTH) {
    return null;
  }

  const written: string = value.trim().toLowerCase().split(SPACES).join(" ");

  if (!written) {
    return null;
  }

  for (const entry of LINK_VALUES_BY_RANGE) {
    if (
      entry.linkValues.includes(written) ||
      entry.range.toLowerCase() === written
    ) {
      return entry.range;
    }
  }

  return null;
}

// The range a page's address names in its query string (location.search).
export function getDashboardLinkTimeRangeFromSearch(
  search: string,
): TimeRange | null {
  try {
    return parseDashboardLinkTimeRange(
      new URLSearchParams(search).get(DASHBOARD_TIME_RANGE_LINK_PARAMETER),
    );
  } catch {
    return null;
  }
}

/*
 * The time range a viewer opens a dashboard on, and where it came from: the
 * link's, their own remembered pick, the dashboard's default, else the past
 * hour. Each is handed in as read - null where it says none.
 */
export function getDashboardTimeRange(data: {
  linkTimeRange?: TimeRange | null | undefined;
  viewerTimeRange?: TimeRange | null | undefined;
  savedTimeRange?: TimeRange | null | undefined;
}): DashboardSetting<TimeRange> {
  return resolveDashboardSetting<TimeRange>({
    link: parseDashboardTimeRange(data.linkTimeRange),
    viewerPick: parseDashboardTimeRange(data.viewerTimeRange),
    savedDefault: parseDashboardTimeRange(data.savedTimeRange),
    fallback: DASHBOARD_TIME_RANGE_FALLBACK,
  });
}
