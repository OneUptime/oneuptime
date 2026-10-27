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
import { ObjectType } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * useDashboardViewerSettings with savedDefaultsOnly (issue #5235): a
 * dashboard shown as its editors saved it, whoever looks at it - a
 * playlist's turn on a screen. The page's address is the playlist's and
 * the dashboards it shows share it, so neither a link's ?range= / ?refresh=
 * nor the viewer's remembered picks decide the board, and nothing is
 * written back to either: the board opens on the dashboard's own default
 * time range and auto-refresh, every time.
 *
 * Read through a real component, as the playlist player's boards use it.
 */

const OVERVIEW: string = "db000000-0000-4000-8000-0000000000c1";
const CLUSTERS: string = "db000000-0000-4000-8000-0000000000c2";
const PLAYER_PATH: string =
  "/dashboard/p/dashboards/playlists/91000000-0000-4000-8000-000000000001/play";

const latest: Record<string, DashboardViewerSettings> = {};

const Board: FunctionComponent<{
  dashboardId: string;
  savedDefaultsOnly?: boolean;
}> = (props: {
  dashboardId: string;
  savedDefaultsOnly?: boolean;
}): ReactElement => {
  const settings: DashboardViewerSettings = useDashboardViewerSettings({
    dashboardId: props.dashboardId,
    savedDefaultsOnly: props.savedDefaultsOnly,
  });

  latest[props.dashboardId] = settings;

  return <span>{settings.timeRangeZoom.startAndEndDate.range}</span>;
};

function settingsOf(dashboardId: string): DashboardViewerSettings {
  const settings: DashboardViewerSettings | undefined = latest[dashboardId];

  if (!settings) {
    throw new Error("The board has not rendered.");
  }

  return settings;
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

function timeRangeKey(dashboardId: string): string {
  return `oneuptime-dashboard-time-range:${dashboardId}`;
}

function autoRefreshKey(dashboardId: string): string {
  return `oneuptime-dashboard-auto-refresh:${dashboardId}`;
}

function openAt(search: string): void {
  window.history.replaceState(null, "", `${PLAYER_PATH}${search}`);
}

beforeEach(() => {
  for (const key of Object.keys(latest)) {
    delete latest[key];
  }
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

describe("a board on saved defaults only", () => {
  test("opens on the dashboard's own defaults, though the address and the viewer's picks name others", () => {
    openAt("?range=2d&refresh=30s");
    window.localStorage.setItem(
      timeRangeKey(OVERVIEW),
      TimeRange.PAST_ONE_WEEK,
    );
    window.localStorage.setItem(autoRefreshKey(OVERVIEW), "5m");

    render(<Board dashboardId={OVERVIEW} savedDefaultsOnly={true} />);

    // Before its config is read: the past hour, auto-refresh off.
    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(settingsOf(OVERVIEW).autoRefreshInterval).toBe(
      AutoRefreshInterval.OFF,
    );

    act(() => {
      settingsOf(OVERVIEW).applySavedDefaults(
        config({
          timeRange: TimeRange.PAST_ONE_DAY,
          refreshInterval: AutoRefreshInterval.ONE_MINUTE,
        }),
      );
    });

    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(settingsOf(OVERVIEW).autoRefreshInterval).toBe(
      AutoRefreshInterval.ONE_MINUTE,
    );
    expect(settingsOf(OVERVIEW).isOnDefaultTimeRange).toBe(true);
    expect(settingsOf(OVERVIEW).isOnDefaultAutoRefresh).toBe(true);
  });

  test("a dashboard saved before the defaults opens on the past hour with auto-refresh off", () => {
    window.localStorage.setItem(
      timeRangeKey(OVERVIEW),
      TimeRange.PAST_TWO_DAYS,
    );

    render(<Board dashboardId={OVERVIEW} savedDefaultsOnly={true} />);

    act(() => {
      settingsOf(OVERVIEW).applySavedDefaults(config({}));
    });

    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(settingsOf(OVERVIEW).autoRefreshInterval).toBe(
      AutoRefreshInterval.OFF,
    );
  });

  test("leaves the page's address as it was", () => {
    window.localStorage.setItem(
      timeRangeKey(OVERVIEW),
      TimeRange.PAST_TWO_DAYS,
    );
    openAt("?keep=yes");

    render(<Board dashboardId={OVERVIEW} savedDefaultsOnly={true} />);

    act(() => {
      settingsOf(OVERVIEW).applySavedDefaults(
        config({ timeRange: TimeRange.PAST_ONE_DAY }),
        { followChangedDefaults: true },
      );
    });

    expect(window.location.pathname).toBe(PLAYER_PATH);
    expect(window.location.search).toBe("?keep=yes");
  });

  test("a pick made on it moves the board, and is neither remembered nor written into the address", () => {
    render(<Board dashboardId={OVERVIEW} savedDefaultsOnly={true} />);

    act(() => {
      settingsOf(OVERVIEW).applySavedDefaults(
        config({ timeRange: TimeRange.PAST_ONE_DAY }),
      );
    });

    act(() => {
      settingsOf(OVERVIEW).pickTimeRange({ range: TimeRange.PAST_ONE_WEEK });
    });
    act(() => {
      settingsOf(OVERVIEW).pickAutoRefreshInterval(
        AutoRefreshInterval.THIRTY_SECONDS,
      );
    });

    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
    expect(settingsOf(OVERVIEW).autoRefreshInterval).toBe(
      AutoRefreshInterval.THIRTY_SECONDS,
    );
    expect(window.localStorage.getItem(timeRangeKey(OVERVIEW))).toBeNull();
    expect(window.localStorage.getItem(autoRefreshKey(OVERVIEW))).toBeNull();
    expect(window.location.search).toBe("");

    act(() => {
      settingsOf(OVERVIEW).pickDefaultTimeRange();
    });
    act(() => {
      settingsOf(OVERVIEW).pickDefaultAutoRefreshInterval();
    });

    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(window.localStorage.getItem(timeRangeKey(OVERVIEW))).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("two boards on one page - the one on screen and the next - each keep their own dashboard's defaults", () => {
    render(
      <>
        <Board dashboardId={OVERVIEW} savedDefaultsOnly={true} />
        <Board dashboardId={CLUSTERS} savedDefaultsOnly={true} />
      </>,
    );

    act(() => {
      settingsOf(OVERVIEW).applySavedDefaults(
        config({ timeRange: TimeRange.PAST_ONE_DAY }),
      );
      settingsOf(CLUSTERS).applySavedDefaults(
        config({
          timeRange: TimeRange.PAST_ONE_WEEK,
          refreshInterval: AutoRefreshInterval.FIVE_MINUTES,
        }),
      );
    });

    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(settingsOf(CLUSTERS).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
    expect(settingsOf(CLUSTERS).autoRefreshInterval).toBe(
      AutoRefreshInterval.FIVE_MINUTES,
    );
    expect(window.location.search).toBe("");
  });
});

describe("the same board on its own page, for contrast", () => {
  test("follows the viewer's remembered pick and writes it into the address", () => {
    window.localStorage.setItem(
      timeRangeKey(OVERVIEW),
      TimeRange.PAST_TWO_DAYS,
    );

    render(<Board dashboardId={OVERVIEW} />);

    act(() => {
      settingsOf(OVERVIEW).applySavedDefaults(
        config({ timeRange: TimeRange.PAST_ONE_DAY }),
      );
    });

    expect(settingsOf(OVERVIEW).timeRangeZoom.startAndEndDate.range).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
    expect(new URLSearchParams(window.location.search).get("range")).toBe("2d");
  });
});
