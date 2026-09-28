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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the Service overview (Pages/Service/View/Index.tsx): the
 * page's range IS the zoom. A drag across any of its chart cards - the
 * four fixed ones and every runtime chart - sets the page's range to the
 * window dragged out, so every chart and tile refetches for it and the hero
 * picker reads Custom with a "Reset zoom" beside it; a double-click on any
 * chart (not only the one dragged) puts the range from before the zoom
 * back.
 *
 * The page is rendered for real over fake fetchers. The chart canvas is
 * stood in for by a recorder that resolves its zoom exactly as the real
 * chart wrapper does (resolveChartTimeRangeZoom over the page's context)
 * and exposes the two gestures as buttons. The hero picker is the real
 * TelemetryTimeRangePicker, so its "Reset zoom" is the real one too.
 *
 * jest.mock is hoisted above the imports, so the factories only close over
 * names that start with "mock", and read them when a call happens.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:22:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:25:00.000Z");

type MockZoomHandlers = {
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
};

interface MockChartProps {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
  xAxis: { options: { type: string; min: Date; max: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

interface MockChartRecord {
  props: MockChartProps;
  zoom: MockZoomHandlers;
}

type MockZoomContextModule =
  typeof import("../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext");

// The latest render of each chart, keyed by the series it draws.
const mockCharts: Map<string, MockChartRecord> = new Map<
  string,
  MockChartRecord
>();
// Where the stand-in chart's "drag" lands; a test moves it as it needs.
let mockDragWindow: [Date, Date] = [ZOOM_START, ZOOM_END];
// The page's auto-refresh tick, fired by hand.
let mockAutoRefresh: (() => void) | null = null;

const getItemMock: MockFunction = getJestMockFunction();
const fetchSpanMetricsMock: MockFunction = getJestMockFunction();
const fetchSignalsMock: MockFunction = getJestMockFunction();
const fetchMetricSeriesMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("aaaaaaaa-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("dddddddd-0000-4000-8000-000000000004");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const format: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...format,
      fetchSpanMetrics: (...args: Array<unknown>): unknown => {
        return fetchSpanMetricsMock(...args);
      },
      fetchLogAndExceptionSignals: (...args: Array<unknown>): unknown => {
        return fetchSignalsMock(...args);
      },
      fetchMetricSeries: (...args: Array<unknown>): unknown => {
        return fetchMetricSeriesMock(...args);
      },
    };
  },
);

/*
 * recharts draws nothing in jsdom. The stand-in takes its zoom the way the
 * real wrapper does, records it, and offers the drag and the double-click.
 */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const zoomContext: MockZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as MockZoomContextModule;
  return {
    __esModule: true,
    default: (props: MockChartProps): React.ReactElement => {
      const zoom: MockZoomHandlers = zoomContext.resolveChartTimeRangeZoom({
        onTimeRangeSelect: props.onTimeRangeSelect,
        onTimeRangeReset: props.onTimeRangeReset,
        isTimeAxis:
          props.xAxis.options.type === "time" ||
          props.xAxis.options.type === "date",
        disableTimeRangeZoom: props.disableTimeRangeZoom,
        pageZoom: zoomContext.useChartTimeRangeZoom(),
      });
      const name: string = props.data
        .map((series: { seriesName: string }): string => {
          return series.seriesName;
        })
        .join(",");
      mockCharts.set(name, { props: props, zoom: zoom });
      return (
        <div data-testid="line-chart" data-series={name}>
          <button
            type="button"
            onClick={() => {
              zoom.onTimeRangeSelect?.(mockDragWindow[0], mockDragWindow[1]);
            }}
          >
            {`Drag across ${name}`}
          </button>
          <button
            type="button"
            onDoubleClick={() => {
              zoom.onTimeRangeReset?.();
            }}
          >
            {`Double-click ${name}`}
          </button>
        </div>
      );
    },
  };
});

// The hero controls: the page's own picker, and a refresh button.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onManualRefresh: () => void;
        timeRangePicker?: React.ReactNode;
      }): React.ReactElement => {
        return (
          <div>
            {props.timeRangePicker}
            <button type="button" onClick={props.onManualRefresh}>
              Refresh now
            </button>
          </div>
        );
      },
    };
  },
);

// No interval timer: a tick happens when a test fires one.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: (options: { onRefresh: () => void }) => {
        mockAutoRefresh = options.onRefresh;
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

// Not range-based (ongoing incidents, alerts, maintenance).
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import ServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  LogAndExceptionSignals,
  SpanMetrics,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/services/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

// Every chart on the page, by the series it draws.
const REQUESTS_CHART: string = "Requests,Errors";
const LATENCY_CHART: string = "p95";
const LOGS_CHART: string = "Log lines,Errors";
const EXCEPTIONS_CHART: string = "Unhandled,Handled";
const RUNTIME_CHART: string = "Event loop utilization";
const ALL_CHARTS: Array<string> = [
  REQUESTS_CHART,
  LATENCY_CHART,
  LOGS_CHART,
  EXCEPTIONS_CHART,
  RUNTIME_CHART,
];

interface FetchScope {
  start: Date;
  end: Date;
  name?: string;
}

function isZoomWindow(scope: FetchScope, start: Date, end: Date): boolean {
  return (
    scope.start.getTime() === start.getTime() &&
    scope.end.getTime() === end.getTime()
  );
}

/*
 * The span totals tell the windows apart on the tiles: 4.3k requests over
 * the hour, 777 in the ten zoomed minutes, 6.1k in the inner zoom.
 */
function spanMetricsFor(scope: FetchScope): SpanMetrics {
  const zoomed: boolean = isZoomWindow(scope, ZOOM_START, ZOOM_END);
  const inner: boolean = isZoomWindow(scope, INNER_ZOOM_START, INNER_ZOOM_END);
  const total: number = zoomed ? 777 : inner ? 6100 : 4321;
  const pointAt: Date = new Date(scope.start.getTime() + 60 * 1000);

  return {
    total: total,
    errors: 1,
    errorRatePercent: (1 / total) * 100,
    p95DurationMs: 42,
    countSeries: [{ x: pointAt, y: total }],
    errorSeries: [{ x: pointAt, y: 1 }],
    p95Series: [{ x: pointAt, y: 42 }],
  };
}

function signalsFor(scope: FetchScope): LogAndExceptionSignals {
  const pointAt: Date = new Date(scope.start.getTime() + 60 * 1000);

  return {
    logs: {
      total: 10,
      errorCount: 2,
      countSeries: [{ x: pointAt, y: 10 }],
      errorSeries: [{ x: pointAt, y: 2 }],
      failed: false,
    },
    exceptions: {
      total: 3,
      unhandledCount: 1,
      unhandledSeries: [{ x: pointAt, y: 1 }],
      handledSeries: [{ x: pointAt, y: 2 }],
      failed: false,
    },
  };
}

function arrange(): void {
  getItemMock.mockImplementation(async () => {
    return {
      name: "checkout",
      telemetrySdkLanguage: "nodejs",
      lastSeenAt: new Date(NOW.getTime() - 60 * 1000),
    };
  });
  fetchSpanMetricsMock.mockImplementation(async (scope: unknown) => {
    return spanMetricsFor(scope as FetchScope);
  });
  fetchSignalsMock.mockImplementation(async (scope: unknown) => {
    return signalsFor(scope as FetchScope);
  });
  // Node.js reports only its event loop: one runtime chart.
  fetchMetricSeriesMock.mockImplementation(async (scope: unknown) => {
    const metricScope: FetchScope = scope as FetchScope;
    if (metricScope.name !== "nodejs.eventloop.utilization") {
      return [];
    }
    return [{ x: new Date(metricScope.start.getTime() + 60 * 1000), y: 0.4 }];
  });
}

function chart(name: string): MockChartRecord {
  const record: MockChartRecord | undefined = mockCharts.get(name);
  if (!record) {
    throw new Error(`The ${name} chart has not rendered`);
  }
  return record;
}

function windowOf(scope: unknown): [number, number] {
  const fetchScope: FetchScope = scope as FetchScope;
  return [fetchScope.start.getTime(), fetchScope.end.getTime()];
}

// The [start, end] of every call a fetcher received since it was cleared.
function fetchedWindows(mock: MockFunction): Array<[number, number]> {
  return mock.mock.calls.map((call: Array<unknown>): [number, number] => {
    return windowOf(call[0]);
  });
}

const ZOOM_WINDOW: [number, number] = [
  ZOOM_START.getTime(),
  ZOOM_END.getTime(),
];

function clearFetches(): void {
  fetchSpanMetricsMock.mockClear();
  fetchSignalsMock.mockClear();
  fetchMetricSeriesMock.mockClear();
}

function pickerButton(): HTMLElement {
  return screen.getByTestId(
    `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
  );
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <ServiceView {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  // The Requests tile over the whole hour, and every chart drawn.
  await screen.findByText("4.3k");
  await waitFor(() => {
    expect(screen.getAllByTestId("line-chart")).toHaveLength(ALL_CHARTS.length);
  });
}

async function dragAcross(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: `Drag across ${name}` }));
  // Let the fetches the drag started land.
  await act(async () => {
    await Promise.resolve();
  });
}

async function doubleClick(name: string): Promise<void> {
  fireEvent.doubleClick(
    screen.getByRole("button", { name: `Double-click ${name}` }),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

// A relative "past hour" resolved at some point after NOW.
function expectPastHour(window: [number, number]): void {
  expect(window[1] - window[0]).toBe(HOUR_MS);
  expect(window[1]).toBeGreaterThanOrEqual(NOW.getTime());
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockCharts.clear();
  mockDragWindow = [ZOOM_START, ZOOM_END];
  mockAutoRefresh = null;
  for (const mock of [
    getItemMock,
    fetchSpanMetricsMock,
    fetchSignalsMock,
    fetchMetricSeriesMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Service overview: one zoom for the whole page", () => {
  test("every chart - fixed and runtime - takes the page's one zoom, with nothing to undo yet", async () => {
    await renderPage();

    const first: MockZoomHandlers = chart(REQUESTS_CHART).zoom;
    expect(first.onTimeRangeSelect).toBeInstanceOf(Function);

    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeSelect).toBe(first.onTimeRangeSelect);
      // A reset handler holds every click back; none before a zoom.
      expect(chart(name).zoom.onTimeRangeReset).toBeUndefined();
    }

    expect(resetZoomButton()).toBeNull();
  });

  test("each chart card names the gesture", async () => {
    await renderPage();

    const hints: Array<HTMLElement> = screen.getAllByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );
    expect(hints).toHaveLength(ALL_CHARTS.length);
    for (const hint of hints) {
      expect(hint).toHaveTextContent("Drag to zoom");
      expect(hint).not.toHaveTextContent("double-click");
    }
  });

  test("the charts and every fetch start on the page's range, the past hour", async () => {
    await renderPage();

    expectPastHour(windowOf(fetchSpanMetricsMock.mock.calls[0]![0]));
    expectPastHour(windowOf(fetchSignalsMock.mock.calls[0]![0]));
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");

    for (const name of ALL_CHARTS) {
      const options: { min: Date; max: Date } = chart(name).props.xAxis.options;
      expect(options.max.getTime() - options.min.getTime()).toBe(HOUR_MS);
    }
  });
});

describe("Service overview: a drag zooms the page", () => {
  test("a drag on one chart refetches every chart and tile for the window dragged out", async () => {
    await renderPage();
    clearFetches();

    await dragAcross(REQUESTS_CHART);

    /*
     * The span metrics (two charts, three tiles), the log and exception
     * signals (two charts) and the runtime probe (the rest) - all of it.
     */
    expect(fetchedWindows(fetchSpanMetricsMock)).toEqual([ZOOM_WINDOW]);
    expect(fetchedWindows(fetchSignalsMock)).toEqual([ZOOM_WINDOW]);
    expect(fetchMetricSeriesMock.mock.calls.length).toBeGreaterThan(0);
    for (const window of fetchedWindows(fetchMetricSeriesMock)) {
      expect(window).toEqual(ZOOM_WINDOW);
    }

    // The tiles now describe the ten zoomed minutes.
    expect(await screen.findByText("777")).toBeInTheDocument();
    expect(screen.queryByText("4.3k")).toBeNull();
  });

  test("every chart is redrawn over the zoomed window", async () => {
    await renderPage();

    await dragAcross(LATENCY_CHART);

    await waitFor(() => {
      for (const name of ALL_CHARTS) {
        const options: { min: Date; max: Date } =
          chart(name).props.xAxis.options;
        expect([options.min.getTime(), options.max.getTime()]).toEqual(
          ZOOM_WINDOW,
        );
      }
    });
  });

  test("the picker reads Custom and offers Reset zoom; every chart can now reset", async () => {
    await renderPage();

    await dragAcross(RUNTIME_CHART);

    expect(pickerButton()).not.toHaveTextContent("Past 1 Hour");
    expect(resetZoomButton()).toBeVisible();

    const reset: (() => void) | undefined =
      chart(REQUESTS_CHART).zoom.onTimeRangeReset;
    expect(reset).toBeInstanceOf(Function);
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeReset).toBe(reset);
    }

    for (const hint of screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)) {
      expect(hint).toHaveTextContent("Drag to zoom · double-click to reset");
    }
  });

  test("a drag that runs past now is cut at the end of the page's window", async () => {
    await renderPage();
    // waitFor ticks the fake clock; put "now" back where the test reads it.
    jest.setSystemTime(NOW);
    clearFetches();
    mockDragWindow = [
      new Date("2026-09-28T11:50:00.000Z"),
      new Date("2026-09-28T12:10:00.000Z"),
    ];

    await dragAcross(REQUESTS_CHART);

    expect(fetchedWindows(fetchSpanMetricsMock)).toEqual([
      [new Date("2026-09-28T11:50:00.000Z").getTime(), NOW.getTime()],
    ]);
  });

  test("a drag that covers no time leaves the page alone", async () => {
    await renderPage();
    clearFetches();
    mockDragWindow = [ZOOM_START, ZOOM_START];

    await dragAcross(REQUESTS_CHART);

    expect(fetchSpanMetricsMock).not.toHaveBeenCalled();
    expect(resetZoomButton()).toBeNull();
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
  });
});

describe("Service overview: back out of a zoom", () => {
  test("a double-click on a DIFFERENT chart restores the past hour everywhere", async () => {
    await renderPage();
    await dragAcross(REQUESTS_CHART);
    await screen.findByText("777");
    clearFetches();

    await doubleClick(EXCEPTIONS_CHART);

    expect(fetchSpanMetricsMock).toHaveBeenCalledTimes(1);
    expectPastHour(windowOf(fetchSpanMetricsMock.mock.calls[0]![0]));
    expectPastHour(windowOf(fetchSignalsMock.mock.calls[0]![0]));
    expect(fetchMetricSeriesMock.mock.calls.length).toBeGreaterThan(0);
    for (const window of fetchedWindows(fetchMetricSeriesMock)) {
      expectPastHour(window);
    }

    expect(await screen.findByText("4.3k")).toBeInTheDocument();
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
    expect(resetZoomButton()).toBeNull();
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeReset).toBeUndefined();
    }
  });

  test("Reset zoom beside the picker does what a double-click does", async () => {
    await renderPage();
    await dragAcross(LOGS_CHART);
    clearFetches();

    fireEvent.click(resetZoomButton()!);
    await act(async () => {
      await Promise.resolve();
    });

    expectPastHour(windowOf(fetchSpanMetricsMock.mock.calls[0]![0]));
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
    expect(resetZoomButton()).toBeNull();
  });

  test("after a zoom inside a zoom, one double-click returns to the past hour", async () => {
    await renderPage();
    await dragAcross(REQUESTS_CHART);

    mockDragWindow = [INNER_ZOOM_START, INNER_ZOOM_END];
    clearFetches();
    await dragAcross(LATENCY_CHART);

    expect(fetchedWindows(fetchSpanMetricsMock)).toEqual([
      [INNER_ZOOM_START.getTime(), INNER_ZOOM_END.getTime()],
    ]);
    expect(await screen.findByText("6.1k")).toBeInTheDocument();

    clearFetches();
    await doubleClick(LOGS_CHART);

    expectPastHour(windowOf(fetchSpanMetricsMock.mock.calls[0]![0]));
    expect(await screen.findByText("4.3k")).toBeInTheDocument();
    expect(resetZoomButton()).toBeNull();
  });

  test("a double-click with nothing zoomed does not refetch anything", async () => {
    await renderPage();
    clearFetches();

    await doubleClick(REQUESTS_CHART);

    expect(fetchSpanMetricsMock).not.toHaveBeenCalled();
    expect(fetchSignalsMock).not.toHaveBeenCalled();
  });

  test("a zoom into a quiet stretch can be undone from the empty chart", async () => {
    await renderPage();
    fetchSpanMetricsMock.mockImplementation(async (scope: unknown) => {
      const metrics: SpanMetrics = spanMetricsFor(scope as FetchScope);
      return isZoomWindow(scope as FetchScope, ZOOM_START, ZOOM_END)
        ? { ...metrics, countSeries: [], errorSeries: [], p95Series: [] }
        : metrics;
    });

    await dragAcross(REQUESTS_CHART);
    const empties: Array<HTMLElement> = await screen.findAllByText(
      "No data in this time range",
    );
    // Requests and Latency both came back empty.
    expect(empties).toHaveLength(2);
    clearFetches();

    fireEvent.doubleClick(empties[0]!);
    await act(async () => {
      await Promise.resolve();
    });

    expectPastHour(windowOf(fetchSpanMetricsMock.mock.calls[0]![0]));
    expect(resetZoomButton()).toBeNull();
  });
});

describe("Service overview: the zoom and the rest of the page", () => {
  test("picking a range in the picker ends the zoom; a double-click then does nothing", async () => {
    await renderPage();
    await dragAcross(REQUESTS_CHART);
    clearFetches();

    fireEvent.click(pickerButton());
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Day" }));
    await act(async () => {
      await Promise.resolve();
    });

    const [start, end]: [number, number] = windowOf(
      fetchSpanMetricsMock.mock.calls[0]![0],
    );
    expect(end - start).toBe(DAY_MS);
    expect(resetZoomButton()).toBeNull();
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeReset).toBeUndefined();
    }

    clearFetches();
    await doubleClick(REQUESTS_CHART);
    expect(fetchSpanMetricsMock).not.toHaveBeenCalled();
  });

  test("an auto-refresh keeps the zoom: the same window is fetched again, and Reset zoom stays", async () => {
    await renderPage();
    await dragAcross(REQUESTS_CHART);
    await screen.findByText("777");
    clearFetches();

    await act(async () => {
      mockAutoRefresh!();
    });
    await waitFor(() => {
      expect(fetchSpanMetricsMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchedWindows(fetchSpanMetricsMock)).toEqual([ZOOM_WINDOW]);
    expect(fetchedWindows(fetchSignalsMock)).toEqual([ZOOM_WINDOW]);
    expect(resetZoomButton()).toBeVisible();
    expect(chart(REQUESTS_CHART).zoom.onTimeRangeReset).toBeInstanceOf(
      Function,
    );
  });

  test("the charts stay on screen while a refresh refetches, so a drag in progress is not lost", async () => {
    await renderPage();
    clearFetches();
    // The refresh's fetches never land: the page is mid-refresh throughout.
    fetchSpanMetricsMock.mockImplementation(() => {
      return new Promise<never>(() => {});
    });

    await act(async () => {
      mockAutoRefresh!();
    });
    await waitFor(() => {
      expect(fetchSpanMetricsMock).toHaveBeenCalledTimes(1);
    });

    // Every chart is still the chart, not a loading skeleton.
    expect(screen.getAllByTestId("line-chart")).toHaveLength(ALL_CHARTS.length);
    expect(
      screen.getByRole("button", { name: `Drag across ${REQUESTS_CHART}` }),
    ).toBeInTheDocument();
  });
});
