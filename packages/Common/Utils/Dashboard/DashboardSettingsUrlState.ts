import {
  DASHBOARD_AUTO_REFRESH_LINK_PARAMETER,
  getDashboardLinkAutoRefreshIntervalFromSearch,
  parseDashboardAutoRefreshInterval,
} from "../../Types/Dashboard/DashboardAutoRefresh";
import {
  DASHBOARD_TIME_RANGE_LINK_PARAMETER,
  getDashboardLinkTimeRangeFromSearch,
  getDashboardTimeRangeLinkValue,
} from "../../Types/Dashboard/DashboardTimeRange";
import { AutoRefreshInterval } from "../../Types/Dashboard/DashboardViewConfig";
import TimeRange from "../../Types/Time/TimeRange";

/*
 * A dashboard's time range and auto-refresh in its address, beside the
 * variables' var-<name> (VariableUrlState.ts): ?range=1d&refresh=1m.
 *
 * A link that names them opens the dashboard on them, whatever its defaults
 * and the viewer's own picks - a wall screen's address, or a link someone
 * copied. And the address bar carries the viewer's own picks as they make
 * them, so the link they copy opens on what they see. A dashboard on its
 * default names neither, so a link to it follows the default wherever it is
 * opened, and later, when an editor changes it.
 *
 * Values are written in the short forms (1d, 1m) and read in any of the
 * forms DashboardTimeRange.ts and DashboardAutoRefresh.ts accept.
 */

export interface DashboardSettingsInUrl {
  timeRange: TimeRange | null;
  refreshInterval: AutoRefreshInterval | null;
}

/*
 * What to write: a value sets its parameter, null takes it away (the
 * viewer is on the dashboard's default), and leaving it out leaves the
 * address's as it is.
 */
export interface DashboardSettingsUrlChange {
  timeRange?: TimeRange | null | undefined;
  refreshInterval?: AutoRefreshInterval | null | undefined;
}

export default class DashboardSettingsUrlState {
  // What an address's query string (location.search) names.
  public static parseFromSearch(search: string): DashboardSettingsInUrl {
    return {
      timeRange: getDashboardLinkTimeRangeFromSearch(search || ""),
      refreshInterval: getDashboardLinkAutoRefreshIntervalFromSearch(
        search || "",
      ),
    };
  }

  /*
   * The query string with the change made: only `range` and `refresh` are
   * touched, every other parameter stays where it was. Returned without its
   * "?" - empty when nothing is left.
   */
  public static applyToSearch(
    search: string,
    change: DashboardSettingsUrlChange,
  ): string {
    const params: URLSearchParams = new URLSearchParams(search || "");

    if (change.timeRange !== undefined) {
      const linkValue: string | null =
        change.timeRange === null
          ? null
          : getDashboardTimeRangeLinkValue(change.timeRange);

      if (linkValue) {
        params.set(DASHBOARD_TIME_RANGE_LINK_PARAMETER, linkValue);
      } else {
        params.delete(DASHBOARD_TIME_RANGE_LINK_PARAMETER);
      }
    }

    if (change.refreshInterval !== undefined) {
      const interval: AutoRefreshInterval | null =
        parseDashboardAutoRefreshInterval(change.refreshInterval);

      if (interval) {
        params.set(DASHBOARD_AUTO_REFRESH_LINK_PARAMETER, interval);
      } else {
        params.delete(DASHBOARD_AUTO_REFRESH_LINK_PARAMETER);
      }
    }

    return params.toString();
  }

  /*
   * Writes the change into the page's address without adding a history
   * entry, as the variables are written. No-op outside a browser, so
   * callers can run in tests and on a server.
   */
  public static writeToBrowserUrl(change: DashboardSettingsUrlChange): void {
    if (
      typeof window === "undefined" ||
      typeof window.history === "undefined" ||
      typeof window.location === "undefined"
    ) {
      return;
    }

    const url: URL = new URL(window.location.href);
    const nextSearch: string = DashboardSettingsUrlState.applyToSearch(
      url.search,
      change,
    );

    if (nextSearch === url.searchParams.toString()) {
      return;
    }

    const nextUrl: string = `${url.pathname}${
      nextSearch ? `?${nextSearch}` : ""
    }${url.hash || ""}`;

    window.history.replaceState(window.history.state, "", nextUrl);
  }
}
