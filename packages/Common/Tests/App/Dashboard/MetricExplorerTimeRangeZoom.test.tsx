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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type { ChartTimeRangeZoomContextValue } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import type MetricViewData from "../../../Types/Metrics/MetricViewData";
import type MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import type TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import InBetween from "../../../Types/BaseDatabase/InBetween";

/*
 * Issue #4105 on the metric explorer: a drag across any of its charts
 * retimes the whole explorer, and a double-click on any of them (or "Reset
 * zoom" beside the picker) puts back the range from before the first zoom.
 *
 * The explorer is rendered for real, with the real MetricView, the real
 * picker and the real event-marker hook; only the data layer and the
 * heavyweight children are replaced. MetricCharts is stood in for by one
 * element per query panel that does what a real chart does with the
 * handlers MetricCharts forwards to it: a mouse-up ends a drag (the window
 * comes from the test) and a double-click resets.
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

interface ChartsRender {
  props: ChartsProps;
  // What a chart below would read from the page, if it looked.
  pageZoom: ChartTimeRangeZoomContextValue | null;
}

interface DragSelection {
  startTime: Date;
  endTime: Date;
}

const chartsRenders: Array<ChartsRender> = [];

// The window the next mouse-up on a chart ends a drag with.
let pendingDrag: DragSelection | null = null;

type UseChartTimeRangeZoom = () => ChartTimeRangeZoomContextValue | null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const zoomContext: { useChartTimeRangeZoom: UseChartTimeRangeZoom } =
      jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
      ) as { useChartTimeRangeZoom: UseChartTimeRangeZoom };

    return {
      __esModule: true,
      default: (props: ChartsProps): React.ReactElement => {
        const pageZoom: ChartTimeRangeZoomContextValue | null =
          zoomContext.useChartTimeRangeZoom();
        chartsRenders.push({ props: props, pageZoom: pageZoom });

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

// The query builder, reduced to one edit per query.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig",
  () => {
    return {
      __esModule: true,
      default: (props: {
        data: MetricQueryConfigData;
        onChange?: ((data: MetricQueryConfigData) => void) | undefined;
      }): React.ReactElement => {
        const variable: string =
          props.data.metricAliasData?.metricVariable || "";
        return React.createElement(
          "button",
          {
            type: "button",
            "data-testid": `edit-query-${variable}`,
            onClick: (): void => {
              props.onChange?.({
                ...props.data,
                metricQueryData: {
                  ...props.data.metricQueryData,
                  filterData: {
                    ...props.data.metricQueryData.filterData,
                    metricName: "disk.usage",
                  },
                },
              });
            },
          },
          `Edit query ${variable}`,
        );
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

const capturedSavedViews: Array<TelemetrySavedViewState> = [];

/*
 * The zoom the explorer's toolbar sees. The saved-views control sits in the
 * toolbar, inside the explorer but outside MetricView, so what it reads is
 * the explorer's own zoom and nothing MetricView might keep for itself.
 */
const toolbarZoomRenders: Array<ChartTimeRangeZoomContextValue | null> = [];

const SAVED_QUERIES: Array<Record<string, string>> = [
  { metricName: "requests.count", variable: "a" },
];

const ROLLING_SAVED_VIEW: TelemetrySavedViewState = {
  explorerConfig: {
    metricQueries: SAVED_QUERIES,
    rangeToken: "Past 3 Hours",
  },
};

const PINNED_SAVED_VIEW: TelemetrySavedViewState = {
  explorerConfig: {
    metricQueries: SAVED_QUERIES,
    startTime: "2026-09-28T09:00:00.000Z",
    endTime: "2026-09-28T10:00:00.000Z",
  },
};

// Saved views, reduced to loading one of two views and saving the current one.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    const zoomContext: { useChartTimeRangeZoom: UseChartTimeRangeZoom } =
      jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
      ) as { useChartTimeRangeZoom: UseChartTimeRangeZoom };

    return {
      __esModule: true,
      default: (props: {
        applyState: (state: TelemetrySavedViewState) => void;
        captureCurrentState: () => TelemetrySavedViewState;
      }): React.ReactElement => {
        toolbarZoomRenders.push(zoomContext.useChartTimeRangeZoom());

        return React.createElement(
          "div",
          null,
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "apply-rolling-saved-view",
              onClick: (): void => {
                props.applyState(ROLLING_SAVED_VIEW);
              },
            },
            "Load rolling view",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "apply-pinned-saved-view",
              onClick: (): void => {
                props.applyState(PINNED_SAVED_VIEW);
              },
            },
            "Load pinned view",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "save-current-view",
              onClick: (): void => {
                capturedSavedViews.push(props.captureCurrentState());
              },
            },
            "Save view",
          ),
        );
      },
    };
  },
);

interface DrawerRender {
  window: InBetween<Date>;
  metricViewData: MetricViewData;
  pageZoom: ChartTimeRangeZoomContextValue | null;
}

const drawerRenders: Array<DrawerRender> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    const zoomContext: { useChartTimeRangeZoom: UseChartTimeRangeZoom } =
      jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
      ) as { useChartTimeRangeZoom: UseChartTimeRangeZoom };

    return {
      __esModule: true,
      default: (props: {
        window: InBetween<Date>;
        metricViewData: MetricViewData;
        onClose: () => void;
      }): React.ReactElement => {
        drawerRenders.push({
          window: props.window,
          metricViewData: props.metricViewData,
          pageZoom: zoomContext.useChartTimeRangeZoom(),
        });
        return React.createElement(
          "div",
          { "data-testid": "investigation-drawer" },
          React.createElement(
            "button",
            {
              type: "button",
              onClick: (): void => {
                props.onClose();
              },
            },
            "Close the drawer",
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
import Incident from "../../../Models/DatabaseModels/Incident";
import TimeRange from "../../../Types/Time/TimeRange";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Route from "../../../Types/API/Route";
import CommonURL from "../../../Types/API/URL";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-28T11:10:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:40:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");

const AUTO_REFRESH_STORAGE_KEY: string =
  "metric-explorer-auto-refresh-interval";

// Two query panels: a drag on one and a double-click on the other.
const TWO_QUERIES_PARAM: string = JSON.stringify([
  { metricName: "cpu.usage", variable: "a" },
  { metricName: "memory.usage", variable: "b" },
]);

function explorerSearch(extra: string = ""): string {
  return `?metricQueries=${encodeURIComponent(TWO_QUERIES_PARAM)}${extra}`;
}

async function renderExplorer(search: string): Promise<void> {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/metrics/view${search}`,
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

function latestCharts(): ChartsRender {
  const last: ChartsRender | undefined =
    chartsRenders[chartsRenders.length - 1];
  if (!last) {
    throw new Error("MetricCharts has not rendered");
  }
  return last;
}

// The explorer's own zoom, as its toolbar sees it.
function explorerZoom(): ChartTimeRangeZoomContextValue {
  const last: ChartTimeRangeZoomContextValue | null | undefined =
    toolbarZoomRenders[toolbarZoomRenders.length - 1];
  if (!last) {
    throw new Error("The explorer offers no zoom to its toolbar");
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

function customLabel(startTime: Date, endTime: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(startTime, endTime),
  });
}

function presetLabel(range: TimeRange): string {
  return getTimeRangeButtonLabel({ range: range });
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

// A window as epoch milliseconds, [start, end], so it compares by value.
type EpochWindow = [number, number];

function toWindow(startTime: Date, endTime: Date): EpochWindow {
  return [startTime.getTime(), endTime.getTime()];
}

function fetchedChartWindows(): Array<EpochWindow> {
  return fetchResultsMock.mock.calls.map(
    (call: Array<unknown>): EpochWindow => {
      const data: MetricViewData = (
        call[0] as { metricViewData: MetricViewData }
      ).metricViewData;
      return toWindow(
        data.startAndEndDate!.startValue,
        data.startAndEndDate!.endValue,
      );
    },
  );
}

function lastFetchedChartWindow(): EpochWindow {
  const windows: Array<EpochWindow> = fetchedChartWindows();
  const last: EpochWindow | undefined = windows[windows.length - 1];
  if (!last) {
    throw new Error("No chart data was fetched");
  }
  return last;
}

function lastFetchedMetricNames(): Array<string> {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error("No chart data was fetched");
  }
  return (
    last[0] as { metricViewData: MetricViewData }
  ).metricViewData.queryConfigs.map(
    (queryConfig: MetricQueryConfigData): string => {
      const filterData: Record<string, unknown> = queryConfig.metricQueryData
        .filterData as unknown as Record<string, unknown>;
      return String(filterData["metricName"]);
    },
  );
}

// The windows the incident markers were fetched for.
function incidentMarkerWindows(): Array<EpochWindow> {
  return modelGetListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        modelType: unknown;
        query: { createdAt?: InBetween<Date> | undefined };
      };
    })
    .filter(
      (args: {
        modelType: unknown;
        query: { createdAt?: InBetween<Date> | undefined };
      }): boolean => {
        return args.modelType === Incident && Boolean(args.query.createdAt);
      },
    )
    .map(
      (args: {
        modelType: unknown;
        query: { createdAt?: InBetween<Date> | undefined };
      }): EpochWindow => {
        return toWindow(
          args.query.createdAt!.startValue,
          args.query.createdAt!.endValue,
        );
      },
    );
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function urlWindow(): EpochWindow {
  return [
    new Date(urlParam("startTime") || "").getTime(),
    new Date(urlParam("endTime") || "").getTime(),
  ];
}

function expectZoomedTo(startTime: Date, endTime: Date): void {
  expect(pickerButton()).toHaveTextContent(customLabel(startTime, endTime));
  // The way back sits beside the picker, and nowhere else.
  expect(
    within(pickerRow()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toBeVisible();
  expect(
    screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toHaveLength(1);
  // A zoomed window is pinned: no preset in the URL, the window itself.
  expect(urlParam("range")).toBeNull();
  expect(urlWindow()).toEqual(toWindow(startTime, endTime));
}

function expectNotZoomed(): void {
  expect(resetZoomButton()).toBeNull();
  const charts: ChartsRender = latestCharts();
  // With nothing to undo, single clicks on a chart are not held back.
  expect(charts.props.onTimeRangeReset).toBeUndefined();
  expect(charts.pageZoom?.isZoomed).toBe(false);
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.localStorage.clear();

  chartsRenders.length = 0;
  drawerRenders.length = 0;
  capturedSavedViews.length = 0;
  toolbarZoomRenders.length = 0;
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
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.localStorage.clear();
});

describe("Metric explorer: every chart zooms the explorer", () => {
  test("every chart takes the explorer's zoom, with nothing to undo before a drag", async () => {
    await renderExplorer(explorerSearch());

    expect(screen.getByTestId("chart-a")).toBeInTheDocument();
    expect(screen.getByTestId("chart-b")).toBeInTheDocument();

    /*
     * The handlers MetricCharts forwards to every panel are the explorer's
     * own zoom (the one its toolbar sees), not a zoom MetricView keeps over
     * a window of its own; the charts read the same zoom from the page.
     */
    const charts: ChartsRender = latestCharts();
    expect(charts.props.onTimeRangeSelect).toBeInstanceOf(Function);
    expect(charts.props.onTimeRangeSelect).toBe(
      explorerZoom().onTimeRangeSelect,
    );
    expect(charts.pageZoom).toBe(explorerZoom());
    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_ONE_HOUR),
    );
    expectNotZoomed();
    expect(lastFetchedChartWindow()).toEqual(toWindow(HOUR_AGO, NOW));
  });

  test("a drag on one chart retimes the explorer: picker, Reset zoom, URL, chart data and event markers", async () => {
    await renderExplorer(explorerSearch());
    const zoomBefore: ChartTimeRangeZoomContextValue = explorerZoom();
    fetchResultsMock.mockClear();
    modelGetListMock.mockClear();

    dragAcross("a", ZOOM_START, ZOOM_END);

    expectZoomedTo(ZOOM_START, ZOOM_END);
    await waitFor(() => {
      expect(fetchedChartWindows()).toContainEqual(
        toWindow(ZOOM_START, ZOOM_END),
      );
    });
    await waitFor(() => {
      expect(incidentMarkerWindows()).toContainEqual(
        toWindow(ZOOM_START, ZOOM_END),
      );
    });

    // Every panel now offers the same way back: the explorer's.
    const zoomAfter: ChartTimeRangeZoomContextValue = explorerZoom();
    expect(zoomAfter.isZoomed).toBe(true);
    expect(zoomAfter.rangeBeforeZoom?.range).toBe(TimeRange.PAST_ONE_HOUR);
    const charts: ChartsRender = latestCharts();
    expect(charts.pageZoom).toBe(zoomAfter);
    expect(charts.props.onTimeRangeReset).toBeInstanceOf(Function);
    expect(charts.props.onTimeRangeReset).toBe(zoomAfter.onTimeRangeReset);
    // The zoom handlers keep their identity across the zoom.
    expect(charts.props.onTimeRangeSelect).toBe(zoomBefore.onTimeRangeSelect);
  });

  test("a double-click on a different chart puts the original rolling range back everywhere", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);
    expectZoomedTo(ZOOM_START, ZOOM_END);
    fetchResultsMock.mockClear();
    modelGetListMock.mockClear();

    doubleClick("b");

    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_ONE_HOUR),
    );
    expectNotZoomed();
    // Rolling again: the preset is back in the URL, resolved against now.
    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(urlWindow()).toEqual(toWindow(HOUR_AGO, NOW));
    await waitFor(() => {
      expect(lastFetchedChartWindow()).toEqual(toWindow(HOUR_AGO, NOW));
    });
    await waitFor(() => {
      expect(incidentMarkerWindows()).toContainEqual(toWindow(HOUR_AGO, NOW));
    });
  });

  test("nested zooms: one double-click returns to the range before the FIRST zoom", async () => {
    await renderExplorer(explorerSearch());

    dragAcross("a", ZOOM_START, ZOOM_END);
    dragAcross("b", INNER_ZOOM_START, INNER_ZOOM_END);

    expectZoomedTo(INNER_ZOOM_START, INNER_ZOOM_END);
    expect(latestCharts().pageZoom?.rangeBeforeZoom?.range).toBe(
      TimeRange.PAST_ONE_HOUR,
    );

    doubleClick("a");

    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_ONE_HOUR),
    );
    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expectNotZoomed();
  });

  test("Reset zoom beside the picker does what a double-click does, and goes away", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("b", ZOOM_START, ZOOM_END);
    fetchResultsMock.mockClear();

    fireEvent.click(
      within(pickerRow()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_ONE_HOUR),
    );
    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expectNotZoomed();
    await waitFor(() => {
      expect(lastFetchedChartWindow()).toEqual(toWindow(HOUR_AGO, NOW));
    });
  });

  test("a double-click before any zoom changes nothing", async () => {
    await renderExplorer(explorerSearch());
    const searchBefore: string = window.location.search;
    fetchResultsMock.mockClear();

    doubleClick("a");

    expect(window.location.search).toBe(searchBefore);
    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_ONE_HOUR),
    );
    expectNotZoomed();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("a zero-width drag is not a zoom; a right-to-left drag zooms the same window", async () => {
    await renderExplorer(explorerSearch());
    fetchResultsMock.mockClear();

    dragAcross("a", ZOOM_START, ZOOM_START);

    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expectNotZoomed();
    expect(fetchResultsMock).not.toHaveBeenCalled();

    dragAcross("a", ZOOM_END, ZOOM_START);

    expectZoomedTo(ZOOM_START, ZOOM_END);
  });

  test("a drag that runs past now stops at now", async () => {
    await renderExplorer(explorerSearch());

    dragAcross(
      "a",
      new Date("2026-09-28T11:50:00.000Z"),
      new Date("2026-09-28T12:05:00.000Z"),
    );

    expectZoomedTo(new Date("2026-09-28T11:50:00.000Z"), NOW);
  });

  test("a picker pick while zoomed is a new starting point: the zoom ends", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);
    expectZoomedTo(ZOOM_START, ZOOM_END);

    fireEvent.click(pickerButton());
    fireEvent.click(
      screen.getByRole("button", {
        name: presetLabel(TimeRange.PAST_THREE_HOURS),
      }),
    );

    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_THREE_HOURS),
    );
    expect(urlParam("range")).toBe(TimeRange.PAST_THREE_HOURS);
    expectNotZoomed();

    // Nothing left to undo: a double-click does not go back to the hour.
    doubleClick("b");

    expect(urlParam("range")).toBe(TimeRange.PAST_THREE_HOURS);
  });

  test("loading a rolling saved view ends the zoom", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);
    expectZoomedTo(ZOOM_START, ZOOM_END);

    fireEvent.click(screen.getByTestId("apply-rolling-saved-view"));

    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_THREE_HOURS),
    );
    expect(urlParam("range")).toBe(TimeRange.PAST_THREE_HOURS);
    await waitFor(() => {
      expect(lastFetchedMetricNames()).toEqual(["requests.count"]);
    });
    expectNotZoomed();
  });

  test("loading a pinned saved view ends the zoom; a double-click then leaves it alone", async () => {
    const savedStart: Date = new Date("2026-09-28T09:00:00.000Z");
    const savedEnd: Date = new Date("2026-09-28T10:00:00.000Z");
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);

    fireEvent.click(screen.getByTestId("apply-pinned-saved-view"));

    expect(pickerButton()).toHaveTextContent(customLabel(savedStart, savedEnd));
    expectNotZoomed();
    expect(urlWindow()).toEqual(toWindow(savedStart, savedEnd));

    doubleClick("a");

    expect(pickerButton()).toHaveTextContent(customLabel(savedStart, savedEnd));
    expect(urlWindow()).toEqual(toWindow(savedStart, savedEnd));
    expect(urlParam("range")).toBeNull();
  });

  test("a view saved while zoomed keeps the zoomed window, pinned; after the reset it keeps the preset", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);

    fireEvent.click(screen.getByTestId("save-current-view"));
    doubleClick("a");
    fireEvent.click(screen.getByTestId("save-current-view"));

    const [whileZoomed, afterReset] = capturedSavedViews;
    expect(whileZoomed?.explorerConfig?.["rangeToken"]).toBeUndefined();
    expect(whileZoomed?.explorerConfig?.["startTime"]).toBe(
      ZOOM_START.toISOString(),
    );
    expect(whileZoomed?.explorerConfig?.["endTime"]).toBe(
      ZOOM_END.toISOString(),
    );
    expect(afterReset?.explorerConfig?.["rangeToken"]).toBe(
      TimeRange.PAST_ONE_HOUR,
    );
  });

  test("a pinned deep link zooms back to its own pinned window, not to a preset", async () => {
    const linkStart: Date = new Date("2026-09-28T10:00:00.000Z");
    const linkEnd: Date = new Date("2026-09-28T11:00:00.000Z");
    await renderExplorer(
      explorerSearch(
        `&startTime=${encodeURIComponent(linkStart.toISOString())}&endTime=${encodeURIComponent(linkEnd.toISOString())}`,
      ),
    );
    expect(pickerButton()).toHaveTextContent(customLabel(linkStart, linkEnd));

    const zoomStart: Date = new Date("2026-09-28T10:20:00.000Z");
    const zoomEnd: Date = new Date("2026-09-28T10:30:00.000Z");
    dragAcross("a", zoomStart, zoomEnd);
    expectZoomedTo(zoomStart, zoomEnd);
    fetchResultsMock.mockClear();

    doubleClick("b");

    expect(pickerButton()).toHaveTextContent(customLabel(linkStart, linkEnd));
    expect(urlParam("range")).toBeNull();
    expect(urlWindow()).toEqual(toWindow(linkStart, linkEnd));
    expectNotZoomed();
    await waitFor(() => {
      expect(lastFetchedChartWindow()).toEqual(toWindow(linkStart, linkEnd));
    });
  });

  test("a rolling deep link resets to its preset, re-anchored to the time of the reset", async () => {
    await renderExplorer(
      explorerSearch(
        `&range=${encodeURIComponent(TimeRange.PAST_THREE_HOURS)}`,
      ),
    );
    dragAcross(
      "a",
      new Date("2026-09-28T10:00:00.000Z"),
      new Date("2026-09-28T10:30:00.000Z"),
    );

    // Five minutes later the reader double-clicks their way back.
    const later: Date = new Date("2026-09-28T12:05:00.000Z");
    jest.setSystemTime(later);
    doubleClick("a");

    expect(pickerButton()).toHaveTextContent(
      presetLabel(TimeRange.PAST_THREE_HOURS),
    );
    expect(urlParam("range")).toBe(TimeRange.PAST_THREE_HOURS);
    expect(urlWindow()).toEqual(
      toWindow(new Date("2026-09-28T09:05:00.000Z"), later),
    );
    expectNotZoomed();
  });

  test("auto-refresh keeps a zoom pinned and refetches it; after the reset the window rolls again", async () => {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "30s");
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);
    fetchResultsMock.mockClear();

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    // The refresh fetched the zoomed window again instead of sliding it.
    for (const fetched of fetchedChartWindows()) {
      expect(fetched).toEqual(toWindow(ZOOM_START, ZOOM_END));
    }
    expectZoomedTo(ZOOM_START, ZOOM_END);

    doubleClick("b");
    fetchResultsMock.mockClear();

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    // Re-anchored to the new "now", past the moment of the reset.
    expect(lastFetchedChartWindow()[1]).toBeGreaterThan(NOW.getTime());
    expectNotZoomed();
  });

  test("a query edit while zoomed keeps the zoom and fetches the edit over the zoomed window", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);
    fetchResultsMock.mockClear();

    fireEvent.click(screen.getByTestId("edit-query-a"));

    await waitFor(() => {
      expect(lastFetchedMetricNames()).toEqual(["disk.usage", "memory.usage"]);
    });
    expect(lastFetchedChartWindow()).toEqual(toWindow(ZOOM_START, ZOOM_END));
    expectZoomedTo(ZOOM_START, ZOOM_END);

    // The way back keeps the edit.
    doubleClick("b");

    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_HOUR);
    await waitFor(() => {
      expect(lastFetchedChartWindow()).toEqual(toWindow(HOUR_AGO, NOW));
    });
    expect(lastFetchedMetricNames()).toEqual(["disk.usage", "memory.usage"]);
  });

  test("the logs pivot opens the logs explorer on the zoomed window", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);

    fireEvent.click(
      screen.getByRole("button", {
        name: "View logs for this time window and filters",
      }),
    );

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledTimes(1);
    });
    const target: Route | CommonURL = navigateSpy.mock.calls[0]![0] as
      | Route
      | CommonURL;
    const params: URLSearchParams = new URL(target.toString()).searchParams;
    expect(params.get("range")).toBe(TimeRange.CUSTOM);
    expect(new Date(params.get("start") || "").getTime()).toBe(
      ZOOM_START.getTime(),
    );
    expect(new Date(params.get("end") || "").getTime()).toBe(
      ZOOM_END.getTime(),
    );
  });

  test("the investigation drawer opens on the zoomed window but never gets the explorer's zoom", async () => {
    await renderExplorer(explorerSearch());
    dragAcross("a", ZOOM_START, ZOOM_END);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Investigate this time window in a side panel",
      }),
    );

    expect(screen.getByTestId("investigation-drawer")).toBeInTheDocument();
    const drawer: DrawerRender | undefined =
      drawerRenders[drawerRenders.length - 1];
    expect(drawer).toBeDefined();
    expect(
      toWindow(drawer!.window.startValue, drawer!.window.endValue),
    ).toEqual(toWindow(ZOOM_START, ZOOM_END));
    /*
     * The drawer keeps windows of its own: nothing in it may retime the
     * explorer behind it, and no picker in it may offer the explorer's
     * "Reset zoom".
     */
    expect(drawer!.pageZoom).toBeNull();
    // The explorer's own zoom is untouched by opening it.
    expectZoomedTo(ZOOM_START, ZOOM_END);
  });
});

describe("the investigation drawer is a snapshot of the view it was opened on", () => {
  function investigate(): void {
    fireEvent.click(
      screen.getByRole("button", {
        name: "Investigate this time window in a side panel",
      }),
    );
  }

  function latestDrawer(): DrawerRender {
    const last: DrawerRender | undefined =
      drawerRenders[drawerRenders.length - 1];
    if (!last) {
      throw new Error("The investigation drawer has not rendered");
    }
    return last;
  }

  test("an auto-refresh tick rolls the explorer on but leaves the drawer's window and view alone", async () => {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "30s");
    await renderExplorer(explorerSearch());

    investigate();
    const opened: DrawerRender = latestDrawer();
    expect(toWindow(opened.window.startValue, opened.window.endValue)).toEqual(
      toWindow(HOUR_AGO, NOW),
    );
    const rendersBefore: number = drawerRenders.length;
    fetchResultsMock.mockClear();

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });

    // The explorer re-resolved its rolling hour against the new "now"...
    expect(lastFetchedChartWindow()[1]).toBeGreaterThan(NOW.getTime());
    expect(drawerRenders.length).toBeGreaterThan(rendersBefore);

    /*
     * ...and the drawer was handed exactly what it was opened with. A new
     * window would re-pin it (dropping a zoom or a range picked inside it),
     * and a new view object would reload everything in it.
     */
    const afterTick: DrawerRender = latestDrawer();
    expect(afterTick.window).toBe(opened.window);
    expect(afterTick.metricViewData).toBe(opened.metricViewData);
    expect(
      toWindow(afterTick.window.startValue, afterTick.window.endValue),
    ).toEqual(toWindow(HOUR_AGO, NOW));
  });

  test("several ticks later the drawer is still on the moment it was opened", async () => {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "30s");
    await renderExplorer(explorerSearch());
    investigate();
    const opened: DrawerRender = latestDrawer();

    for (let tick: number = 0; tick < 4; tick++) {
      fetchResultsMock.mockClear();
      act(() => {
        jest.advanceTimersByTime(30_000);
      });
      await waitFor(() => {
        expect(fetchResultsMock).toHaveBeenCalled();
      });
    }

    expect(latestDrawer().window).toBe(opened.window);
    expect(latestDrawer().metricViewData).toBe(opened.metricViewData);
  });

  test("the snapshot carries the explorer's queries as they were on the click", async () => {
    await renderExplorer(explorerSearch());
    investigate();

    const viewData: MetricViewData = latestDrawer().metricViewData;
    expect(
      viewData.queryConfigs.map((queryConfig: MetricQueryConfigData) => {
        return (
          queryConfig.metricQueryData.filterData as unknown as {
            metricName: string;
          }
        ).metricName;
      }),
    ).toEqual(["cpu.usage", "memory.usage"]);
  });

  test("closing and investigating again takes a fresh snapshot of the current view", async () => {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "30s");
    await renderExplorer(explorerSearch());
    investigate();
    const first: DrawerRender = latestDrawer();

    fetchResultsMock.mockClear();
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText("Close the drawer"));
    expect(screen.queryByTestId("investigation-drawer")).toBeNull();

    investigate();
    const second: DrawerRender = latestDrawer();
    expect(second.window).not.toBe(first.window);
    expect(second.window.endValue.getTime()).toBeGreaterThan(NOW.getTime());
    expect(second.window.endValue.getTime()).toBe(lastFetchedChartWindow()[1]);
  });

  test("a zoom made on the explorer behind an open drawer does not move the drawer", async () => {
    await renderExplorer(explorerSearch());
    investigate();
    const opened: DrawerRender = latestDrawer();

    dragAcross("a", ZOOM_START, ZOOM_END);

    expectZoomedTo(ZOOM_START, ZOOM_END);
    expect(latestDrawer().window).toBe(opened.window);
    expect(
      drawerRenders.every((render: DrawerRender) => {
        return render.pageZoom === null;
      }),
    ).toBe(true);
  });
});
