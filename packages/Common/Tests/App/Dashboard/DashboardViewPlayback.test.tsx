import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import type { SpyInstance } from "jest-mock";

/*
 * A dashboard as one turn of a playlist on a screen (issue #5235): the real
 * DashboardViewer with isPlayback, against a fake dashboard API. The board
 * alone - no toolbar, no way into edit mode, even for someone who may edit
 * - on the dashboard's own default time range, auto-refresh and variables,
 * whatever the page's address or the viewer's remembered picks say, and
 * nothing written back to either: the address is the playlist's, and every
 * dashboard of it shares it. And no background read of telemetry attribute
 * names, which only the edit dialog needs - a wall would ask for it with
 * every dashboard it shows.
 *
 * The canvas is stubbed and publishes what it is handed.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";
const TIME_RANGE_KEY: string = `oneuptime-dashboard-time-range:${DASHBOARD_ID}`;
const AUTO_REFRESH_KEY: string = `oneuptime-dashboard-auto-refresh:${DASHBOARD_ID}`;
const PLAYER_PATH: string =
  "/dashboard/p/dashboards/playlists/91000000-0000-4000-8000-000000000001/play";

const serverState: { dashboardViewConfig: JSONObject | null } = {
  dashboardViewConfig: null,
};

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const updateByIdMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getTelemetryAttributesMock: jest.Mock<any, any> = jest.fn(() => {
  return Promise.resolve([]);
}) as jest.Mock<any, any>;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // Someone who may edit the dashboard: playback still offers no editing.
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
      getFriendlyMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: (...args: Array<any>) => {
          return getTelemetryAttributesMock(...args);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

// The canvas, publishing what every widget is handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: {
        dashboardStartAndEndDate: RangeStartAndEndDateTime;
        isEditMode: boolean;
        refreshTick?: number | undefined;
        variables?: Array<DashboardVariable> | undefined;
        onAddWidgetClick?: (() => void) | undefined;
        onEditWidgetClick?: ((id: unknown) => void) | undefined;
        isPlayback?: boolean | undefined;
      }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-range": props.dashboardStartAndEndDate.range,
          "data-edit-mode": String(props.isEditMode),
          "data-refresh-tick": String(props.refreshTick || 0),
          "data-variables": JSON.stringify(
            (props.variables || []).map((variable: DashboardVariable) => {
              return [variable.name, variable.selectedValue || null];
            }),
          ),
          "data-can-add-widget": String(Boolean(props.onAddWidgetClick)),
          "data-can-edit-widget": String(Boolean(props.onEditWidgetClick)),
          "data-playback": String(Boolean(props.isPlayback)),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";

function seed(config: {
  timeRange?: TimeRange | undefined;
  refreshInterval?: AutoRefreshInterval | undefined;
  variables?: Array<DashboardVariable> | undefined;
}): void {
  const value: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: [DashboardTextComponentUtil.getDefaultComponent()],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };

  if (config.timeRange) {
    value.timeRange = config.timeRange;
  }

  if (config.refreshInterval) {
    value.refreshInterval = config.refreshInterval;
  }

  if (config.variables) {
    value.variables = config.variables;
  }

  serverState.dashboardViewConfig = JSON.parse(
    JSON.stringify(value),
  ) as JSONObject;
}

function openAt(search: string): void {
  window.history.replaceState({}, "", `${PLAYER_PATH}${search}`);
}

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

async function renderBoard(isPlayback: boolean): Promise<void> {
  render(
    <DashboardViewer
      dashboardId={new ObjectID(DASHBOARD_ID)}
      isPlayback={isPlayback}
    />,
  );

  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
  await settle();
}

function canvas(): HTMLElement {
  return screen.getByTestId("canvas-stub");
}

const SERVICE_VARIABLE: DashboardVariable = {
  id: "service-variable",
  name: "service",
  type: DashboardVariableType.CustomList,
  customListValues: "checkout,payments",
  selectedValue: "checkout",
};

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
  serverState.dashboardViewConfig = null;
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  getTelemetryAttributesMock.mockClear();

  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: JSON.parse(
        JSON.stringify(serverState.dashboardViewConfig),
      ),
      name: "Production overview",
      description: "Requests, latency and errors",
    });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
});

describe("a dashboard played in a playlist", () => {
  test("is the board alone: no toolbar, no way into edit mode, even for someone who may edit", async () => {
    seed({ timeRange: TimeRange.PAST_ONE_DAY });

    await renderBoard(true);

    expect(screen.queryByLabelText("More dashboard options")).toBeNull();
    expect(screen.queryByText("Production overview")).toBeNull();
    expect(screen.queryByTitle("Auto-refresh settings")).toBeNull();
    expect(canvas()).toHaveAttribute("data-edit-mode", "false");
    expect(canvas()).toHaveAttribute("data-can-add-widget", "false");
    expect(canvas()).toHaveAttribute("data-can-edit-widget", "false");
    // Its widgets are told: no zoom, no Investigate, no Open in Explorer.
    expect(canvas()).toHaveAttribute("data-playback", "true");
  });

  test("opens on the dashboard's own default time range, over a link's and the viewer's remembered pick", async () => {
    seed({ timeRange: TimeRange.PAST_ONE_DAY });
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    openAt("?range=7d");

    await renderBoard(true);

    expect(canvas()).toHaveAttribute("data-range", TimeRange.PAST_ONE_DAY);
  });

  test("leaves the page's address and the viewer's picks as they were", async () => {
    seed({
      timeRange: TimeRange.PAST_ONE_DAY,
      variables: [SERVICE_VARIABLE],
    });
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    openAt("?keep=yes");

    await renderBoard(true);

    expect(window.location.pathname).toBe(PLAYER_PATH);
    expect(window.location.search).toBe("?keep=yes");
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBeNull();
  });

  test("shows its variables as saved, whatever the address selects", async () => {
    seed({ variables: [SERVICE_VARIABLE] });
    openAt("?var-service=payments");

    await renderBoard(true);

    expect(JSON.parse(canvas().getAttribute("data-variables") || "[]")).toEqual(
      [["service", "checkout"]],
    );
  });

  test("refreshes at the dashboard's own interval", async () => {
    seed({
      timeRange: TimeRange.PAST_ONE_DAY,
      refreshInterval: AutoRefreshInterval.ONE_MINUTE,
    });
    window.localStorage.setItem(AUTO_REFRESH_KEY, "off");

    const setIntervalSpy: SpyInstance<
      (
        callback: (...args: Array<any>) => void,
        delay?: number,
        ...args: Array<any>
      ) => NodeJS.Timeout
    > = jest.spyOn(window, "setInterval");

    await renderBoard(true);

    expect(
      setIntervalSpy.mock.calls.some((call: Array<unknown>) => {
        return call[1] === 60000;
      }),
    ).toBe(true);
  });

  test("never reads telemetry attribute names: only the edit dialog needs them", async () => {
    seed({ timeRange: TimeRange.PAST_ONE_DAY });

    await renderBoard(true);

    expect(getTelemetryAttributesMock).not.toHaveBeenCalled();
  });

  test("fills the player's stage below its bar, as wide as the screen it plays on", async () => {
    seed({});

    await renderBoard(true);

    const root: HTMLElement = canvas().parentElement!.parentElement!;

    expect(root.className).toBe("pt-3");
    expect(root.className).not.toContain("min-h-screen");
    /*
     * No width of its own: the board lays its widgets out in the screen's
     * width (DashboardBoardLayout), one under another on a phone. It used
     * to be at least 1000px wide, wider than a phone or a narrow window.
     */
    expect(root.style.minWidth).toBe("");
  });
});

describe("the same dashboard on its own page, for contrast", () => {
  test("has its toolbar, follows the viewer's pick and warms the attribute names for an editor", async () => {
    seed({ timeRange: TimeRange.PAST_ONE_DAY });
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);

    await renderBoard(false);

    expect(screen.getByLabelText("More dashboard options")).toBeInTheDocument();
    expect(canvas()).toHaveAttribute("data-range", TimeRange.PAST_TWO_DAYS);
    expect(canvas()).toHaveAttribute("data-can-add-widget", "true");
    expect(canvas()).toHaveAttribute("data-playback", "false");
    expect(getTelemetryAttributesMock).toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("range")).toBe("2d");
  });
});
