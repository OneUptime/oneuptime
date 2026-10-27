/**
 * A dashboard's time range (Types/Dashboard/DashboardTimeRange.ts, issue
 * #5080): which ranges a dashboard may open on, what a stored or sent value
 * stands for, why a write's value is refused, how a link names a range, and
 * which range one viewer opens on.
 *
 * The rule a viewer opens on is the first that says one - the link's own
 * ?range=, the viewer's remembered pick, the dashboard's saved default -
 * else the past hour, which every dashboard opened on before the setting.
 * The whole table is walked here, so a change to one rule cannot quietly
 * move another.
 */

import {
  DASHBOARD_TIME_RANGES,
  DASHBOARD_TIME_RANGE_FALLBACK,
  DASHBOARD_TIME_RANGE_FIELD,
  DASHBOARD_TIME_RANGE_LINK_PARAMETER,
  DASHBOARD_TIME_RANGE_LINK_VALUES,
  DASHBOARD_TIME_RANGE_PROBLEM,
  getDashboardLinkTimeRangeFromSearch,
  getDashboardTimeRange,
  getDashboardTimeRangeLinkValue,
  getDashboardTimeRangeProblem,
  isDashboardTimeRange,
  parseDashboardLinkTimeRange,
  parseDashboardTimeRange,
} from "../../../Types/Dashboard/DashboardTimeRange";
import { DashboardSettingSource } from "../../../Types/Dashboard/DashboardViewerChoice";
import TimeRange from "../../../Types/Time/TimeRange";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

const PRESETS_IN_ORDER: Array<TimeRange> = [
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

describe("the ranges a dashboard may open on", () => {
  test("are every preset of the time range picker, shortest first, and never Custom", () => {
    expect(DASHBOARD_TIME_RANGES).toEqual(PRESETS_IN_ORDER);
    expect(DASHBOARD_TIME_RANGES).not.toContain(TimeRange.CUSTOM);

    // Every range TimeRange knows, but the one that is a moment in the past.
    expect([...DASHBOARD_TIME_RANGES, TimeRange.CUSTOM].sort()).toEqual(
      Object.values(TimeRange).sort(),
    );
  });

  test("a dashboard that names none opens on the past hour, as every dashboard did before", () => {
    expect(DASHBOARD_TIME_RANGE_FALLBACK).toBe(TimeRange.PAST_ONE_HOUR);
    expect(DASHBOARD_TIME_RANGES).toContain(DASHBOARD_TIME_RANGE_FALLBACK);
  });

  test("the default is kept as timeRange in the dashboard's config, beside refreshInterval", () => {
    expect(DASHBOARD_TIME_RANGE_FIELD).toBe("timeRange");
  });

  test.each(
    PRESETS_IN_ORDER.map((range: TimeRange): Array<TimeRange> => {
      return [range];
    }),
  )("%s is one, exactly as TimeRange spells it", (range: TimeRange) => {
    expect(isDashboardTimeRange(range)).toBe(true);
    expect(parseDashboardTimeRange(range)).toBe(range);
  });

  test.each([
    ["Custom, a moment in the past", TimeRange.CUSTOM],
    ["another case", "past 1 day"],
    ["a link's short form", "1d"],
    ["the picker's label rather than the value", "Past 5 Minutes"],
    ["spaces around it", " Past 1 Day "],
    ["an empty string", ""],
    ["a number", 24],
    ["an object", { range: "Past 1 Day" }],
    ["null", null],
    ["nothing", undefined],
  ])(
    "%s is none: the next place down decides",
    (_what: string, value: unknown) => {
      expect(isDashboardTimeRange(value)).toBe(false);
      expect(parseDashboardTimeRange(value)).toBeNull();
    },
  );
});

describe("what a write's config may hold", () => {
  test("no time range at all is fine: the past hour", () => {
    expect(getDashboardTimeRangeProblem(undefined)).toBeNull();
    expect(getDashboardTimeRangeProblem(null)).toBeNull();
  });

  test.each(
    PRESETS_IN_ORDER.map((range: TimeRange): Array<TimeRange> => {
      return [range];
    }),
  )("%s is saved", (range: TimeRange) => {
    expect(getDashboardTimeRangeProblem(range)).toBeNull();
  });

  test.each([
    ["Custom", TimeRange.CUSTOM],
    ["another case", "past 1 day"],
    ["a link's short form", "24h"],
    ["an unknown range", "Past 1 Year"],
    ["an empty string", ""],
    ["a number", 1],
    ["a list", ["Past 1 Day"]],
  ])("%s is refused", (_what: string, value: unknown) => {
    expect(getDashboardTimeRangeProblem(value)).toBe(
      DASHBOARD_TIME_RANGE_PROBLEM,
    );
  });

  test("the refusal names the field, every range it may be, and what leaving it out means", () => {
    expect(DASHBOARD_TIME_RANGE_PROBLEM).toBe(
      "dashboardViewConfig.timeRange must be one of Past 5 Mins, Past 15 Mins, Past 30 Mins, Past 1 Hour, Past 2 Hours, Past 3 Hours, Past 1 Day, Past 2 Days, Past 1 Week, Past 2 Weeks, Past 1 Month or Past 3 Months, or left out for Past 1 Hour.",
    );
  });
});

describe("a link's own range", () => {
  test("is the range parameter, the name the explorers keep their range in", () => {
    expect(DASHBOARD_TIME_RANGE_LINK_PARAMETER).toBe("range");
  });

  test("the address bar writes each range in a short form", () => {
    expect(DASHBOARD_TIME_RANGE_LINK_VALUES).toEqual([
      "5m",
      "15m",
      "30m",
      "1h",
      "2h",
      "3h",
      "1d",
      "2d",
      "7d",
      "14d",
      "1mo",
      "3mo",
    ]);

    expect(
      PRESETS_IN_ORDER.map((range: TimeRange): string | null => {
        return getDashboardTimeRangeLinkValue(range);
      }),
    ).toEqual(DASHBOARD_TIME_RANGE_LINK_VALUES);
  });

  test.each(
    PRESETS_IN_ORDER.map((range: TimeRange): Array<TimeRange> => {
      return [range];
    }),
  )("%s reads back from its short form", (range: TimeRange) => {
    expect(
      parseDashboardLinkTimeRange(getDashboardTimeRangeLinkValue(range)),
    ).toBe(range);
  });

  test("a custom range has no short form: a link never pins a moment", () => {
    expect(getDashboardTimeRangeLinkValue(TimeRange.CUSTOM)).toBeNull();
  });

  test.each([
    ["24h", TimeRange.PAST_ONE_DAY],
    ["48h", TimeRange.PAST_TWO_DAYS],
    ["1w", TimeRange.PAST_ONE_WEEK],
    ["2w", TimeRange.PAST_TWO_WEEKS],
    ["1D", TimeRange.PAST_ONE_DAY],
    [" 7d ", TimeRange.PAST_ONE_WEEK],
    ["Past 1 Day", TimeRange.PAST_ONE_DAY],
    ["past 3 months", TimeRange.PAST_THREE_MONTHS],
    ["Past  5   Mins", TimeRange.PAST_FIVE_MINS],
  ])("%s is read as people type it", (written: string, range: TimeRange) => {
    expect(parseDashboardLinkTimeRange(written)).toBe(range);
  });

  test.each([
    ["Custom", "Custom"],
    ["a range no preset has", "6h"],
    ["minutes for a month", "1m"],
    ["a number alone", "24"],
    ["an empty value", ""],
    ["only spaces", "   "],
    ["no value at all", null],
    ["not text", 24],
  ])(
    "%s is no range: the link opens as it would without it",
    (_what: string, value: unknown) => {
      expect(parseDashboardLinkTimeRange(value)).toBeNull();
    },
  );

  test("is read from an address's query string, beside the variables", () => {
    expect(getDashboardLinkTimeRangeFromSearch("?range=1d")).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(
      getDashboardLinkTimeRangeFromSearch("?var-service=checkout&range=7d"),
    ).toBe(TimeRange.PAST_ONE_WEEK);
    // The explorers' spelling, as URLSearchParams decodes it.
    expect(getDashboardLinkTimeRangeFromSearch("?range=Past+2+Hours")).toBe(
      TimeRange.PAST_TWO_HOURS,
    );
    expect(getDashboardLinkTimeRangeFromSearch("range=3mo")).toBe(
      TimeRange.PAST_THREE_MONTHS,
    );
    expect(getDashboardLinkTimeRangeFromSearch("")).toBeNull();
    expect(getDashboardLinkTimeRangeFromSearch("?theme=dark")).toBeNull();
    expect(getDashboardLinkTimeRangeFromSearch("?range=soon")).toBeNull();
  });

  test("a hostile, megabyte-long value is read as none at once", () => {
    const longValue: string = `${" ".repeat(400000)}1d`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(parseDashboardLinkTimeRange(longValue)).toBeNull();
        expect(
          getDashboardLinkTimeRangeFromSearch(
            `?range=${encodeURIComponent(longValue)}`,
          ),
        ).toBeNull();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the range one viewer opens a dashboard on", () => {
  test("is the link's, whatever else says one", () => {
    expect(
      getDashboardTimeRange({
        linkTimeRange: TimeRange.PAST_ONE_WEEK,
        viewerTimeRange: TimeRange.PAST_TWO_HOURS,
        savedTimeRange: TimeRange.PAST_ONE_DAY,
      }),
    ).toEqual({
      value: TimeRange.PAST_ONE_WEEK,
      source: DashboardSettingSource.Link,
    });
  });

  test("else the viewer's own pick, over the dashboard's default", () => {
    expect(
      getDashboardTimeRange({
        viewerTimeRange: TimeRange.PAST_TWO_HOURS,
        savedTimeRange: TimeRange.PAST_ONE_DAY,
      }),
    ).toEqual({
      value: TimeRange.PAST_TWO_HOURS,
      source: DashboardSettingSource.Viewer,
    });
  });

  test("else the dashboard's default", () => {
    expect(
      getDashboardTimeRange({ savedTimeRange: TimeRange.PAST_ONE_DAY }),
    ).toEqual({
      value: TimeRange.PAST_ONE_DAY,
      source: DashboardSettingSource.Dashboard,
    });
  });

  test("else the past hour: a dashboard saved before the setting opens as it always has", () => {
    expect(getDashboardTimeRange({})).toEqual({
      value: TimeRange.PAST_ONE_HOUR,
      source: DashboardSettingSource.Fallback,
    });
  });

  test("a place that names a range it cannot open on says nothing, and the next one decides", () => {
    expect(
      getDashboardTimeRange({
        linkTimeRange: TimeRange.CUSTOM,
        viewerTimeRange: "a week, please" as TimeRange,
        savedTimeRange: TimeRange.PAST_THREE_MONTHS,
      }),
    ).toEqual({
      value: TimeRange.PAST_THREE_MONTHS,
      source: DashboardSettingSource.Dashboard,
    });

    expect(
      getDashboardTimeRange({
        savedTimeRange: TimeRange.CUSTOM,
      }),
    ).toEqual({
      value: TimeRange.PAST_ONE_HOUR,
      source: DashboardSettingSource.Fallback,
    });
  });
});
