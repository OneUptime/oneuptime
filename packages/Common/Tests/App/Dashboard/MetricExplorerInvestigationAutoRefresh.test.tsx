/** @timezone UTC */

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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type MetricViewData from "../../../Types/Metrics/MetricViewData";
import type MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import type RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";

/*
 * Issue #4105, Metrics > Explorer with auto-refresh on. "Investigate" opens
 * the investigation drawer over the explorer; a drag on the drawer's log
 * volume chart zooms the whole drawer, and a range picked on its metric card
 * moves it. Auto-refresh re-resolves the explorer's rolling window on every
 * tick - and that used to reach the drawer, re-pinning it to the new window:
 * the drawer's zoom, its Reset zoom and a range picked on its card were all
 * gone within one interval, and every signal in it reloaded.
 *
 * The real MetricExplorer and the real InvestigationDrawer are mounted
 * against a mocked data layer. The explorer's charts, query builder and
 * saved views are stood in for (see MetricExplorerTimeRangeZoom.test.tsx);
 * so are the drawer's metric card and companion tabs, which record what
 * they are handed (see InvestigationDrawerZoom.test.tsx). Recharts is stood
 * in for so the drawer's histogram can be dragged.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const histogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const embeddedCardMock: MockFunction = getJestMockFunction();

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return react.createElement("div", { "data-testid": "metric-charts" });
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchLogsHistogramRaw: (...args: Array<unknown>) => {
        return histogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<unknown>) => {
        return patternsMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        return react.createElement(
          "div",
          { "data-testid": "companion-tabs" },
          props["primarySignalElement"] as React.ReactElement,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        embeddedCardMock(props);
        return react.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              (props["onTimeRangeChange"] as (range: unknown) => void)({
                range: "Past 30 Mins",
              });
            },
          },
          "Pick Past 30 Mins on the card",
        );
      },
    };
  },
);

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: StubChartProps) => {
      return react.createElement(
        "div",
        { "data-testid": "volume-bars" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bar-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    },
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import MetricExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TimeRange from "../../../Types/Time/TimeRange";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const AUTO_REFRESH_STORAGE_KEY: string =
  "metric-explorer-auto-refresh-interval";
const REFRESH_MS: number = 30_000;

// The explorer's rolling hour is drawn in one-minute log volume bars.
const BAR_A: string = "2026-09-28 11:10:00";
const BAR_B: string = "2026-09-28 11:11:00";

const OPENED_ON: string = "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z";
const ZOOMED: string = "2026-09-28T11:10:00.000Z..2026-09-28T11:12:00.000Z";

const QUERIES_PARAM: string = JSON.stringify([
  { metricName: "cpu.usage", variable: "a" },
]);

function lastHistogramWindow(): string {
  const calls: Array<Array<unknown>> = histogramMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const body: Record<string, unknown> = calls[calls.length - 1]![0] as Record<
    string,
    unknown
  >;
  return `${body["startTime"]}..${body["endTime"]}`;
}

function lastCardRange(): RangeStartAndEndDateTime {
  const calls: Array<Array<unknown>> = embeddedCardMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as Record<string, unknown>)[
    "timeRange"
  ] as RangeStartAndEndDateTime;
}

function cardWindow(): string {
  const range: RangeStartAndEndDateTime = lastCardRange();
  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }
  return `${range.startAndEndDate!.startValue.toISOString()}..${range.startAndEndDate!.endValue.toISOString()}`;
}

function lastFetchedExplorerEndMs(): number {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const data: MetricViewData = (
    calls[calls.length - 1]![0] as { metricViewData: MetricViewData }
  ).metricViewData;
  return data.startAndEndDate!.endValue.getTime();
}

function drawerResetButton(): HTMLElement | null {
  // The explorer is never zoomed here, so any Reset zoom is the drawer's.
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

async function renderAndInvestigate(): Promise<void> {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/metrics/view?metricQueries=${encodeURIComponent(QUERIES_PARAM)}`,
  );

  await act(async () => {
    render(<MetricExplorer />);
  });
  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
  jest.setSystemTime(NOW);

  fireEvent.click(
    screen.getByRole("button", {
      name: "Investigate this time window in a side panel",
    }),
  );

  await waitFor(() => {
    expect(screen.getByTestId(`bar-${BAR_A}`)).toBeInTheDocument();
  });
  expect(lastHistogramWindow()).toBe(OPENED_ON);
  await waitFor(() => {
    expect(screen.getByText("100")).toBeInTheDocument();
  });
}

async function tick(): Promise<void> {
  fetchResultsMock.mockClear();
  act(() => {
    jest.advanceTimersByTime(REFRESH_MS);
  });
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
  });
  // The explorer itself rolled on past the moment the drawer was opened.
  expect(lastFetchedExplorerEndMs()).toBeGreaterThan(NOW.getTime());
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "30s");

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
  histogramMock.mockReset();
  histogramMock.mockImplementation(async () => {
    return [
      { time: BAR_A, severity: "Information", count: 90 },
      { time: BAR_B, severity: "Error", count: 10 },
    ];
  });
  patternsMock.mockReset();
  patternsMock.mockImplementation(async () => {
    return [];
  });
  embeddedCardMock.mockReset();

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

describe("Metric Explorer auto-refresh and the investigation drawer", () => {
  test("a tick leaves the drawer on its window: nothing in it reloads or blanks", async () => {
    await renderAndInvestigate();
    const histogramCalls: number = histogramMock.mock.calls.length;
    const patternCalls: number = patternsMock.mock.calls.length;

    await tick();
    await tick();

    expect(histogramMock.mock.calls.length).toBe(histogramCalls);
    expect(patternsMock.mock.calls.length).toBe(patternCalls);
    expect(lastHistogramWindow()).toBe(OPENED_ON);
    expect(cardWindow()).toBe(OPENED_ON);
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.queryAllByText("…")).toHaveLength(0);
  });

  test("a zoom made on the drawer's log chart survives the ticks, with its way back", async () => {
    await renderAndInvestigate();

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bar-${BAR_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));

    await waitFor(() => {
      expect(lastHistogramWindow()).toBe(ZOOMED);
    });
    expect(drawerResetButton()).toBeInTheDocument();
    const histogramCalls: number = histogramMock.mock.calls.length;

    await tick();
    await tick();

    // Still zoomed, still with Reset zoom, and nothing asked again.
    expect(drawerResetButton()).toBeInTheDocument();
    expect(histogramMock.mock.calls.length).toBe(histogramCalls);
    expect(lastHistogramWindow()).toBe(ZOOMED);
    expect(cardWindow()).toBe(ZOOMED);
    expect(screen.getByText("Double-click to reset")).toBeInTheDocument();

    // And the way back still leads to the window the drawer was opened on.
    fireEvent.click(drawerResetButton()!);

    await waitFor(() => {
      expect(lastHistogramWindow()).toBe(OPENED_ON);
    });
    expect(drawerResetButton()).toBeNull();
  });

  test("a range picked on the drawer's metric card survives the ticks", async () => {
    await renderAndInvestigate();

    fireEvent.click(screen.getByText("Pick Past 30 Mins on the card"));

    await waitFor(() => {
      expect(cardWindow()).toBe(TimeRange.PAST_THIRTY_MINS);
    });
    expect(drawerResetButton()).toBeInTheDocument();

    await tick();

    expect(cardWindow()).toBe(TimeRange.PAST_THIRTY_MINS);
    expect(drawerResetButton()).toBeInTheDocument();
  });

  test("the drawer's card keeps the queries it was opened with across ticks", async () => {
    await renderAndInvestigate();
    const queries: Array<MetricQueryConfigData> = (
      embeddedCardMock.mock.calls[
        embeddedCardMock.mock.calls.length - 1
      ]![0] as {
        queryConfigs: Array<MetricQueryConfigData>;
      }
    ).queryConfigs;

    await tick();

    expect(
      (
        embeddedCardMock.mock.calls[
          embeddedCardMock.mock.calls.length - 1
        ]![0] as { queryConfigs: Array<MetricQueryConfigData> }
      ).queryConfigs,
    ).toBe(queries);
  });
});
