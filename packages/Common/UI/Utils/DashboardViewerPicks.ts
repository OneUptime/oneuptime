import { parseDashboardAutoRefreshInterval } from "../../Types/Dashboard/DashboardAutoRefresh";
import { parseDashboardTimeRange } from "../../Types/Dashboard/DashboardTimeRange";
import { AutoRefreshInterval } from "../../Types/Dashboard/DashboardViewConfig";
import TimeRange from "../../Types/Time/TimeRange";
import RememberedChoice from "./RememberedChoice";

/*
 * What a viewer picked on a dashboard for themselves, which their browser
 * remembers for that dashboard - members inside OneUptime and visitors of a
 * public dashboard alike - so a refresh, a browser restart or a wall
 * screen's reboot opens it as they left it:
 *
 *   - the time range: one of the presets only (DASHBOARD_TIME_RANGES), never
 *     a custom start and end or a window a drag zoomed into, which would
 *     hold the dashboard on a moment in the past;
 *   - the auto-refresh interval.
 *
 * Each pick has its own entry, keyed by the dashboard, and is read back
 * through the setting's own parser, so an entry an older or newer version
 * wrote is read as no pick. Picking the setting's "Default (...)" choice
 * forgets the entry, and the dashboard's own default decides again
 * (Types/Dashboard/DashboardViewerChoice.ts).
 *
 * A later setting that each viewer may change - a list widget's sort, say
 * (issue #5082) - is kept the same way: readPick and rememberPick with a
 * name of its own.
 *
 * React-free.
 */

// The start of every entry's key, parallel to the public dashboard theme's.
export const DASHBOARD_VIEWER_PICK_KEY_PREFIX: string = "oneuptime-dashboard";

export const DASHBOARD_TIME_RANGE_PICK: string = "time-range";

export const DASHBOARD_AUTO_REFRESH_PICK: string = "auto-refresh";

/*
 * The key a pick is kept under: oneuptime-dashboard-time-range:<dashboard
 * id>. The id is the dashboard's, as one dashboard's pick must never reach
 * another's.
 */
export function getDashboardViewerPickKey(
  dashboardId: string,
  pickName: string,
): string {
  return `${DASHBOARD_VIEWER_PICK_KEY_PREFIX}-${pickName}:${dashboardId
    .toString()
    .trim()
    .toLowerCase()}`;
}

export default class DashboardViewerPicks {
  // What the browser keeps of a pick, read through its own parser, or null.
  public static readPick<T>(data: {
    dashboardId: string;
    pickName: string;
    parse: (value: unknown) => T | null;
  }): T | null {
    if (!data.dashboardId) {
      return null;
    }

    return data.parse(
      RememberedChoice.read(
        getDashboardViewerPickKey(data.dashboardId, data.pickName),
      ),
    );
  }

  // Remembers a pick, or forgets it (null): the way back to the default.
  public static rememberPick(data: {
    dashboardId: string;
    pickName: string;
    value: string | null;
  }): void {
    if (!data.dashboardId) {
      return;
    }

    const key: string = getDashboardViewerPickKey(
      data.dashboardId,
      data.pickName,
    );

    if (data.value === null) {
      RememberedChoice.forget(key);
      return;
    }

    RememberedChoice.remember(key, data.value);
  }

  // The time range the viewer picked on this dashboard, or null for none.
  public static getTimeRange(dashboardId: string): TimeRange | null {
    return DashboardViewerPicks.readPick<TimeRange>({
      dashboardId,
      pickName: DASHBOARD_TIME_RANGE_PICK,
      parse: parseDashboardTimeRange,
    });
  }

  /*
   * Remembers the viewer's time range, or forgets it (null). A range that
   * is not one of the presets - Custom, a zoom - is never remembered, and
   * leaves what was kept as it was.
   */
  public static setTimeRange(
    dashboardId: string,
    range: TimeRange | null,
  ): void {
    if (range !== null && parseDashboardTimeRange(range) === null) {
      return;
    }

    DashboardViewerPicks.rememberPick({
      dashboardId,
      pickName: DASHBOARD_TIME_RANGE_PICK,
      value: range,
    });
  }

  // The auto-refresh the viewer picked on this dashboard, or null for none.
  public static getAutoRefreshInterval(
    dashboardId: string,
  ): AutoRefreshInterval | null {
    return DashboardViewerPicks.readPick<AutoRefreshInterval>({
      dashboardId,
      pickName: DASHBOARD_AUTO_REFRESH_PICK,
      parse: parseDashboardAutoRefreshInterval,
    });
  }

  // Remembers the viewer's auto-refresh, or forgets it (null).
  public static setAutoRefreshInterval(
    dashboardId: string,
    interval: AutoRefreshInterval | null,
  ): void {
    if (
      interval !== null &&
      parseDashboardAutoRefreshInterval(interval) === null
    ) {
      return;
    }

    DashboardViewerPicks.rememberPick({
      dashboardId,
      pickName: DASHBOARD_AUTO_REFRESH_PICK,
      value: interval,
    });
  }
}
