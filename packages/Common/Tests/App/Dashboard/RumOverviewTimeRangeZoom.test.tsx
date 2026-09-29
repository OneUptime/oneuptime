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

/*
 * Issue #4105 on the RUM application overview (Pages/Rum/View/Overview.tsx):
 * the page's range IS the zoom. A drag across any of its six chart cards
 * sets the page's range to the window dragged out, so every chart, every
 * tile, both web-vitals cards and the "Sessions recorded" link follow it,
 * and the hero picker reads Custom with "Reset zoom" beside it; a
 * double-click on any chart puts the range from before the zoom back.
 *
 * The page is rendered for real over fake fetchers. The chart canvas is
 * stood in for by a recorder that resolves its zoom exactly as the real
 * chart wrapper does and exposes the two gestures as buttons. Two charts
 * both draw a "p95" series, so the recorder writes what it resolved onto
 * the DOM (an id per handler) rather than into a map keyed by name. The
 * hero picker is the real TelemetryTimeRangePicker.
 *
 * jest.mock is hoisted above the imports, so the factories only close over
 * names that start with "mock", and read them when a call happens.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

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
  data: Array<{ seriesName: string }>;
  xAxis: { options: { type: string; min: Date; max: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

type MockZoomContextModule =
  typeof import("../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext");

// Where the stand-in chart's "drag" lands; a test moves it as it needs.
let mockDragWindow: [Date, Date] = [ZOOM_START, ZOOM_END];
// The page's auto-refresh tick, fired by hand.
let mockAutoRefresh: (() => void) | null = null;
// A stable id per handler, so the DOM can say which charts share one.
const mockHandlerIds: Map<unknown, number> = new Map<unknown, number>();

function mockIdOf(handler: unknown): string {
  if (!handler) {
    return "none";
  }
  if (!mockHandlerIds.has(handler)) {
    mockHandlerIds.set(handler, mockHandlerIds.size + 1);
  }
  return String(mockHandlerIds.get(handler));
}

const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const fetchSpanMetricsMock: MockFunction = getJestMockFunction();
const fetchSpanNameStatsMock: MockFunction = getJestMockFunction();
const fetchWebVitalsMock: MockFunction = getJestMockFunction();
const fetchWebVitalByRouteMock: MockFunction = getJestMockFunction();
const fetchSignalsMock: MockFunction = getJestMockFunction();
const fetchSessionReplayListMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
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
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
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
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

/*
 * recharts draws nothing in jsdom. The stand-in takes its zoom the way the
 * real wrapper does and offers the drag and the double-click.
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
      return (
        <div
          data-testid="line-chart"
          data-series={name}
          data-select={mockIdOf(zoom.onTimeRangeSelect)}
          data-reset={mockIdOf(zoom.onTimeRangeReset)}
          data-window={`${props.xAxis.options.min.toISOString()}/${props.xAxis.options.max.toISOString()}`}
        >
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
      fetchSpanNameStats: (...args: Array<unknown>): unknown => {
        return fetchSpanNameStatsMock(...args);
      },
      fetchWebVitals: (...args: Array<unknown>): unknown => {
        return fetchWebVitalsMock(...args);
      },
      fetchWebVitalByRoute: (...args: Array<unknown>): unknown => {
        return fetchWebVitalByRouteMock(...args);
      },
      fetchLogAndExceptionSignals: (...args: Array<unknown>): unknown => {
        return fetchSignalsMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable",
  () => {
    return {
      __esModule: true,
      fetchSessionReplayList: (...args: Array<unknown>): unknown => {
        return fetchSessionReplayListMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          isLoading: false,
          error: null,
          diagnosis: {
            state: "healthy",
            severity: "ok",
            title: "Recording healthy",
            detail: "",
          },
          refresh: async (): Promise<void> => {},
        };
      },
    };
  },
);

// A plain anchor, so the tiles' hrefs can be read without a router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        className?: string;
        children: React.ReactNode;
      }): React.ReactElement => {
        return (
          <a
            href={props.to ? props.to.toString() : ""}
            className={props.className}
          >
            {props.children}
          </a>
        );
      },
    };
  },
);

import RumApplicationOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  LogAndExceptionSignals,
  SpanMetrics,
  SpanNameStats,
  WebVital,
  WebVitalByRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../Types/Rum/WebVitals";

// The six charts, by the series each draws. Two of them draw "p95".
const PAGE_LOADS_CHART: string = "Page loads,Failed";
const EVENTS_CHART: string = "Events,Errors";
const EXCEPTIONS_CHART: string = "Exceptions";
const LOGS_CHART: string = "Log lines,Errors";
const CHART_COUNT: number = 6;

interface FetchScope {
  start: Date;
  end: Date;
  spanName?: string | undefined;
}

interface SessionListScope {
  startTime: Date;
  endTime: Date;
}

const ZOOM_WINDOW: [number, number] = [
  ZOOM_START.getTime(),
  ZOOM_END.getTime(),
];
const INNER_WINDOW: [number, number] = [
  INNER_ZOOM_START.getTime(),
  INNER_ZOOM_END.getTime(),
];

function windowOf(scope: unknown): [number, number] {
  const fetchScope: FetchScope = scope as FetchScope;
  return [fetchScope.start.getTime(), fetchScope.end.getTime()];
}

function isWindow(scope: unknown, window: [number, number]): boolean {
  const [start, end]: [number, number] = windowOf(scope);
  return start === window[0] && end === window[1];
}

/*
 * The span totals tell the windows apart on the Events tile: 45.6k events
 * over the hour, 999 in the ten zoomed minutes, 3.2k in the inner zoom.
 */
function spanMetricsFor(scope: unknown): SpanMetrics {
  const total: number = isWindow(scope, ZOOM_WINDOW)
    ? 999
    : isWindow(scope, INNER_WINDOW)
      ? 3200
      : 45600;
  const pointAt: Date = new Date((scope as FetchScope).start.getTime() + 60000);

  return {
    total: total,
    errors: 9,
    errorRatePercent: (9 / total) * 100,
    p95DurationMs: 120,
    countSeries: [{ x: pointAt, y: total }],
    errorSeries: [{ x: pointAt, y: 9 }],
    p95Series: [{ x: pointAt, y: 120 }],
  };
}

const PAGE_LOAD_STATS: SpanNameStats = {
  count: 1234,
  errorCount: 3,
  avgDurationMs: 1000,
  p50DurationMs: 850,
  p95DurationMs: 2340,
  p99DurationMs: 4100,
};

function signalsFor(scope: unknown): LogAndExceptionSignals {
  const pointAt: Date = new Date((scope as FetchScope).start.getTime() + 60000);

  return {
    logs: {
      total: 300,
      errorCount: 12,
      countSeries: [{ x: pointAt, y: 300 }],
      errorSeries: [{ x: pointAt, y: 12 }],
      failed: false,
    },
    exceptions: {
      total: 17,
      unhandledCount: 5,
      unhandledSeries: [{ x: pointAt, y: 5 }],
      handledSeries: [{ x: pointAt, y: 12 }],
      failed: false,
    },
  };
}

// Every vital reported, INP included, so the per-route card is on the page.
const VITALS: Array<WebVital> = WebVitalDefinitions.map(
  (definition: WebVitalDefinition): WebVital => {
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      value:
        definition.unit === "score" ? 0.05 : definition.thresholds.warn / 2,
      unit: definition.unit,
      thresholds: definition.thresholds,
      metricName:
        definition.key === "inp"
          ? "web_vital.inp"
          : `web_vital.${definition.key}`,
    };
  },
);

const INP_BY_ROUTE: WebVitalByRoute = {
  routeAttribute: "url.path",
  routes: [{ route: "/checkout", value: 260 }],
  totalRoutes: null,
  failed: false,
};

function arrange(): void {
  getItemMock.mockImplementation(async () => {
    return {
      name: "Checkout Web",
      appIdentifier: "checkout-web",
      clientType: "Browser",
      sdkLanguage: "webjs",
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(NOW.getTime() - 60000),
    };
  });
  countMock.mockImplementation(async () => {
    return 4;
  });
  fetchSpanMetricsMock.mockImplementation(async (scope: unknown) => {
    return spanMetricsFor(scope);
  });
  fetchSpanNameStatsMock.mockImplementation(async () => {
    return PAGE_LOAD_STATS;
  });
  fetchSignalsMock.mockImplementation(async (scope: unknown) => {
    return signalsFor(scope);
  });
  fetchWebVitalsMock.mockImplementation(async () => {
    return VITALS;
  });
  fetchWebVitalByRouteMock.mockImplementation(async () => {
    return INP_BY_ROUTE;
  });
  fetchSessionReplayListMock.mockImplementation(async () => {
    return {
      sessions: [{ sessionId: "s-1" }, { sessionId: "s-2" }],
      nextCursor: null,
      ignoredFilters: [],
    };
  });
}

const TELEMETRY_FETCHERS: Array<[string, MockFunction]> = [
  ["span metrics", fetchSpanMetricsMock],
  ["page-load stats", fetchSpanNameStatsMock],
  ["web vitals", fetchWebVitalsMock],
  ["INP by route", fetchWebVitalByRouteMock],
  ["log and exception signals", fetchSignalsMock],
];

function clearFetches(): void {
  for (const [, mock] of TELEMETRY_FETCHERS) {
    mock.mockClear();
  }
  fetchSessionReplayListMock.mockClear();
}

// Every window a fetcher was asked for since it was cleared.
function fetchedWindows(mock: MockFunction): Array<[number, number]> {
  return mock.mock.calls.map((call: Array<unknown>): [number, number] => {
    return windowOf(call[0]);
  });
}

function sessionListWindows(): Array<[number, number]> {
  return fetchSessionReplayListMock.mock.calls.map(
    (call: Array<unknown>): [number, number] => {
      const scope: SessionListScope = call[0] as SessionListScope;
      return [scope.startTime.getTime(), scope.endTime.getTime()];
    },
  );
}

// A relative "past hour" resolved at some point after NOW.
function expectPastHour(window: [number, number]): void {
  expect(window[1] - window[0]).toBe(HOUR_MS);
  expect(window[1]).toBeGreaterThanOrEqual(NOW.getTime());
}

function charts(): Array<HTMLElement> {
  return screen.getAllByTestId("line-chart");
}

function pickerButton(): HTMLElement {
  return screen.getByTestId(
    `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
  );
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function sessionsLink(): HTMLElement {
  return screen.getByRole("link", { name: "View Sessions recorded" });
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(): Promise<void> {
  render(<RumApplicationOverview {...({} as PageComponentProps)} />);
  await screen.findByText("Checkout Web");
  await screen.findByText("45.6k");
  await waitFor(() => {
    expect(charts()).toHaveLength(CHART_COUNT);
  });
  await settle();
}

async function dragAcross(name: string): Promise<void> {
  fireEvent.click(
    screen.getAllByRole("button", { name: `Drag across ${name}` })[0]!,
  );
  await settle();
}

async function doubleClick(name: string): Promise<void> {
  fireEvent.doubleClick(
    screen.getAllByRole("button", { name: `Double-click ${name}` })[0]!,
  );
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockDragWindow = [ZOOM_START, ZOOM_END];
  mockAutoRefresh = null;
  for (const mock of [
    getItemMock,
    countMock,
    fetchSpanMetricsMock,
    fetchSpanNameStatsMock,
    fetchWebVitalsMock,
    fetchWebVitalByRouteMock,
    fetchSignalsMock,
    fetchSessionReplayListMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("RUM overview: one zoom for the whole page", () => {
  test("all six charts take the page's one zoom, with nothing to undo yet", async () => {
    await renderPage();

    const selectIds: Array<string | null> = charts().map(
      (element: HTMLElement): string | null => {
        return element.getAttribute("data-select");
      },
    );
    expect(selectIds).toHaveLength(CHART_COUNT);
    expect(selectIds[0]).not.toBe("none");
    expect(new Set(selectIds).size).toBe(1);

    for (const element of charts()) {
      expect(element).toHaveAttribute("data-reset", "none");
    }
    expect(resetZoomButton()).toBeNull();
    expect(screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveLength(
      CHART_COUNT,
    );
  });

  test("the page starts on the past hour, everywhere", async () => {
    await renderPage();

    for (const [, mock] of TELEMETRY_FETCHERS) {
      expectPastHour(fetchedWindows(mock)[0]!);
    }
    expectPastHour(sessionListWindows()[0]!);
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
    expect(screen.getByText("past 1 hour")).toBeInTheDocument();
  });
});

describe("RUM overview: a drag zooms the page", () => {
  test("a drag on one chart refetches every chart, tile and card for the window dragged out", async () => {
    await renderPage();
    clearFetches();

    await dragAcross(PAGE_LOADS_CHART);

    for (const [label, mock] of TELEMETRY_FETCHERS) {
      expect({ label, calls: mock.mock.calls.length > 0 }).toEqual({
        label,
        calls: true,
      });
      for (const window of fetchedWindows(mock)) {
        expect({ label, window }).toEqual({ label, window: ZOOM_WINDOW });
      }
    }
    // All spans and the page-load spans alone, both for the zoom.
    expect(
      fetchSpanMetricsMock.mock.calls.map((call: Array<unknown>) => {
        return Boolean((call[0] as FetchScope).spanName);
      }),
    ).toEqual(expect.arrayContaining([true, false]));
    expect(sessionListWindows()).toEqual([ZOOM_WINDOW]);

    // The Events tile now counts the ten zoomed minutes.
    expect(await screen.findByText("999")).toBeInTheDocument();
    expect(screen.queryByText("45.6k")).toBeNull();
  });

  test("every chart is redrawn over the zoomed window", async () => {
    await renderPage();

    await dragAcross(EVENTS_CHART);

    await waitFor(() => {
      for (const element of charts()) {
        expect(element).toHaveAttribute(
          "data-window",
          `${ZOOM_START.toISOString()}/${ZOOM_END.toISOString()}`,
        );
      }
    });
  });

  test("the picker reads Custom and offers Reset zoom; every chart can now reset", async () => {
    await renderPage();

    await dragAcross(LOGS_CHART);

    expect(pickerButton()).not.toHaveTextContent("Past 1 Hour");
    expect(resetZoomButton()).toBeVisible();

    const resetIds: Array<string | null> = charts().map(
      (element: HTMLElement): string | null => {
        return element.getAttribute("data-reset");
      },
    );
    expect(resetIds[0]).not.toBe("none");
    expect(new Set(resetIds).size).toBe(1);
  });

  test("the Sessions recorded tile says it counted the custom range, and links to it", async () => {
    await renderPage();

    await dragAcross(EXCEPTIONS_CHART);

    expect(await screen.findByText("custom range")).toBeInTheDocument();
    const href: string = sessionsLink().getAttribute("href") || "";
    expect(href).toContain(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/session-replay?`,
    );
    expect(href).toContain("range=Custom");
    expect(href).toContain(
      `start=${encodeURIComponent(ZOOM_START.toISOString())}`,
    );
    expect(href).toContain(`end=${encodeURIComponent(ZOOM_END.toISOString())}`);
  });

  test("a drag that runs past now is cut at the end of the page's window", async () => {
    await renderPage();
    // waitFor ticks the fake clock; put "now" back where the test reads it.
    jest.setSystemTime(NOW);
    clearFetches();
    mockDragWindow = [
      new Date("2026-09-28T11:55:00.000Z"),
      new Date("2026-09-28T12:05:00.000Z"),
    ];

    await dragAcross(PAGE_LOADS_CHART);

    // All spans and the page-load spans, both cut at now.
    expect(fetchedWindows(fetchSpanMetricsMock)).toEqual([
      [new Date("2026-09-28T11:55:00.000Z").getTime(), NOW.getTime()],
      [new Date("2026-09-28T11:55:00.000Z").getTime(), NOW.getTime()],
    ]);
  });
});

describe("RUM overview: back out of a zoom", () => {
  test("a double-click on a DIFFERENT chart restores the past hour everywhere", async () => {
    await renderPage();
    await dragAcross(PAGE_LOADS_CHART);
    await screen.findByText("999");
    clearFetches();

    await doubleClick(LOGS_CHART);

    for (const [, mock] of TELEMETRY_FETCHERS) {
      expect(fetchedWindows(mock).length).toBeGreaterThan(0);
      for (const window of fetchedWindows(mock)) {
        expectPastHour(window);
      }
    }
    expectPastHour(sessionListWindows()[0]!);
    expect(await screen.findByText("45.6k")).toBeInTheDocument();
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
    expect(resetZoomButton()).toBeNull();
    expect(screen.getByText("past 1 hour")).toBeInTheDocument();
    expect(sessionsLink().getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/session-replay?range=Past%201%20Hour`,
    );
    for (const element of charts()) {
      expect(element).toHaveAttribute("data-reset", "none");
    }
  });

  test("Reset zoom beside the picker does what a double-click does", async () => {
    await renderPage();
    await dragAcross(EVENTS_CHART);
    clearFetches();

    fireEvent.click(resetZoomButton()!);
    await settle();

    expectPastHour(fetchedWindows(fetchSpanMetricsMock)[0]!);
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
    expect(resetZoomButton()).toBeNull();
  });

  test("after a zoom inside a zoom, one double-click returns to the past hour", async () => {
    await renderPage();
    await dragAcross(PAGE_LOADS_CHART);

    mockDragWindow = [INNER_ZOOM_START, INNER_ZOOM_END];
    clearFetches();
    await dragAcross(EVENTS_CHART);

    // All spans and the page-load spans, both for the inner window.
    expect(fetchedWindows(fetchSpanMetricsMock)).toEqual([
      INNER_WINDOW,
      INNER_WINDOW,
    ]);
    expect(await screen.findByText("3.2k")).toBeInTheDocument();

    clearFetches();
    await doubleClick(EXCEPTIONS_CHART);

    expectPastHour(fetchedWindows(fetchSpanMetricsMock)[0]!);
    expect(await screen.findByText("45.6k")).toBeInTheDocument();
    expect(resetZoomButton()).toBeNull();
  });

  test("a double-click with nothing zoomed refetches nothing", async () => {
    await renderPage();
    clearFetches();

    await doubleClick(PAGE_LOADS_CHART);

    for (const [, mock] of TELEMETRY_FETCHERS) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe("RUM overview: the zoom and the rest of the page", () => {
  test("picking a range in the picker ends the zoom", async () => {
    await renderPage();
    await dragAcross(PAGE_LOADS_CHART);
    clearFetches();

    fireEvent.click(pickerButton());
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Day" }));
    await settle();

    const [start, end]: [number, number] =
      fetchedWindows(fetchSpanMetricsMock)[0]!;
    expect(end - start).toBe(DAY_MS);
    expect(resetZoomButton()).toBeNull();
    for (const element of charts()) {
      expect(element).toHaveAttribute("data-reset", "none");
    }
  });

  test("a refresh keeps the zoom: the same window is fetched again, and Reset zoom stays", async () => {
    await renderPage();
    await dragAcross(PAGE_LOADS_CHART);
    await screen.findByText("999");
    clearFetches();

    await act(async () => {
      mockAutoRefresh!();
    });
    await settle();

    for (const [, mock] of TELEMETRY_FETCHERS) {
      expect(fetchedWindows(mock).length).toBeGreaterThan(0);
      for (const window of fetchedWindows(mock)) {
        expect(window).toEqual(ZOOM_WINDOW);
      }
    }
    expect(sessionListWindows()).toEqual([ZOOM_WINDOW]);
    expect(resetZoomButton()).toBeVisible();
    expect(screen.getByText("999")).toBeInTheDocument();
  });

  test("the manual refresh button keeps the zoom too", async () => {
    await renderPage();
    await dragAcross(EVENTS_CHART);
    clearFetches();

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await settle();

    expect(fetchedWindows(fetchSpanMetricsMock).length).toBeGreaterThan(0);
    for (const window of fetchedWindows(fetchSpanMetricsMock)) {
      expect(window).toEqual(ZOOM_WINDOW);
    }
    expect(resetZoomButton()).toBeVisible();
  });
});
