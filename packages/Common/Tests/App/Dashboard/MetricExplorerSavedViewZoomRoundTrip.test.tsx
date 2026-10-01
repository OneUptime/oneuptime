import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type MetricViewData from "../../../Types/Metrics/MetricViewData";
import type MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import type TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import InBetween from "../../../Types/BaseDatabase/InBetween";

/*
 * Issue #4105 on the metric explorer's saved views. A reader zooms into a
 * window, saves the view (it keeps that window, pinned), moves on (the
 * picker, or another view), and later loads the saved view again.
 *
 * Loading it is a fresh start on the saved window. The zoom that produced
 * the window ended when the reader moved on, so it must not come back:
 * no "Reset zoom" beside the picker, no chart holding its clicks for a
 * double-click that jumps to the range from before that old zoom, and a
 * new zoom inside the loaded view must lead back to the saved window. The
 * page zoom used to keep its record of the old zoom and revive it as soon
 * as the explorer was on that exact window again.
 *
 * The explorer, MetricView, the picker and the page zoom are all real. The
 * data layer is stubbed; MetricCharts is one element per query that does
 * what a chart does with the handlers it is given (a mouse-up ends a drag,
 * a double-click resets); and the saved-views control is reduced to a Save
 * and a Load button that round-trip the captured view through JSON, the way
 * the database does.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
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

// The event-marker hook's incident and alert fetches.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return modelGetListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// The event-marker hook's change-event fetch.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

interface ChartsProps {
  metricViewData: MetricViewData;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

interface DragSelection {
  startTime: Date;
  endTime: Date;
}

const chartsRenders: Array<ChartsProps> = [];

// The window the next mouse-up on a chart ends a drag with.
let pendingDrag: DragSelection | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: ChartsProps): React.ReactElement => {
        chartsRenders.push(props);

        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          props.metricViewData.queryConfigs.map(
            (queryConfig: MetricQueryConfigData): React.ReactElement => {
              const variable: string =
                queryConfig.metricAliasData?.metricVariable || "";
              return React.createElement("div", {
                key: variable,
                "data-testid": `chart-${variable}`,
                onMouseUp: (): void => {
                  const selection: DragSelection | null = pendingDrag;
                  pendingDrag = null;
                  if (selection && props.onTimeRangeSelect) {
                    props.onTimeRangeSelect(
                      selection.startTime,
                      selection.endTime,
                    );
                  }
                },
                onDoubleClick: (): void => {
                  props.onTimeRangeReset?.();
                },
              });
            },
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormulaConfig",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

// The views the reader saved, as the database hands them back.
const savedViews: Array<string> = [];

const ROLLING_VIEW: TelemetrySavedViewState = {
  explorerConfig: {
    metricQueries: [{ metricName: "cpu.usage", variable: "a" }],
    rangeToken: "Past 3 Hours",
  },
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        applyState: (state: TelemetrySavedViewState) => void;
        captureCurrentState: () => TelemetrySavedViewState;
      }): React.ReactElement => {
        return React.createElement(
          "div",
          null,
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "save-view",
              onClick: (): void => {
                savedViews.push(JSON.stringify(props.captureCurrentState()));
              },
            },
            "Save view",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "load-saved-view",
              onClick: (): void => {
                const saved: string | undefined =
                  savedViews[savedViews.length - 1];
                if (saved) {
                  props.applyState(
                    JSON.parse(saved) as TelemetrySavedViewState,
                  );
                }
              },
            },
            "Load saved view",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "load-rolling-view",
              onClick: (): void => {
                props.applyState(ROLLING_VIEW);
              },
            },
            "Load rolling view",
          ),
        );
      },
    };
  },
);

import MetricExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import TimeRange from "../../../Types/Time/TimeRange";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-28T11:10:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:40:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");

// Two query panels: a drag on one and a double-click on the other.
const TWO_QUERIES_PARAM: string = JSON.stringify([
  { metricName: "cpu.usage", variable: "a" },
  { metricName: "memory.usage", variable: "b" },
]);

async function renderExplorer(): Promise<void> {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/metrics/view?metricQueries=${encodeURIComponent(TWO_QUERIES_PARAM)}`,
  );
  render(<MetricExplorer />);
  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
  // waitFor ticks the fake clock; put "now" back where the tests read it.
  jest.setSystemTime(NOW);
}

function dragAcross(variable: string, startTime: Date, endTime: Date): void {
  pendingDrag = { startTime: startTime, endTime: endTime };
  fireEvent.mouseUp(screen.getByTestId(`chart-${variable}`));
}

function doubleClick(variable: string): void {
  fireEvent.doubleClick(screen.getByTestId(`chart-${variable}`));
}

function latestCharts(): ChartsProps {
  const last: ChartsProps | undefined = chartsRenders[chartsRenders.length - 1];
  if (!last) {
    throw new Error("MetricCharts has not rendered");
  }
  return last;
}

function pickerButton(): HTMLElement {
  return screen.getByTestId(
    `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
  );
}

// The picker's own row: the dropdown and, while zoomed, "Reset zoom".
function pickerRow(): HTMLElement {
  const row: HTMLElement | null | undefined =
    pickerButton().parentElement?.parentElement;
  if (!row) {
    throw new Error("The time range picker is not mounted");
  }
  return row;
}

function pickPreset(range: TimeRange): void {
  fireEvent.click(pickerButton());
  fireEvent.click(
    screen.getByRole("button", {
      name: getTimeRangeButtonLabel({ range: range }),
    }),
  );
}

function customLabel(startTime: Date, endTime: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(startTime, endTime),
  });
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

// A window as epoch milliseconds, [start, end], so it compares by value.
type EpochWindow = [number, number];

function toWindow(startTime: Date, endTime: Date): EpochWindow {
  return [startTime.getTime(), endTime.getTime()];
}

function urlWindow(): EpochWindow {
  return [
    new Date(urlParam("startTime") || "").getTime(),
    new Date(urlParam("endTime") || "").getTime(),
  ];
}

function lastFetchedChartWindow(): EpochWindow {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error("No chart data was fetched");
  }
  const data: MetricViewData = (last[0] as { metricViewData: MetricViewData })
    .metricViewData;
  return toWindow(
    data.startAndEndDate!.startValue,
    data.startAndEndDate!.endValue,
  );
}

// On the saved window, pinned, and not zoomed: a fresh start.
function expectFreshStartOnSavedWindow(): void {
  expect(pickerButton()).toHaveTextContent(customLabel(ZOOM_START, ZOOM_END));
  expect(urlParam("range")).toBeNull();
  expect(urlWindow()).toEqual(toWindow(ZOOM_START, ZOOM_END));
  expect(resetZoomButton()).toBeNull();
  // Nothing to undo, so no chart holds its single clicks for a reset.
  expect(latestCharts().onTimeRangeReset).toBeUndefined();
}

// Zoom, save the view, and move on with the picker.
function zoomSaveAndPickAnotherRange(): void {
  dragAcross("a", ZOOM_START, ZOOM_END);
  expect(
    within(pickerRow()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toBeVisible();

  fireEvent.click(screen.getByTestId("save-view"));

  pickPreset(TimeRange.PAST_THREE_HOURS);
  expect(urlParam("range")).toBe(TimeRange.PAST_THREE_HOURS);
  expect(resetZoomButton()).toBeNull();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.localStorage.clear();

  chartsRenders.length = 0;
  savedViews.length = 0;
  pendingDrag = null;

  fetchResultsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
  modelGetListMock.mockReset();
  modelGetListMock.mockReturnValue(
    Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 }),
  );
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockReturnValue(
    Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 }),
  );

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.localStorage.clear();
});

describe("Metric explorer: a view saved while zoomed, loaded again later", () => {
  test("the saved view keeps the zoomed window, pinned", async () => {
    await renderExplorer();

    dragAcross("a", ZOOM_START, ZOOM_END);
    fireEvent.click(screen.getByTestId("save-view"));

    const saved: TelemetrySavedViewState = JSON.parse(
      savedViews[0]!,
    ) as TelemetrySavedViewState;
    expect(saved.explorerConfig?.["rangeToken"]).toBeUndefined();
    expect(saved.explorerConfig?.["startTime"]).toBe(ZOOM_START.toISOString());
    expect(saved.explorerConfig?.["endTime"]).toBe(ZOOM_END.toISOString());
  });

  test("loading it after a picker pick is a fresh start: no Reset zoom, no reset on the charts", async () => {
    await renderExplorer();
    zoomSaveAndPickAnotherRange();

    fireEvent.click(screen.getByTestId("load-saved-view"));

    expectFreshStartOnSavedWindow();
    await waitFor(() => {
      expect(lastFetchedChartWindow()).toEqual(toWindow(ZOOM_START, ZOOM_END));
    });
  });

  test("a double-click on a chart then leaves the explorer on the saved window", async () => {
    await renderExplorer();
    zoomSaveAndPickAnotherRange();
    fireEvent.click(screen.getByTestId("load-saved-view"));

    doubleClick("b");

    // Not "Past 1 Hour", the range from before the zoom that was abandoned.
    expect(urlParam("range")).toBeNull();
    expectFreshStartOnSavedWindow();
  });

  test("a zoom inside the loaded view resets to the saved window", async () => {
    await renderExplorer();
    zoomSaveAndPickAnotherRange();
    fireEvent.click(screen.getByTestId("load-saved-view"));

    dragAcross("b", INNER_ZOOM_START, INNER_ZOOM_END);

    expect(pickerButton()).toHaveTextContent(
      customLabel(INNER_ZOOM_START, INNER_ZOOM_END),
    );
    expect(
      within(pickerRow()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();

    doubleClick("a");

    expectFreshStartOnSavedWindow();
    await waitFor(() => {
      expect(lastFetchedChartWindow()).toEqual(toWindow(ZOOM_START, ZOOM_END));
    });
  });

  test("Reset zoom beside the picker after that inner zoom goes to the saved window too", async () => {
    await renderExplorer();
    zoomSaveAndPickAnotherRange();
    fireEvent.click(screen.getByTestId("load-saved-view"));
    dragAcross("b", INNER_ZOOM_START, INNER_ZOOM_END);

    fireEvent.click(
      within(pickerRow()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    expectFreshStartOnSavedWindow();
  });

  test("moving on through another (rolling) view instead of the picker is the same", async () => {
    await renderExplorer();
    dragAcross("a", ZOOM_START, ZOOM_END);
    fireEvent.click(screen.getByTestId("save-view"));

    fireEvent.click(screen.getByTestId("load-rolling-view"));
    expect(urlParam("range")).toBe(TimeRange.PAST_THREE_HOURS);
    fireEvent.click(screen.getByTestId("load-saved-view"));

    expectFreshStartOnSavedWindow();

    doubleClick("b");

    expect(urlWindow()).toEqual(toWindow(ZOOM_START, ZOOM_END));
  });

  test("later in the day, the loaded view still offers no way back to a rolling hour", async () => {
    await renderExplorer();
    zoomSaveAndPickAnotherRange();

    // An hour on, the reader comes back to the saved view.
    jest.setSystemTime(new Date("2026-09-28T13:00:00.000Z"));
    fireEvent.click(screen.getByTestId("load-saved-view"));
    doubleClick("a");

    expectFreshStartOnSavedWindow();
  });

  test("a zoom that is still on, loaded again as the same view, can still be undone", async () => {
    await renderExplorer();
    dragAcross("a", ZOOM_START, ZOOM_END);
    fireEvent.click(screen.getByTestId("save-view"));

    // The explorer is already on the saved window: nothing moved.
    fireEvent.click(screen.getByTestId("load-saved-view"));

    expect(
      within(pickerRow()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();

    doubleClick("b");

    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(urlWindow()).toEqual(toWindow(HOUR_AGO, NOW));
    expect(resetZoomButton()).toBeNull();
  });
});
