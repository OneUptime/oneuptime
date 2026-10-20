import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import useDashboardViewerSettings, {
  DashboardViewerSettings,
} from "../../../UI/Utils/UseDashboardViewerSettings";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { ObjectType } from "../../../Types/JSON";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * useDashboardViewerSettings (Common/UI/Utils/UseDashboardViewerSettings.ts,
 * issue #5080): a dashboard's time range and auto-refresh as one viewer has
 * them, shared by the dashboard inside OneUptime and the public one.
 *
 *   - It opens on the link's ?range= / ?refresh=, else the viewer's own pick
 *     that their browser remembers for this dashboard, else the dashboard's
 *     saved default (applied when its config loads), else the past hour with
 *     auto-refresh off.
 *   - A preset the viewer picks is remembered and written into the address;
 *     a custom range is shown and never kept.
 *   - "Default (...)" forgets the pick and takes it out of the address.
 *   - An editor who saves a new default is moved onto it.
 *
 * Read through a real component, as the shells use it.
 */

const DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000a1";
const OTHER_DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000b2";

const TIME_RANGE_KEY: string = `oneuptime-dashboard-time-range:${DASHBOARD_ID}`;
const AUTO_REFRESH_KEY: string = `oneuptime-dashboard-auto-refresh:${DASHBOARD_ID}`;

let latest: DashboardViewerSettings | null = null;
const seen: Array<DashboardViewerSettings> = [];

const Probe: FunctionComponent<{ dashboardId: string }> = (props: {
  dashboardId: string;
}): ReactElement => {
  const settings: DashboardViewerSettings = useDashboardViewerSettings({
    dashboardId: props.dashboardId,
  });

  latest = settings;
  seen.push(settings);

  return <span>{settings.timeRangeZoom.startAndEndDate.range}</span>;
};

function current(): DashboardViewerSettings {
  if (!latest) {
    throw new Error("The probe has not rendered.");
  }

  return latest;
}

function openAt(search: string): void {
  window.history.replaceState(
    null,
    "",
    `/dashboard/p/dashboards/${DASHBOARD_ID}${search}`,
  );
}

function mount(dashboardId: string = DASHBOARD_ID): void {
  render(<Probe dashboardId={dashboardId} />);
}

function config(defaults: {
  timeRange?: TimeRange | undefined;
  refreshInterval?: AutoRefreshInterval | undefined;
}): DashboardViewConfig {
  const value: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: [],
    heightInDashboardUnits: 10,
  };

  if (defaults.timeRange) {
    value.timeRange = defaults.timeRange;
  }

  if (defaults.refreshInterval) {
    value.refreshInterval = defaults.refreshInterval;
  }

  return value;
}

function applyDefaults(
  value: DashboardViewConfig,
  options?: { followChangedDefaults?: boolean },
): void {
  act(() => {
    current().applySavedDefaults(value, options);
  });
}

function boardRange(): TimeRange {
  return current().timeRangeZoom.startAndEndDate.range;
}

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

const PINNED: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-20T08:00:00.000Z"),
    new Date("2026-10-20T09:00:00.000Z"),
  ),
};

beforeEach(() => {
  latest = null;
  seen.length = 0;
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
});

describe("what a dashboard opens on", () => {
  test("one saved before the defaults: the past hour, auto-refresh off, the viewer on the default", () => {
    mount();
    applyDefaults(config({}));

    expect(boardRange()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(current().defaultTimeRange).toBe(TimeRange.PAST_ONE_HOUR);
    expect(current().isOnDefaultTimeRange).toBe(true);
    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.OFF);
    expect(current().defaultAutoRefreshInterval).toBe(AutoRefreshInterval.OFF);
    expect(current().isOnDefaultAutoRefresh).toBe(true);
  });

  test("one saved with defaults opens on them, once its config is read", () => {
    mount();

    // Before the config is read: the past hour, which nothing has asked for yet.
    expect(boardRange()).toBe(TimeRange.PAST_ONE_HOUR);

    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );

    expect(boardRange()).toBe(TimeRange.PAST_ONE_DAY);
    expect(current().defaultTimeRange).toBe(TimeRange.PAST_ONE_DAY);
    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.ONE_MINUTE);
    expect(current().defaultAutoRefreshInterval).toBe(
      AutoRefreshInterval.ONE_MINUTE,
    );
    expect(current().isOnDefaultTimeRange).toBe(true);
    expect(current().isOnDefaultAutoRefresh).toBe(true);
    // A viewer on the default names nothing in the address.
    expect(window.location.search).toBe("");
  });

  test("defaults it cannot use are read as none", () => {
    mount();
    applyDefaults({
      ...config({}),
      timeRange: TimeRange.CUSTOM,
      refreshInterval: "2m" as AutoRefreshInterval,
    });

    expect(boardRange()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.OFF);
  });

  test("the viewer's remembered pick wins over the dashboard's default, from the first render", () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    window.localStorage.setItem(AUTO_REFRESH_KEY, "30s");

    mount();

    // Already the viewer's own, before the config is read.
    expect(boardRange()).toBe(TimeRange.PAST_TWO_DAYS);

    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );

    expect(boardRange()).toBe(TimeRange.PAST_TWO_DAYS);
    expect(current().isOnDefaultTimeRange).toBe(false);
    expect(current().defaultTimeRange).toBe(TimeRange.PAST_ONE_DAY);
    expect(current().autoRefreshInterval).toBe(
      AutoRefreshInterval.THIRTY_SECONDS,
    );
    expect(current().isOnDefaultAutoRefresh).toBe(false);
    // The address carries the viewer's own picks, so a copied link opens on them.
    expect(param("range")).toBe("2d");
    expect(param("refresh")).toBe("30s");
  });

  test("a pick remembered for another dashboard is not this one's", () => {
    window.localStorage.setItem(
      `oneuptime-dashboard-time-range:${OTHER_DASHBOARD_ID}`,
      TimeRange.PAST_ONE_WEEK,
    );

    mount();
    applyDefaults(config({}));

    expect(boardRange()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a link's range and interval win over everything, and are never kept as the viewer's own", () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    window.localStorage.setItem(AUTO_REFRESH_KEY, "30s");
    openAt("?var-service=checkout&range=7d&refresh=5m");

    mount();
    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );

    expect(boardRange()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.FIVE_MINUTES);
    expect(current().isOnDefaultTimeRange).toBe(false);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBe("30s");
    // The variables stay where they were.
    expect(param("var-service")).toBe("checkout");
  });

  test("a link's value it cannot read is taken out of the address, and the next place decides", () => {
    openAt("?range=soon&refresh=2m&var-service=checkout");

    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    expect(boardRange()).toBe(TimeRange.PAST_ONE_DAY);
    expect(window.location.search).toBe("?var-service=checkout");
  });
});

describe("the viewer's own picks", () => {
  test("a preset is used, remembered for this dashboard and written into the address", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().pickTimeRange({ range: TimeRange.PAST_THREE_HOURS });
    });

    expect(boardRange()).toBe(TimeRange.PAST_THREE_HOURS);
    expect(current().isOnDefaultTimeRange).toBe(false);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_THREE_HOURS,
    );
    expect(param("range")).toBe("3h");
  });

  test("a preset equal to the default is still the viewer's own: a later default does not move it", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().pickTimeRange({ range: TimeRange.PAST_ONE_DAY });
    });

    expect(current().isOnDefaultTimeRange).toBe(false);

    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_WEEK }));

    expect(boardRange()).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("a custom range is shown but never kept: a refresh opens on the last preset", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().pickTimeRange({ range: TimeRange.PAST_TWO_HOURS });
    });
    act(() => {
      current().pickTimeRange(PINNED);
    });

    expect(boardRange()).toBe(TimeRange.CUSTOM);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_TWO_HOURS,
    );
    expect(param("range")).toBe("2h");
  });

  test("a custom range picked on the default leaves nothing kept", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().pickTimeRange(PINNED);
    });

    expect(boardRange()).toBe(TimeRange.CUSTOM);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(param("range")).toBeNull();
  });

  test("a zoom is never kept either", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().timeRangeZoom.zoomToTimeRange(
        new Date("2026-10-20T08:00:00.000Z"),
        new Date("2026-10-20T08:30:00.000Z"),
      );
    });

    expect(boardRange()).toBe(TimeRange.CUSTOM);
    expect(current().timeRangeZoom.isZoomed).toBe(true);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("Default goes back to the dashboard's range, forgets the pick and takes it out of the address", () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);

    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().pickDefaultTimeRange();
    });

    expect(boardRange()).toBe(TimeRange.PAST_ONE_DAY);
    expect(current().isOnDefaultTimeRange).toBe(true);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(param("range")).toBeNull();
  });

  test("Default ends a zoom, and takes a link's range out of the address", () => {
    openAt("?range=7d");

    mount();
    applyDefaults(config({}));

    act(() => {
      current().timeRangeZoom.zoomToTimeRange(
        new Date("2026-10-15T08:00:00.000Z"),
        new Date("2026-10-16T08:00:00.000Z"),
      );
    });
    act(() => {
      current().pickDefaultTimeRange();
    });

    expect(boardRange()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(current().timeRangeZoom.isZoomed).toBe(false);
    expect(window.location.search).toBe("");
  });

  test("an interval is used, remembered and written; Default forgets it", () => {
    mount();
    applyDefaults(config({ refreshInterval: AutoRefreshInterval.ONE_MINUTE }));

    act(() => {
      current().pickAutoRefreshInterval(AutoRefreshInterval.OFF);
    });

    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.OFF);
    expect(current().isOnDefaultAutoRefresh).toBe(false);
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBe("off");
    expect(param("refresh")).toBe("off");

    act(() => {
      current().pickDefaultAutoRefreshInterval();
    });

    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.ONE_MINUTE);
    expect(current().isOnDefaultAutoRefresh).toBe(true);
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBeNull();
    expect(param("refresh")).toBeNull();
  });

  test("an interval it does not know changes nothing", () => {
    mount();
    applyDefaults(config({ refreshInterval: AutoRefreshInterval.ONE_MINUTE }));

    act(() => {
      current().pickAutoRefreshInterval("2m" as AutoRefreshInterval);
    });

    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.ONE_MINUTE);
    expect(current().isOnDefaultAutoRefresh).toBe(true);
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBeNull();
  });

  test("the time range and the interval are picked apart: forgetting one keeps the other", () => {
    mount();
    applyDefaults(config({}));

    act(() => {
      current().pickTimeRange({ range: TimeRange.PAST_ONE_WEEK });
      current().pickAutoRefreshInterval(AutoRefreshInterval.FIVE_MINUTES);
    });
    act(() => {
      current().pickDefaultTimeRange();
    });

    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.FIVE_MINUTES);
    expect(param("refresh")).toBe("5m");
    expect(param("range")).toBeNull();
  });
});

describe("the dashboard's config read again", () => {
  test("after Discard Changes, with the same default: a viewer on the default keeps a zoom", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().timeRangeZoom.zoomToTimeRange(
        new Date("2026-10-20T08:00:00.000Z"),
        new Date("2026-10-20T08:30:00.000Z"),
      );
    });

    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    expect(current().timeRangeZoom.isZoomed).toBe(true);
  });

  test("with a new default, a viewer on the default moves to it, and one with a pick does not", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_WEEK }));

    expect(boardRange()).toBe(TimeRange.PAST_ONE_WEEK);

    act(() => {
      current().pickTimeRange({ range: TimeRange.PAST_TWO_HOURS });
    });
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_MONTH }));

    expect(boardRange()).toBe(TimeRange.PAST_TWO_HOURS);
    expect(current().defaultTimeRange).toBe(TimeRange.PAST_ONE_MONTH);
  });
});

describe("an editor's save of new defaults", () => {
  test("moves the editor onto them: their own picks of both give way", () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    window.localStorage.setItem(AUTO_REFRESH_KEY, "off");

    mount();
    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );
    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_WEEK,
        refreshInterval: AutoRefreshInterval.FIVE_MINUTES,
      }),
      { followChangedDefaults: true },
    );

    expect(boardRange()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(current().isOnDefaultTimeRange).toBe(true);
    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.FIVE_MINUTES);
    expect(current().isOnDefaultAutoRefresh).toBe(true);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("a save that changed one default moves the editor onto that one only", () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    window.localStorage.setItem(AUTO_REFRESH_KEY, "off");

    mount();
    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );
    applyDefaults(
      config({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.FIVE_MINUTES,
      }),
      { followChangedDefaults: true },
    );

    expect(boardRange()).toBe(TimeRange.PAST_TWO_DAYS);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.FIVE_MINUTES);
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBeNull();
  });

  test("a save that changed no default - a widget moved, say - leaves the editor's picks alone", () => {
    window.localStorage.setItem(AUTO_REFRESH_KEY, "off");

    mount();
    applyDefaults(config({ refreshInterval: AutoRefreshInterval.ONE_MINUTE }));
    applyDefaults(config({ refreshInterval: AutoRefreshInterval.ONE_MINUTE }), {
      followChangedDefaults: true,
    });

    expect(current().autoRefreshInterval).toBe(AutoRefreshInterval.OFF);
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBe("off");
  });

  test("naming the past hour on a dashboard that named nothing is no change", () => {
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);

    mount();
    applyDefaults(config({}));
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_HOUR }), {
      followChangedDefaults: true,
    });

    expect(boardRange()).toBe(TimeRange.PAST_TWO_DAYS);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
  });
});

describe("for the widgets", () => {
  test("every callback stays the same function across renders", () => {
    mount();
    applyDefaults(config({ timeRange: TimeRange.PAST_ONE_DAY }));

    act(() => {
      current().pickTimeRange({ range: TimeRange.PAST_TWO_HOURS });
      current().pickAutoRefreshInterval(AutoRefreshInterval.TEN_SECONDS);
    });

    expect(seen.length).toBeGreaterThan(2);

    const first: DashboardViewerSettings = seen[0]!;

    for (const settings of seen) {
      expect(settings.applySavedDefaults).toBe(first.applySavedDefaults);
      expect(settings.pickTimeRange).toBe(first.pickTimeRange);
      expect(settings.pickDefaultTimeRange).toBe(first.pickDefaultTimeRange);
      expect(settings.pickAutoRefreshInterval).toBe(
        first.pickAutoRefreshInterval,
      );
      expect(settings.pickDefaultAutoRefreshInterval).toBe(
        first.pickDefaultAutoRefreshInterval,
      );
      expect(settings.timeRangeZoom.zoomToTimeRange).toBe(
        first.timeRangeZoom.zoomToTimeRange,
      );
      expect(settings.timeRangeZoom.resetZoom).toBe(
        first.timeRangeZoom.resetZoom,
      );
    }
  });
});
