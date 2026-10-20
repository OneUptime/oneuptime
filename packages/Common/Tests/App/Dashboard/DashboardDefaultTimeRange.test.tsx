import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import type { SpyInstance } from "jest-mock";
import {
  AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
  DASHBOARD_DEFAULTS_BAR_TEST_ID,
  DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
  DEFAULT_TIME_RANGE_PICKER_TEST_ID,
  getDefaultsPickerChoiceTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsCopy";

/*
 * A dashboard's default time range and auto-refresh, inside OneUptime
 * (issue #5080), driven through the real DashboardViewer against a fake
 * dashboard API:
 *
 *   - it opens on the dashboard's saved defaults, the past hour with
 *     auto-refresh off for one saved before them, a viewer's remembered
 *     pick, or a link's ?range= / ?refresh=;
 *   - an editor sets the defaults on purpose in edit mode, saved with Save
 *     Changes and thrown away with Discard Changes;
 *   - Save Changes no longer stamps the auto-refresh the editor last picked
 *     while viewing onto the dashboard: before, an editor who had turned
 *     refresh off for a while turned it off for every viewer with an
 *     unrelated save.
 *
 * The canvas is stubbed - ~60 widget implementations deep, none of them
 * under test - and publishes the time range it is handed.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "33333333-3333-4333-8333-333333333333";

const TIME_RANGE_KEY: string = `oneuptime-dashboard-time-range:${DASHBOARD_ID}`;

// The tick the toolbar's menus draw on the choice in use.
const TICK: string = String.fromCharCode(0x2713);
const AUTO_REFRESH_KEY: string = `oneuptime-dashboard-auto-refresh:${DASHBOARD_ID}`;

// The fake server's copy of the dashboard: updateById writes it, getItem reads it.
const serverState: { dashboardViewConfig: JSONObject | null } = {
  dashboardViewConfig: null,
};

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const updateByIdMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // Permission.ProjectAdmin: a literal, the factory is hoisted above the imports.
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
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

// The canvas, publishing the time range and refresh tick every widget is handed.
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
        refreshTick?: number | undefined;
      }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-range": props.dashboardStartAndEndDate.range,
          "data-refresh-tick": String(props.refreshTick || 0),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";

function makeConfig(defaults: {
  timeRange?: TimeRange | undefined;
  refreshInterval?: AutoRefreshInterval | undefined;
}): DashboardViewConfig {
  const config: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    // One widget: the toolbar draws its time range and auto-refresh only then.
    components: [DashboardTextComponentUtil.getDefaultComponent()],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };

  if (defaults.timeRange) {
    config.timeRange = defaults.timeRange;
  }

  if (defaults.refreshInterval) {
    config.refreshInterval = defaults.refreshInterval;
  }

  return config;
}

function seedServer(config: DashboardViewConfig): void {
  serverState.dashboardViewConfig = JSON.parse(
    JSON.stringify(config),
  ) as JSONObject;
}

function openAt(search: string): void {
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID}${search}`);
}

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
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

async function renderDashboard(): Promise<void> {
  render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);

  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
  await settle();
}

function canvasRange(): string | null {
  return screen.getByTestId("canvas-stub").getAttribute("data-range");
}

async function enterEditMode(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByLabelText("More dashboard options"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Edit Dashboard"));
  });
}

async function saveChanges(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTitle("Save Changes"));
  });
  await settle();
}

async function discardChanges(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTitle("Cancel"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Discard Changes"));
  });
  await settle();
}

async function pickDefault(pickerTestId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(pickerTestId));
  });
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(getDefaultsPickerChoiceTestId(pickerTestId, value)),
    );
  });
}

async function openAutoRefreshMenu(): Promise<HTMLElement> {
  const trigger: HTMLElement = screen.getByTitle("Auto-refresh settings");

  await act(async () => {
    fireEvent.click(trigger);
  });

  return trigger.parentElement as HTMLElement;
}

async function openTimeRangePicker(label: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });

  return screen.getByRole("radiogroup", { name: "Time range" });
}

// What the last save wrote.
function savedConfig(): JSONObject {
  const calls: Array<Array<any>> = updateByIdMock.mock.calls;
  const lastCall: Array<any> | undefined = calls[calls.length - 1];

  return (lastCall?.[0] as { data: { dashboardViewConfig: JSONObject } }).data
    .dashboardViewConfig;
}

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
  serverState.dashboardViewConfig = null;
  getItemMock.mockReset();
  updateByIdMock.mockReset();

  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: JSON.parse(
        JSON.stringify(serverState.dashboardViewConfig),
      ),
      name: "Production wall screen",
      description: "",
    });
  });

  updateByIdMock.mockImplementation((options: any) => {
    serverState.dashboardViewConfig = JSON.parse(
      JSON.stringify(options.data.dashboardViewConfig),
    ) as JSONObject;
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
});

describe("what the dashboard opens on", () => {
  test("its saved default time range and auto-refresh", async () => {
    seedServer(
      makeConfig({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );
    const setIntervalSpy: SpyInstance<
      (
        callback: (...args: Array<any>) => void,
        delay?: number,
        ...args: Array<any>
      ) => NodeJS.Timeout
    > = jest.spyOn(window, "setInterval");

    await renderDashboard();

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_DAY);
    expect(
      screen.getByRole("button", { name: "Past 1 Day" }),
    ).toBeInTheDocument();
    // The auto-refresh runs at the dashboard's interval: every minute.
    expect(
      setIntervalSpy.mock.calls.some((call: Array<unknown>) => {
        return call[1] === 60000;
      }),
    ).toBe(true);
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent("1m");
    // On the defaults, the address names neither.
    expect(window.location.search).toBe("");
  });

  test("one saved before the defaults: the past hour, auto-refresh off, as before", async () => {
    seedServer(makeConfig({}));

    await renderDashboard();

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent(
      "Auto-refresh: Off",
    );
  });

  test("the viewer's remembered picks, over the dashboard's defaults", async () => {
    seedServer(
      makeConfig({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    window.localStorage.setItem(AUTO_REFRESH_KEY, "off");

    await renderDashboard();

    expect(canvasRange()).toBe(TimeRange.PAST_TWO_DAYS);
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent(
      "Auto-refresh: Off",
    );
    expect(param("range")).toBe("2d");
    expect(param("refresh")).toBe("off");
  });

  test("a link's ?range= and ?refresh=, over everything", async () => {
    seedServer(
      makeConfig({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_DAYS);
    openAt("?range=7d&refresh=5m&var-service=checkout");

    await renderDashboard();

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent("5m");
    // The link is not the viewer's own: their remembered pick is untouched.
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_TWO_DAYS,
    );
  });
});

describe("a viewer's own picks", () => {
  test("the time range picker offers the dashboard's own first, and goes back to it", async () => {
    seedServer(makeConfig({ timeRange: TimeRange.PAST_ONE_DAY }));

    await renderDashboard();

    let rail: HTMLElement = await openTimeRangePicker("Past 1 Day");

    await act(async () => {
      fireEvent.click(within(rail).getByText("Past 3 Hours"));
    });

    expect(canvasRange()).toBe(TimeRange.PAST_THREE_HOURS);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBe(
      TimeRange.PAST_THREE_HOURS,
    );
    expect(param("range")).toBe("3h");

    rail = await openTimeRangePicker("Past 3 Hours");

    await act(async () => {
      fireEvent.click(within(rail).getByText("Default (Past 1 Day)"));
    });

    expect(canvasRange()).toBe(TimeRange.PAST_ONE_DAY);
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(param("range")).toBeNull();
  });

  test("the auto-refresh menu offers the dashboard's own first, ticked while the viewer is on it", async () => {
    seedServer(makeConfig({ refreshInterval: AutoRefreshInterval.ONE_MINUTE }));

    await renderDashboard();

    let menu: HTMLElement = await openAutoRefreshMenu();
    const defaultChoice: HTMLElement = within(menu).getByTestId(
      AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
    );

    expect(defaultChoice).toHaveTextContent("Default (1m)");
    expect(defaultChoice).toHaveTextContent(TICK);
    // The interval it names is not ticked a second time.
    expect(
      within(menu).getByText("Refresh every 1m").closest("button"),
    ).not.toHaveTextContent(TICK);

    await act(async () => {
      fireEvent.click(within(menu).getByText("Auto-refresh Off"));
    });

    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBe("off");
    expect(param("refresh")).toBe("off");

    menu = await openAutoRefreshMenu();

    await act(async () => {
      fireEvent.click(
        within(menu).getByTestId(AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID),
      );
    });

    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBeNull();
    expect(param("refresh")).toBeNull();
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent("1m");
  });
});

describe("the defaults, set on purpose while editing", () => {
  test("a row under the editing toolbar shows them, and only while editing", async () => {
    seedServer(
      makeConfig({
        timeRange: TimeRange.PAST_ONE_DAY,
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    );

    await renderDashboard();

    expect(screen.queryByTestId(DASHBOARD_DEFAULTS_BAR_TEST_ID)).toBeNull();

    await enterEditMode();

    const row: HTMLElement = screen.getByTestId(DASHBOARD_DEFAULTS_BAR_TEST_ID);

    expect(row).toHaveTextContent("Default time range");
    expect(row).toHaveTextContent("Default auto-refresh");
    expect(
      within(row).getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID),
    ).toHaveTextContent("Past 1 Day");
    expect(
      within(row).getByTestId(DEFAULT_AUTO_REFRESH_PICKER_TEST_ID),
    ).toHaveTextContent("1m");
  });

  test("one saved before the defaults shows the past hour and Off", async () => {
    seedServer(makeConfig({}));

    await renderDashboard();
    await enterEditMode();

    expect(
      screen.getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID),
    ).toHaveTextContent("Past 1 Hour");
    expect(
      screen.getByTestId(DEFAULT_AUTO_REFRESH_PICKER_TEST_ID),
    ).toHaveTextContent("Off");
  });

  test("Save Changes saves them, and the editor sees them at once", async () => {
    seedServer(makeConfig({}));
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_HOURS);

    await renderDashboard();

    expect(canvasRange()).toBe(TimeRange.PAST_TWO_HOURS);

    await enterEditMode();
    await pickDefault(
      DEFAULT_TIME_RANGE_PICKER_TEST_ID,
      TimeRange.PAST_ONE_WEEK,
    );
    await pickDefault(DEFAULT_AUTO_REFRESH_PICKER_TEST_ID, "5m");
    await saveChanges();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(savedConfig()["timeRange"]).toBe(TimeRange.PAST_ONE_WEEK);
    expect(savedConfig()["refreshInterval"]).toBe(
      AutoRefreshInterval.FIVE_MINUTES,
    );

    // Back in view mode, on the new defaults: the editor's own pick gave way.
    expect(screen.queryByTestId(DASHBOARD_DEFAULTS_BAR_TEST_ID)).toBeNull();
    expect(canvasRange()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent("5m");
    expect(window.localStorage.getItem(TIME_RANGE_KEY)).toBeNull();
    expect(param("range")).toBeNull();
  });

  test("Discard Changes throws them away with the rest", async () => {
    seedServer(makeConfig({ timeRange: TimeRange.PAST_ONE_DAY }));

    await renderDashboard();
    await enterEditMode();
    await pickDefault(
      DEFAULT_TIME_RANGE_PICKER_TEST_ID,
      TimeRange.PAST_ONE_WEEK,
    );

    expect(
      screen.getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID),
    ).toHaveTextContent("Past 1 Week");

    await discardChanges();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(canvasRange()).toBe(TimeRange.PAST_ONE_DAY);

    await enterEditMode();

    expect(
      screen.getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID),
    ).toHaveTextContent("Past 1 Day");
  });

  test("an editor on a pick of their own keeps it through a discard", async () => {
    seedServer(makeConfig({ timeRange: TimeRange.PAST_ONE_DAY }));
    window.localStorage.setItem(TIME_RANGE_KEY, TimeRange.PAST_TWO_HOURS);

    await renderDashboard();
    await enterEditMode();
    await discardChanges();

    expect(canvasRange()).toBe(TimeRange.PAST_TWO_HOURS);
  });
});

describe("Save Changes no longer turns a viewer's auto-refresh into the dashboard's (issue #5080)", () => {
  test("an editor who turned refresh off while viewing saves a widget change: the dashboard keeps refreshing every minute", async () => {
    seedServer(makeConfig({ refreshInterval: AutoRefreshInterval.ONE_MINUTE }));

    await renderDashboard();

    const menu: HTMLElement = await openAutoRefreshMenu();

    await act(async () => {
      fireEvent.click(within(menu).getByText("Auto-refresh Off"));
    });

    await enterEditMode();
    await saveChanges();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    // What every viewer opens with is still every minute.
    expect(savedConfig()["refreshInterval"]).toBe(
      AutoRefreshInterval.ONE_MINUTE,
    );
    // And the editor's own Off stays theirs.
    expect(screen.getByTitle("Auto-refresh settings")).toHaveTextContent(
      "Auto-refresh: Off",
    );
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBe("off");
  });

  test("an interval picked while viewing a dashboard with none saved is not saved onto it", async () => {
    seedServer(makeConfig({}));

    await renderDashboard();

    const menu: HTMLElement = await openAutoRefreshMenu();

    await act(async () => {
      fireEvent.click(within(menu).getByText("Refresh every 5s"));
    });

    await enterEditMode();
    await saveChanges();

    expect(savedConfig()["refreshInterval"]).toBeUndefined();
    expect(savedConfig()["timeRange"]).toBeUndefined();
  });

  test("a time range picked while viewing is not saved onto the dashboard either", async () => {
    seedServer(makeConfig({ timeRange: TimeRange.PAST_ONE_DAY }));

    await renderDashboard();

    const rail: HTMLElement = await openTimeRangePicker("Past 1 Day");

    await act(async () => {
      fireEvent.click(within(rail).getByText("Past 5 Minutes"));
    });

    await enterEditMode();
    await saveChanges();

    expect(savedConfig()["timeRange"]).toBe(TimeRange.PAST_ONE_DAY);
  });
});
