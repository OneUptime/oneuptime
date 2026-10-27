/**
 * A dashboard's auto-refresh (Types/Dashboard/DashboardAutoRefresh.ts, issue
 * #5080): the intervals, what a stored or sent value stands for, why a
 * write's value is refused, how a link names an interval, and which one a
 * viewer opens with - the link's ?refresh=, else their remembered pick, else
 * the dashboard's default, else off.
 */

import {
  DASHBOARD_AUTO_REFRESH_FALLBACK,
  DASHBOARD_AUTO_REFRESH_FIELD,
  DASHBOARD_AUTO_REFRESH_INTERVALS,
  DASHBOARD_AUTO_REFRESH_LINK_PARAMETER,
  DASHBOARD_AUTO_REFRESH_PROBLEM,
  getDashboardAutoRefreshInterval,
  getDashboardAutoRefreshProblem,
  getDashboardLinkAutoRefreshIntervalFromSearch,
  isDashboardAutoRefreshInterval,
  parseDashboardAutoRefreshInterval,
  parseDashboardLinkAutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardAutoRefresh";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
import { DashboardSettingSource } from "../../../Types/Dashboard/DashboardViewerChoice";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

describe("the intervals", () => {
  test("are every interval the auto-refresh menu offers, in its order", () => {
    expect(DASHBOARD_AUTO_REFRESH_INTERVALS).toEqual(
      Object.values(AutoRefreshInterval),
    );
    expect(DASHBOARD_AUTO_REFRESH_INTERVALS).toEqual([
      "off",
      "5s",
      "10s",
      "30s",
      "1m",
      "5m",
      "15m",
    ]);
  });

  test("a dashboard that names none opens with auto-refresh off, as it always did", () => {
    expect(DASHBOARD_AUTO_REFRESH_FALLBACK).toBe(AutoRefreshInterval.OFF);
  });

  test("the default stays refreshInterval in the dashboard's config", () => {
    expect(DASHBOARD_AUTO_REFRESH_FIELD).toBe("refreshInterval");
  });

  test.each(
    Object.values(AutoRefreshInterval).map(
      (interval: AutoRefreshInterval): Array<AutoRefreshInterval> => {
        return [interval];
      },
    ),
  )("%s is one", (interval: AutoRefreshInterval) => {
    expect(isDashboardAutoRefreshInterval(interval)).toBe(true);
    expect(parseDashboardAutoRefreshInterval(interval)).toBe(interval);
  });

  test.each([
    ["another case", "1M"],
    ["an interval the menu does not offer", "2m"],
    ["words", "every minute"],
    ["an empty string", ""],
    ["a number of milliseconds", 60000],
    ["null", null],
    ["nothing", undefined],
  ])("%s is none", (_what: string, value: unknown) => {
    expect(isDashboardAutoRefreshInterval(value)).toBe(false);
    expect(parseDashboardAutoRefreshInterval(value)).toBeNull();
  });
});

describe("what a write's config may hold", () => {
  test("no interval at all is fine: auto-refresh off", () => {
    expect(getDashboardAutoRefreshProblem(undefined)).toBeNull();
    expect(getDashboardAutoRefreshProblem(null)).toBeNull();
  });

  test.each(
    Object.values(AutoRefreshInterval).map(
      (interval: AutoRefreshInterval): Array<AutoRefreshInterval> => {
        return [interval];
      },
    ),
  )("%s is saved", (interval: AutoRefreshInterval) => {
    expect(getDashboardAutoRefreshProblem(interval)).toBeNull();
  });

  test.each([
    ["another case", "OFF"],
    ["an interval the menu does not offer", "2m"],
    ["a number", 60],
    ["an empty string", ""],
  ])("%s is refused", (_what: string, value: unknown) => {
    expect(getDashboardAutoRefreshProblem(value)).toBe(
      DASHBOARD_AUTO_REFRESH_PROBLEM,
    );
  });

  test("the refusal names the field, every interval and what leaving it out means", () => {
    expect(DASHBOARD_AUTO_REFRESH_PROBLEM).toBe(
      "dashboardViewConfig.refreshInterval must be one of off, 5s, 10s, 30s, 1m, 5m or 15m, or left out for off.",
    );
  });
});

describe("a link's own interval", () => {
  test("is the refresh parameter, spelled as the config spells it", () => {
    expect(DASHBOARD_AUTO_REFRESH_LINK_PARAMETER).toBe("refresh");
    expect(getDashboardLinkAutoRefreshIntervalFromSearch("?refresh=1m")).toBe(
      AutoRefreshInterval.ONE_MINUTE,
    );
    expect(
      getDashboardLinkAutoRefreshIntervalFromSearch(
        "?range=1d&refresh=off&var-region=eu",
      ),
    ).toBe(AutoRefreshInterval.OFF);
  });

  test.each([
    ["Off", AutoRefreshInterval.OFF],
    [" 30S ", AutoRefreshInterval.THIRTY_SECONDS],
    ["15M", AutoRefreshInterval.FIFTEEN_MINUTES],
  ])(
    "%s is read in any case, as people type it",
    (written: string, interval: AutoRefreshInterval) => {
      expect(parseDashboardLinkAutoRefreshInterval(written)).toBe(interval);
    },
  );

  test.each([
    ["an interval the menu does not offer", "2m"],
    ["an empty value", ""],
    ["no value", null],
    ["far too long to be one", `${" ".repeat(400000)}1m`],
  ])("%s is no interval", (_what: string, value: unknown) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(parseDashboardLinkAutoRefreshInterval(value)).toBeNull();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("an address without one names none", () => {
    expect(getDashboardLinkAutoRefreshIntervalFromSearch("")).toBeNull();
    expect(
      getDashboardLinkAutoRefreshIntervalFromSearch("?range=1d"),
    ).toBeNull();
  });
});

describe("the interval one viewer opens a dashboard with", () => {
  test("is the link's, else the viewer's own, else the dashboard's, else off", () => {
    expect(
      getDashboardAutoRefreshInterval({
        linkInterval: AutoRefreshInterval.TEN_SECONDS,
        viewerInterval: AutoRefreshInterval.FIVE_MINUTES,
        savedInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    ).toEqual({
      value: AutoRefreshInterval.TEN_SECONDS,
      source: DashboardSettingSource.Link,
    });

    expect(
      getDashboardAutoRefreshInterval({
        viewerInterval: AutoRefreshInterval.FIVE_MINUTES,
        savedInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    ).toEqual({
      value: AutoRefreshInterval.FIVE_MINUTES,
      source: DashboardSettingSource.Viewer,
    });

    expect(
      getDashboardAutoRefreshInterval({
        savedInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    ).toEqual({
      value: AutoRefreshInterval.ONE_MINUTE,
      source: DashboardSettingSource.Dashboard,
    });

    expect(getDashboardAutoRefreshInterval({})).toEqual({
      value: AutoRefreshInterval.OFF,
      source: DashboardSettingSource.Fallback,
    });
  });

  test("a viewer's own Off is a pick of theirs, which wins over a dashboard that refreshes", () => {
    expect(
      getDashboardAutoRefreshInterval({
        viewerInterval: AutoRefreshInterval.OFF,
        savedInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    ).toEqual({
      value: AutoRefreshInterval.OFF,
      source: DashboardSettingSource.Viewer,
    });
  });

  test("a value it cannot use says nothing", () => {
    expect(
      getDashboardAutoRefreshInterval({
        linkInterval: "2m" as AutoRefreshInterval,
        savedInterval: AutoRefreshInterval.FIVE_MINUTES,
      }),
    ).toEqual({
      value: AutoRefreshInterval.FIVE_MINUTES,
      source: DashboardSettingSource.Dashboard,
    });
  });
});
