/**
 * DashboardViewerPicks (Common/UI/Utils/DashboardViewerPicks.ts, issue
 * #5080): a viewer's own time range and auto-refresh, kept in their browser
 * for one dashboard - a member's inside OneUptime and a public visitor's
 * alike - so a refresh, a restart or a wall screen's reboot opens it as they
 * left it.
 *
 *   - Each dashboard has its own entries: one dashboard's pick never reaches
 *     another.
 *   - Only a preset range is kept, never Custom (a moment in the past).
 *   - An entry an older or newer version wrote, or a person typed into the
 *     browser's tools, is read as no pick.
 *   - null forgets: the "Default (...)" choice's way back.
 */

import DashboardViewerPicks, {
  DASHBOARD_AUTO_REFRESH_PICK,
  DASHBOARD_TIME_RANGE_PICK,
  DASHBOARD_VIEWER_PICK_KEY_PREFIX,
  getDashboardViewerPickKey,
} from "../../../UI/Utils/DashboardViewerPicks";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
import TimeRange from "../../../Types/Time/TimeRange";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const DASHBOARD_A: string = "db000000-0000-4000-8000-00000000000a";
const DASHBOARD_B: string = "db000000-0000-4000-8000-00000000000b";

const timeRangeKey: (dashboardId: string) => string = (
  dashboardId: string,
): string => {
  return `oneuptime-dashboard-time-range:${dashboardId}`;
};

const autoRefreshKey: (dashboardId: string) => string = (
  dashboardId: string,
): string => {
  return `oneuptime-dashboard-auto-refresh:${dashboardId}`;
};

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
});

afterEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
});

describe("where a pick is kept", () => {
  test("one entry per dashboard and setting, beside the public dashboard theme's", () => {
    expect(DASHBOARD_VIEWER_PICK_KEY_PREFIX).toBe("oneuptime-dashboard");
    expect(DASHBOARD_TIME_RANGE_PICK).toBe("time-range");
    expect(DASHBOARD_AUTO_REFRESH_PICK).toBe("auto-refresh");
    expect(getDashboardViewerPickKey(DASHBOARD_A, "time-range")).toBe(
      timeRangeKey(DASHBOARD_A),
    );
  });

  test("the dashboard's id is read however it is written, so one dashboard has one entry", () => {
    expect(
      getDashboardViewerPickKey(` ${DASHBOARD_A.toUpperCase()} `, "sort"),
    ).toBe(`oneuptime-dashboard-sort:${DASHBOARD_A}`);
  });
});

describe("a viewer's time range", () => {
  test("is kept for the dashboard it was picked on, and read back", () => {
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, TimeRange.PAST_TWO_DAYS);

    expect(window.localStorage.getItem(timeRangeKey(DASHBOARD_A))).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
    expect(DashboardViewerPicks.getTimeRange(DASHBOARD_A)).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
  });

  test("never reaches another dashboard", () => {
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, TimeRange.PAST_TWO_DAYS);

    expect(DashboardViewerPicks.getTimeRange(DASHBOARD_B)).toBeNull();
  });

  test("is forgotten with null, and only for that dashboard", () => {
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, TimeRange.PAST_TWO_DAYS);
    DashboardViewerPicks.setTimeRange(DASHBOARD_B, TimeRange.PAST_ONE_WEEK);
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, null);

    expect(window.localStorage.getItem(timeRangeKey(DASHBOARD_A))).toBeNull();
    expect(DashboardViewerPicks.getTimeRange(DASHBOARD_A)).toBeNull();
    expect(DashboardViewerPicks.getTimeRange(DASHBOARD_B)).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
  });

  test("a custom range is never kept, and leaves the kept preset as it was", () => {
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, TimeRange.PAST_THREE_HOURS);
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, TimeRange.CUSTOM);

    expect(DashboardViewerPicks.getTimeRange(DASHBOARD_A)).toBe(
      TimeRange.PAST_THREE_HOURS,
    );
  });

  test.each([
    ["Custom, written by hand", TimeRange.CUSTOM],
    ["a short form", "1d"],
    ["another case", "past 1 day"],
    ["anything else", "{}"],
  ])("an entry holding %s is no pick", (_what: string, kept: string) => {
    window.localStorage.setItem(timeRangeKey(DASHBOARD_A), kept);

    expect(DashboardViewerPicks.getTimeRange(DASHBOARD_A)).toBeNull();
  });

  test("a dashboard with no id keeps nothing and reads nothing", () => {
    DashboardViewerPicks.setTimeRange("", TimeRange.PAST_ONE_DAY);

    expect(window.localStorage.length).toBe(0);
    expect(DashboardViewerPicks.getTimeRange("")).toBeNull();
  });
});

describe("a viewer's auto-refresh", () => {
  test("is kept per dashboard, Off included - a pick of their own", () => {
    DashboardViewerPicks.setAutoRefreshInterval(
      DASHBOARD_A,
      AutoRefreshInterval.OFF,
    );
    DashboardViewerPicks.setAutoRefreshInterval(
      DASHBOARD_B,
      AutoRefreshInterval.THIRTY_SECONDS,
    );

    expect(window.localStorage.getItem(autoRefreshKey(DASHBOARD_A))).toBe(
      "off",
    );
    expect(DashboardViewerPicks.getAutoRefreshInterval(DASHBOARD_A)).toBe(
      AutoRefreshInterval.OFF,
    );
    expect(DashboardViewerPicks.getAutoRefreshInterval(DASHBOARD_B)).toBe(
      AutoRefreshInterval.THIRTY_SECONDS,
    );
  });

  test("is forgotten with null", () => {
    DashboardViewerPicks.setAutoRefreshInterval(
      DASHBOARD_A,
      AutoRefreshInterval.ONE_MINUTE,
    );
    DashboardViewerPicks.setAutoRefreshInterval(DASHBOARD_A, null);

    expect(DashboardViewerPicks.getAutoRefreshInterval(DASHBOARD_A)).toBeNull();
  });

  test("an interval it does not know is never kept, nor read", () => {
    DashboardViewerPicks.setAutoRefreshInterval(
      DASHBOARD_A,
      "2m" as AutoRefreshInterval,
    );

    expect(window.localStorage.getItem(autoRefreshKey(DASHBOARD_A))).toBeNull();

    window.localStorage.setItem(autoRefreshKey(DASHBOARD_A), "2m");

    expect(DashboardViewerPicks.getAutoRefreshInterval(DASHBOARD_A)).toBeNull();
  });

  test("is kept apart from the time range", () => {
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, TimeRange.PAST_ONE_DAY);
    DashboardViewerPicks.setAutoRefreshInterval(
      DASHBOARD_A,
      AutoRefreshInterval.FIVE_MINUTES,
    );
    DashboardViewerPicks.setTimeRange(DASHBOARD_A, null);

    expect(DashboardViewerPicks.getAutoRefreshInterval(DASHBOARD_A)).toBe(
      AutoRefreshInterval.FIVE_MINUTES,
    );
  });
});

describe("a later setting kept the same way", () => {
  // A list widget's sort, say (issue #5082): its own name, its own parser.
  const parseSort: (value: unknown) => string | null = (
    value: unknown,
  ): string | null => {
    return value === "name:asc" || value === "name:desc" ? value : null;
  };

  test("is kept and read back through its own parser", () => {
    DashboardViewerPicks.rememberPick({
      dashboardId: DASHBOARD_A,
      pickName: "widget-sort-1",
      value: "name:desc",
    });

    expect(
      DashboardViewerPicks.readPick<string>({
        dashboardId: DASHBOARD_A,
        pickName: "widget-sort-1",
        parse: parseSort,
      }),
    ).toBe("name:desc");

    window.localStorage.setItem(
      getDashboardViewerPickKey(DASHBOARD_A, "widget-sort-1"),
      "status:sideways",
    );

    expect(
      DashboardViewerPicks.readPick<string>({
        dashboardId: DASHBOARD_A,
        pickName: "widget-sort-1",
        parse: parseSort,
      }),
    ).toBeNull();
  });

  test("is forgotten with null", () => {
    DashboardViewerPicks.rememberPick({
      dashboardId: DASHBOARD_A,
      pickName: "widget-sort-1",
      value: "name:asc",
    });
    DashboardViewerPicks.rememberPick({
      dashboardId: DASHBOARD_A,
      pickName: "widget-sort-1",
      value: null,
    });

    expect(
      window.localStorage.getItem(
        getDashboardViewerPickKey(DASHBOARD_A, "widget-sort-1"),
      ),
    ).toBeNull();
  });
});
