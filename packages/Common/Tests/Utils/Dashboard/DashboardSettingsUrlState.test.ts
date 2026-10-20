/**
 * A dashboard's time range and auto-refresh in its address
 * (Common/Utils/Dashboard/DashboardSettingsUrlState.ts, issue #5080), beside
 * the variables' var-<name>: ?range=1d&refresh=1m.
 *
 *   - A link that names them is read in any form the vocabulary accepts.
 *   - The viewer's picks are written in the short forms, and a viewer on
 *     the dashboard's default names neither, so a link to it follows the
 *     default wherever and whenever it is opened.
 *   - Only `range` and `refresh` are touched: the variables, a public link's
 *     ?theme= and anything else stay where they were, and no history entry
 *     is added.
 */

import DashboardSettingsUrlState from "../../../Utils/Dashboard/DashboardSettingsUrlState";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
import TimeRange from "../../../Types/Time/TimeRange";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

afterEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("reading an address", () => {
  test("names the range and the interval it carries", () => {
    expect(
      DashboardSettingsUrlState.parseFromSearch(
        "?var-service=checkout&range=1d&refresh=1m",
      ),
    ).toEqual({
      timeRange: TimeRange.PAST_ONE_DAY,
      refreshInterval: AutoRefreshInterval.ONE_MINUTE,
    });
  });

  test("names nothing it cannot read", () => {
    expect(
      DashboardSettingsUrlState.parseFromSearch("?range=soon&refresh=2m"),
    ).toEqual({ timeRange: null, refreshInterval: null });
    expect(DashboardSettingsUrlState.parseFromSearch("")).toEqual({
      timeRange: null,
      refreshInterval: null,
    });
  });
});

describe("changing a query string", () => {
  test("writes a preset in its short form, and an interval as the config spells it", () => {
    expect(
      DashboardSettingsUrlState.applyToSearch("", {
        timeRange: TimeRange.PAST_ONE_WEEK,
        refreshInterval: AutoRefreshInterval.FIVE_MINUTES,
      }),
    ).toBe("range=7d&refresh=5m");
  });

  test("takes a setting away with null: the viewer is on the default", () => {
    expect(
      DashboardSettingsUrlState.applyToSearch("?range=7d&refresh=5m", {
        timeRange: null,
      }),
    ).toBe("refresh=5m");
    expect(
      DashboardSettingsUrlState.applyToSearch("?range=7d&refresh=5m", {
        refreshInterval: null,
      }),
    ).toBe("range=7d");
  });

  test("leaves a setting that the change does not name", () => {
    expect(
      DashboardSettingsUrlState.applyToSearch("?range=2d", {
        refreshInterval: AutoRefreshInterval.OFF,
      }),
    ).toBe("range=2d&refresh=off");
  });

  test("keeps the variables, a public link's theme and anything else where they were", () => {
    expect(
      DashboardSettingsUrlState.applyToSearch(
        "?var-service=checkout&theme=dark&range=1h&utm=wall",
        { timeRange: TimeRange.PAST_ONE_DAY },
      ),
    ).toBe("var-service=checkout&theme=dark&range=1d&utm=wall");
  });

  test("never writes a custom range: a link carries only a range that moves with the clock", () => {
    expect(
      DashboardSettingsUrlState.applyToSearch("?range=1d", {
        timeRange: TimeRange.CUSTOM,
      }),
    ).toBe("");
  });

  test("never writes an interval it does not know", () => {
    expect(
      DashboardSettingsUrlState.applyToSearch("?refresh=1m", {
        refreshInterval: "2m" as AutoRefreshInterval,
      }),
    ).toBe("");
  });
});

describe("writing the page's address", () => {
  test("replaces the address in place, keeping its path and hash, with no history entry", () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/p/dashboards/d?var-service=checkout#widgets",
    );
    const lengthBefore: number = window.history.length;

    DashboardSettingsUrlState.writeToBrowserUrl({
      timeRange: TimeRange.PAST_TWO_HOURS,
      refreshInterval: AutoRefreshInterval.TEN_SECONDS,
    });

    expect(window.location.pathname).toBe("/dashboard/p/dashboards/d");
    expect(window.location.search).toBe(
      "?var-service=checkout&range=2h&refresh=10s",
    );
    expect(window.location.hash).toBe("#widgets");
    expect(window.history.length).toBe(lengthBefore);
  });

  test("an address left with nothing has no ?", () => {
    window.history.replaceState(null, "", "/public-dashboard/d?range=1d");

    DashboardSettingsUrlState.writeToBrowserUrl({ timeRange: null });

    expect(window.location.href.endsWith("/public-dashboard/d")).toBe(true);
  });

  test("an address that already says it is not written again", () => {
    window.history.replaceState(null, "", "/public-dashboard/d?range=1d");
    const replaceState: SpyInstance<typeof window.history.replaceState> =
      jest.spyOn(window.history, "replaceState");

    DashboardSettingsUrlState.writeToBrowserUrl({
      timeRange: TimeRange.PAST_ONE_DAY,
    });
    DashboardSettingsUrlState.writeToBrowserUrl({ refreshInterval: null });

    expect(replaceState).not.toHaveBeenCalled();
  });
});
