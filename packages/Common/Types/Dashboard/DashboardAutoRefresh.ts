import { AutoRefreshInterval } from "./DashboardViewConfig";
import {
  DashboardSetting,
  resolveDashboardSetting,
} from "./DashboardViewerChoice";

/*
 * A dashboard's auto-refresh: how often every widget on it reads its data
 * again - off, or every 5 seconds to 15 minutes (AutoRefreshInterval).
 *
 * What a viewer opens on comes from the first of these that says one
 * (DashboardViewerChoice.ts):
 *
 *   1. the link's own interval, ?refresh=1m - a wall screen's address;
 *   2. the viewer's own pick from the toolbar's auto-refresh menu, which
 *      their browser remembers for that dashboard;
 *   3. the dashboard's default auto-refresh,
 *      DashboardViewConfig.refreshInterval, which its editors set in edit
 *      mode and save with it;
 *   4. off, as a dashboard that names none always opened.
 *
 * The default used to be saved as a side effect: Save Changes stamped
 * whatever interval the editor had last picked while viewing onto the
 * dashboard, so an editor who had turned refresh off for a while turned it
 * off for everyone with an unrelated save. It is set on purpose now, in edit
 * mode, and a save keeps what the dashboard had unless that was changed.
 *
 * Through the API and Terraform the default is `refreshInterval` in the
 * dashboard's dashboardViewConfig, as before; a write holding a value no
 * reader can use is refused (DashboardService).
 *
 * React-free and browser-free: the API, the dashboard, the public dashboard
 * and their tests read it.
 */

// The key the default is kept under in a dashboard's dashboardViewConfig.
export const DASHBOARD_AUTO_REFRESH_FIELD: string = "refreshInterval";

// What a dashboard that names no auto-refresh opens with: off.
export const DASHBOARD_AUTO_REFRESH_FALLBACK: AutoRefreshInterval =
  AutoRefreshInterval.OFF;

// The intervals, in the order the auto-refresh menu offers them.
export const DASHBOARD_AUTO_REFRESH_INTERVALS: ReadonlyArray<AutoRefreshInterval> =
  [
    AutoRefreshInterval.OFF,
    AutoRefreshInterval.FIVE_SECONDS,
    AutoRefreshInterval.TEN_SECONDS,
    AutoRefreshInterval.THIRTY_SECONDS,
    AutoRefreshInterval.ONE_MINUTE,
    AutoRefreshInterval.FIVE_MINUTES,
    AutoRefreshInterval.FIFTEEN_MINUTES,
  ];

/*
 * Whether a value is one of the intervals, exactly as AutoRefreshInterval
 * spells it: what a dashboard's config may hold.
 */
export function isDashboardAutoRefreshInterval(
  value: unknown,
): value is AutoRefreshInterval {
  return (
    typeof value === "string" &&
    (DASHBOARD_AUTO_REFRESH_INTERVALS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The interval a stored or sent value stands for, or null when it is none:
 * nothing at all, a value from an older or newer server, a typo. Read as
 * none, so the next place down decides.
 */
export function parseDashboardAutoRefreshInterval(
  value: unknown,
): AutoRefreshInterval | null {
  return isDashboardAutoRefreshInterval(value) ? value : null;
}

/*
 * Why a write's dashboardViewConfig cannot be saved for its auto-refresh, or
 * null when it can: one of the intervals, spelled exactly so, or nothing,
 * which is off. A dashboard read a value it did not know as off without a
 * word; an API or Terraform user now learns it at once.
 */
export const DASHBOARD_AUTO_REFRESH_PROBLEM: string = `dashboardViewConfig.refreshInterval must be one of ${DASHBOARD_AUTO_REFRESH_INTERVALS.slice(
  0,
  -1,
).join(", ")} or ${
  DASHBOARD_AUTO_REFRESH_INTERVALS[DASHBOARD_AUTO_REFRESH_INTERVALS.length - 1]
}, or left out for ${DASHBOARD_AUTO_REFRESH_FALLBACK}.`;

export function getDashboardAutoRefreshProblem(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return isDashboardAutoRefreshInterval(value)
    ? null
    : DASHBOARD_AUTO_REFRESH_PROBLEM;
}

/*
 * The query parameter a link names its own auto-refresh in: ?refresh=1m,
 * spelled as the config spells it (off, 5s, 10s, 30s, 1m, 5m or 15m).
 */
export const DASHBOARD_AUTO_REFRESH_LINK_PARAMETER: string = "refresh";

/*
 * Longer than any way a link may name an interval: such a value is read as
 * none without being looked at.
 */
const MAX_LINK_VALUE_LENGTH: number = 16;

/*
 * The interval a link names, or null when it names none it can be read as.
 * Read in any case and with spaces around it, as people type links.
 */
export function parseDashboardLinkAutoRefreshInterval(
  value: unknown,
): AutoRefreshInterval | null {
  if (typeof value !== "string" || value.length > MAX_LINK_VALUE_LENGTH) {
    return null;
  }

  return parseDashboardAutoRefreshInterval(value.trim().toLowerCase());
}

// The interval a page's address names in its query string (location.search).
export function getDashboardLinkAutoRefreshIntervalFromSearch(
  search: string,
): AutoRefreshInterval | null {
  try {
    return parseDashboardLinkAutoRefreshInterval(
      new URLSearchParams(search).get(DASHBOARD_AUTO_REFRESH_LINK_PARAMETER),
    );
  } catch {
    return null;
  }
}

/*
 * The auto-refresh a viewer opens a dashboard with, and where it came from:
 * the link's, their own remembered pick, the dashboard's default, else off.
 */
export function getDashboardAutoRefreshInterval(data: {
  linkInterval?: AutoRefreshInterval | null | undefined;
  viewerInterval?: AutoRefreshInterval | null | undefined;
  savedInterval?: AutoRefreshInterval | null | undefined;
}): DashboardSetting<AutoRefreshInterval> {
  return resolveDashboardSetting<AutoRefreshInterval>({
    link: parseDashboardAutoRefreshInterval(data.linkInterval),
    viewerPick: parseDashboardAutoRefreshInterval(data.viewerInterval),
    savedDefault: parseDashboardAutoRefreshInterval(data.savedInterval),
    fallback: DASHBOARD_AUTO_REFRESH_FALLBACK,
  });
}
