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
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The RUM application overview (Pages/Rum/View/Overview.tsx), rendered for
 * real: every tile, every chart card and the web-vitals card, with only the
 * network, the router and the chart canvas replaced.
 *
 * What is pinned here is what a customer actually reads - the value and the
 * small line under it for each of the eight tiles, in the normal case and in
 * each way a lookup can come back empty or fail - and that every tile and
 * chart title carries an (i) whose tooltip is the matching entry of
 * RUM_METRIC_DESCRIPTIONS. The pure wording decisions are unit-tested in
 * App/Tests/Dashboard/RumOverviewMetrics.test.ts; this suite proves the page
 * wires them to the right data.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
// The newest exception, and the setup dialog's key picker.
const getListMock: MockFunction = getJestMockFunction();
// The newest Web Vital of the past 30 days, read while the range has none.
const analyticsGetListMock: MockFunction = getJestMockFunction();
const fetchSpanMetricsMock: MockFunction = getJestMockFunction();
const fetchSpanNameStatsMock: MockFunction = getJestMockFunction();
const fetchWebVitalsMock: MockFunction = getJestMockFunction();
const fetchWebVitalByRouteMock: MockFunction = getJestMockFunction();
const fetchSignalsMock: MockFunction = getJestMockFunction();
const fetchSessionReplayListMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();
// A mobile app's reads (#9588): MobileRumSignalReads.
const fetchMobileAppStartsMock: MockFunction = getJestMockFunction();
const fetchMobileSessionsMock: MockFunction = getJestMockFunction();
const fetchMobileFaultsMock: MockFunction = getJestMockFunction();
const fetchMobileFramesMock: MockFunction = getJestMockFunction();
const fetchNewestAppStartAtMock: MockFunction = getJestMockFunction();
const fetchNewestFrameEventAtMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * declarations, so the mock functions are only read when a call happens.
 */
// A test may give some English its German; the rest stays English.
const TRANSLATIONS: Record<string, string> = {};

// The Details card's row whose label reads `label`.
function detailRowLabelled(label: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("resource-overview-detail-row")
    .find((candidate: HTMLElement): boolean => {
      return candidate.querySelector("dt")?.textContent === label;
    });
  expect(row).toBeDefined();
  return row!;
}

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return TRANSLATIONS[key] ?? opts?.defaultValue ?? key;
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
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
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
 * recharts measures a 0x0 parent in jsdom and draws nothing, so each chart
 * card is checked by the series it hands the chart.
 */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: { data: Array<{ seriesName: string }> }) => {
      lineChartMock(props);
      return (
        <div data-testid="line-chart">
          {props.data
            .map((s: { seriesName: string }) => {
              return s.seriesName;
            })
            .join(",")}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: { onChange: (value: unknown) => void }) => {
        return (
          <button
            type="button"
            onClick={() => {
              props.onChange({ range: "Past 1 Day" });
            }}
          >
            Pick past day
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onManualRefresh: () => void;
        timeRangePicker?: React.ReactNode;
      }) => {
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

// No interval timer: refreshes happen only when a test asks for one.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: () => {},
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalReads",
  () => {
    return {
      __esModule: true,
      fetchMobileAppStarts: (...args: Array<unknown>): unknown => {
        return fetchMobileAppStartsMock(...args);
      },
      fetchMobileSessions: (...args: Array<unknown>): unknown => {
        return fetchMobileSessionsMock(...args);
      },
      fetchMobileFaults: (...args: Array<unknown>): unknown => {
        return fetchMobileFaultsMock(...args);
      },
      fetchMobileFrames: (...args: Array<unknown>): unknown => {
        return fetchMobileFramesMock(...args);
      },
      fetchNewestAppStartAt: (...args: Array<unknown>): unknown => {
        return fetchNewestAppStartAtMock(...args);
      },
      fetchNewestFrameEventAt: (...args: Array<unknown>): unknown => {
        return fetchNewestFrameEventAtMock(...args);
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
          refresh: async () => {},
        };
      },
    };
  },
);

// The setup dialogs' code, as plain text (SetupGuideCard.test.tsx).
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return <div data-testid="setup-guide-markdown">{props.text}</div>;
    },
  };
});

// A plain anchor, so hrefs can be read and nesting checked without a router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        className?: string;
        children: React.ReactNode;
      }) => {
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
import {
  RUM_METRIC_DESCRIPTIONS,
  RumMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";
import {
  SpanMetrics,
  SpanNameStats,
  LogAndExceptionSignals,
  WebVital,
  WebVitalByRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  MobileAppStarts,
  MobileFaults,
  MobileFrames,
  MobileSessions,
  emptyAppStarts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalData";
import { RUM_ANDROID_SETUP_DOCS_URL } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import OneUptimeDate from "../../../Types/Date";
import { withDurationWordsHeld } from "../../../Types/NoBreakSpaces";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../Types/Rum/WebVitals";
import ObjectID from "../../../Types/ObjectID";

interface TimePoint {
  x: Date;
  y: number;
}

const T0: Date = new Date("2026-09-24T10:00:00.000Z");
const T1: Date = new Date("2026-09-24T10:05:00.000Z");
const T2: Date = new Date("2026-09-24T10:10:00.000Z");

function points(...values: Array<[Date, number]>): Array<TimePoint> {
  return values.map(([x, y]: [Date, number]): TimePoint => {
    return { x, y };
  });
}

const APP: Record<string, unknown> = {
  name: "Checkout Web",
  appIdentifier: "checkout-web",
  clientType: "Browser",
  sdkLanguage: "webjs",
  agentVersion: "1.30.0",
  otelCollectorStatus: "connected",
  lastSeenAt: new Date(),
};

const ALL_SPANS: SpanMetrics = {
  total: 45600,
  errors: 912,
  errorRatePercent: 2,
  p95DurationMs: 123.4,
  countSeries: points([T0, 20000], [T1, 25600]),
  errorSeries: points([T0, 400], [T1, 512]),
  p95Series: points([T0, 110], [T1, 136.8]),
};

const PAGE_LOAD_SERIES: SpanMetrics = {
  total: 1234,
  errors: 3,
  errorRatePercent: (3 / 1234) * 100,
  p95DurationMs: 2300,
  countSeries: points([T0, 600], [T1, 634]),
  errorSeries: points([T1, 3]),
  p95Series: points([T0, 2200], [T1, 2400]),
};

const PAGE_LOAD_STATS: SpanNameStats = {
  count: 1234,
  errorCount: 3,
  avgDurationMs: 1000,
  p50DurationMs: 850,
  p95DurationMs: 2340,
  p99DurationMs: 4100,
};

const SIGNALS: LogAndExceptionSignals = {
  logs: {
    total: 300,
    errorCount: 12,
    countSeries: points([T0, 100], [T1, 200]),
    errorSeries: points([T1, 12]),
    failed: false,
  },
  exceptions: {
    total: 17,
    unhandledCount: 5,
    unhandledSeries: points([T0, 2], [T2, 3]),
    handledSeries: points([T0, 4], [T1, 8]),
    failed: false,
  },
};

const VITALS: Array<WebVital> = WebVitalDefinitions.map(
  (d: WebVitalDefinition): WebVital => {
    return {
      key: d.key,
      label: d.label,
      description: d.description,
      value: d.unit === "score" ? 0.05 : d.thresholds.warn / 2,
      unit: d.unit,
      thresholds: d.thresholds,
      metricName: null,
    };
  },
);

/* INP as instrumentation that emits web_vital.inp reports it. */
const VITALS_WITH_INP: Array<WebVital> = VITALS.map((v: WebVital): WebVital => {
  return v.key === "inp"
    ? { ...v, value: 260, metricName: "web_vital.inp" }
    : v;
});

const NO_ROUTES: WebVitalByRoute = {
  routeAttribute: null,
  routes: [],
  totalRoutes: null,
  failed: false,
};

function sessions(count: number): Array<{ sessionId: string }> {
  return Array.from({ length: count }, (_: unknown, i: number) => {
    return { sessionId: `s-${i}` };
  });
}

const TILE_TITLES: Array<[string, RumMetric]> = [
  ["Page loads", "pageLoads"],
  ["Page load time (p95)", "pageLoadTime"],
  ["Events", "events"],
  ["Error rate", "errorRate"],
  ["Event duration (p95)", "eventDuration"],
  ["Exceptions", "exceptions"],
  ["Clients", "clients"],
  ["Sessions recorded", "sessionsRecorded"],
];

const CHART_TITLES: Array<[string, RumMetric]> = [
  ["Page loads", "pageLoadsChart"],
  ["Page load time (p95)", "pageLoadTimeChart"],
  ["Events", "eventsChart"],
  ["Event duration (p95)", "eventDurationChart"],
  ["Exceptions", "exceptionsChart"],
  ["Logs", "logsChart"],
];

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/*
 * A rejection created while arranging is only handled once the page asks
 * for it; marking it handled up front keeps Node from reporting it first.
 */
function rejected<T>(message: string): Promise<T> {
  const promise: Promise<T> = Promise.reject(new Error(message));
  promise.catch(() => {});
  return promise;
}

interface Scenario {
  app?: Record<string, unknown> | undefined;
  clientCount?: Promise<number> | undefined;
  allSpans?: Promise<SpanMetrics> | undefined;
  pageLoadSeries?: Promise<SpanMetrics> | undefined;
  pageLoadStats?: Promise<SpanNameStats> | undefined;
  signals?: Promise<LogAndExceptionSignals> | undefined;
  vitals?: Promise<Array<WebVital>> | undefined;
  inpByRoute?: Promise<WebVitalByRoute> | undefined;
  sessionList?: Promise<unknown> | undefined;
  /*
   * The page Session Replay's errors filter answers (issue #6379). Left
   * out, the sessions of sessionList that have an error, on one page.
   */
  sessionsWithErrors?: Promise<unknown> | undefined;
  /*
   * When the newest exception arrived (null: never), read only when the
   * range has none. Two years ago by default: an app that reports them.
   */
  newestException?: Promise<Date | null> | undefined;
  // What the project's keys were refused in the past day (issue #6378).
  refusals?: Array<Record<string, unknown>> | undefined;
  /*
   * When the newest Web Vital of the past 30 days arrived (null: none), read
   * only when the range has none (issue #6379).
   */
  newestWebVital?: Promise<Date | null> | undefined;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function arrange(scenario: Scenario = {}): void {
  getItemMock.mockImplementation(async () => {
    return scenario.app ?? APP;
  });
  countMock.mockImplementation(() => {
    return scenario.clientCount ?? Promise.resolve(4);
  });
  fetchSpanMetricsMock.mockImplementation((scope: unknown) => {
    if ((scope as { spanName?: string }).spanName) {
      return scenario.pageLoadSeries ?? Promise.resolve(PAGE_LOAD_SERIES);
    }
    return scenario.allSpans ?? Promise.resolve(ALL_SPANS);
  });
  fetchSpanNameStatsMock.mockImplementation(() => {
    return scenario.pageLoadStats ?? Promise.resolve(PAGE_LOAD_STATS);
  });
  fetchSignalsMock.mockImplementation(() => {
    return scenario.signals ?? Promise.resolve(SIGNALS);
  });
  fetchWebVitalsMock.mockImplementation(() => {
    return scenario.vitals ?? Promise.resolve(VITALS);
  });
  fetchWebVitalByRouteMock.mockImplementation(() => {
    return scenario.inpByRoute ?? Promise.resolve(NO_ROUTES);
  });
  fetchSessionReplayListMock.mockImplementation((request: unknown) => {
    const list: Promise<unknown> =
      scenario.sessionList ??
      Promise.resolve({
        sessions: sessions(50),
        nextCursor: { id: "next" },
        ignoredFilters: [],
      });

    if ((request as { signal?: string }).signal !== "errors") {
      return list;
    }

    // Session Replay's own errors filter, as the server applies it.
    return (
      scenario.sessionsWithErrors ??
      list.then((result: unknown) => {
        const page: {
          sessions: Array<{ errorCount?: number; hasError?: boolean }>;
        } = result as {
          sessions: Array<{ errorCount?: number; hasError?: boolean }>;
        };

        return {
          sessions: page.sessions.filter(
            (session: { errorCount?: number; hasError?: boolean }): boolean => {
              return (session.errorCount || 0) > 0 || Boolean(session.hasError);
            },
          ),
          nextCursor: null,
          ignoredFilters: [],
        };
      })
    );
  });
  analyticsGetListMock.mockImplementation(async () => {
    const at: Date | null = await (scenario.newestWebVital ??
      Promise.resolve(null));

    return {
      data: at ? [{ time: at }] : [],
      count: at ? 1 : 0,
      skip: 0,
      limit: 1,
    };
  });
  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: unknown = (args as { modelType?: unknown }).modelType;

    if (modelType === TelemetryIngestionKeyRefusal) {
      const rows: Array<Record<string, unknown>> = scenario.refusals ?? [];
      return { data: rows, count: rows.length, skip: 0, limit: 100 };
    }

    if (modelType !== TelemetryException) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    const at: Date | null = await (scenario.newestException ??
      Promise.resolve(ago(730 * DAY_MS)));

    return {
      data: at ? [{ lastSeenAt: at }] : [],
      count: at ? 1 : 0,
      skip: 0,
      limit: 1,
    };
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(): Promise<void> {
  render(<RumApplicationOverview {...({} as PageComponentProps)} />);
  await screen.findByText("Checkout Web");
  await flush();
}

/*
 * A tile's root carries aria-busy; a chart card's does not. Both put the
 * (i) beside the title, named "About <title>".
 */
function infoButtons(title: string): Array<HTMLElement> {
  return screen.getAllByRole("button", { name: `About ${title}` });
}

function tileInfo(title: string): HTMLElement {
  const found: Array<HTMLElement> = infoButtons(title).filter(
    (b: HTMLElement): boolean => {
      return b.closest("[aria-busy]") !== null;
    },
  );
  expect(found).toHaveLength(1);
  return found[0]!;
}

function chartInfo(title: string): HTMLElement {
  const found: Array<HTMLElement> = infoButtons(title).filter(
    (b: HTMLElement): boolean => {
      return b.closest("[aria-busy]") === null;
    },
  );
  expect(found).toHaveLength(1);
  return found[0]!;
}

function tile(title: string): HTMLElement {
  return tileInfo(title).closest("[aria-busy]") as HTMLElement;
}

function expectTile(title: string, value: string, sublabel: string): void {
  const root: HTMLElement = tile(title);

  expect(root).toHaveAttribute("aria-busy", "false");
  expect(within(root).getByText(value)).toBeInTheDocument();
  expect(within(root).getByText(sublabel)).toBeInTheDocument();
}

async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const text: string =
    document.getElementById(describedBy as string)?.textContent || "";

  fireEvent.mouseLeave(button);

  return text;
}

type ChartProps = {
  data: Array<{ seriesName: string; data: Array<TimePoint> }>;
};

function chartWithSeries(names: Array<string>): ChartProps {
  const calls: Array<ChartProps> = lineChartMock.mock.calls.map(
    (call: Array<unknown>): ChartProps => {
      return call[0] as ChartProps;
    },
  );
  const matching: Array<ChartProps> = calls.filter(
    (props: ChartProps): boolean => {
      return (
        JSON.stringify(
          props.data.map((s: { seriesName: string }) => {
            return s.seriesName;
          }),
        ) === JSON.stringify(names)
      );
    },
  );
  expect(matching.length).toBeGreaterThan(0);
  return matching[matching.length - 1]!;
}

beforeEach(() => {
  jest.useFakeTimers();
  for (const mock of [
    getItemMock,
    countMock,
    getListMock,
    analyticsGetListMock,
    fetchSpanMetricsMock,
    fetchSpanNameStatsMock,
    fetchWebVitalsMock,
    fetchWebVitalByRouteMock,
    fetchSignalsMock,
    fetchSessionReplayListMock,
    lineChartMock,
    fetchMobileAppStartsMock,
    fetchMobileSessionsMock,
    fetchMobileFaultsMock,
    fetchMobileFramesMock,
    fetchNewestAppStartAtMock,
    fetchNewestFrameEventAtMock,
  ]) {
    mock.mockReset();
  }
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("RUM overview: normal data", () => {
  test("every tile shows the value and the line under it that its data supports", async () => {
    arrange();
    await renderPage();

    expectTile("Page loads", "1.2k", "3 failed");
    expectTile("Page load time (p95)", "2.34 s", "median 850 ms");
    expectTile("Events", "45.6k", "spans, selected range");
    expectTile("Error rate", "2.0%", "912 errored");
    expectTile(
      "Event duration (p95)",
      "123 ms",
      "page loads, requests, clicks",
    );
    expectTile("Exceptions", "17", "reported by your app");
    expectTile("Clients", "4", "platforms seen");
    expectTile("Sessions recorded", "50+", "Past 1 Hour");
  });

  test("the tiles are in the order a reader scans them, page loads first", async () => {
    arrange();
    await renderPage();

    const titles: Array<string> = Array.from(
      document.querySelectorAll("[aria-busy]"),
    ).map((root: Element): string => {
      return root.querySelector("span.uppercase")?.textContent || "";
    });

    expect(titles).toEqual(
      TILE_TITLES.map(([title]: [string, RumMetric]) => {
        return title;
      }),
    );
  });

  test("'Page views' is gone - the tile that counted every span is called Events", async () => {
    arrange();
    await renderPage();

    expect(screen.queryByText(/page views/i)).not.toBeInTheDocument();
  });

  test("a page load count without failures says 'full page loads'", async () => {
    arrange({
      pageLoadStats: Promise.resolve({ ...PAGE_LOAD_STATS, errorCount: 0 }),
    });
    await renderPage();

    expectTile("Page loads", "1.2k", "full page loads");
  });

  test("fewer than 50 recorded sessions show the exact count, without a '+'", async () => {
    arrange({
      sessionList: Promise.resolve({
        sessions: sessions(7),
        nextCursor: null,
        ignoredFilters: [],
      }),
    });
    await renderPage();

    expectTile("Sessions recorded", "7", "Past 1 Hour");
  });

  test("the error-rate bar is coloured by its 1% / 5% thresholds", async () => {
    arrange();
    await renderPage();

    const bar: HTMLElement | null = tile("Error rate").querySelector(
      "[style]",
    ) as HTMLElement | null;

    expect(bar).not.toBeNull();
    // 2% is past the 1% warning line and short of the 5% danger line.
    expect(bar).toHaveClass("bg-amber-500");
    expect(bar!.style.width).toBe("2%");
  });

  test("page loads are fetched as documentLoad spans of this application, for the same window", async () => {
    arrange();
    await renderPage();

    expect(fetchSpanNameStatsMock).toHaveBeenCalledTimes(1);
    const statsScope: {
      primaryEntityId: ObjectID;
      spanName: string;
      start: Date;
      end: Date;
    } = fetchSpanNameStatsMock.mock.calls[0]![0];

    expect(statsScope.spanName).toBe("documentLoad");
    expect(statsScope.primaryEntityId.toString()).toBe(MODEL_ID);

    const spanScopes: Array<{
      primaryEntityId: ObjectID;
      spanName?: string;
      start: Date;
      end: Date;
    }> = fetchSpanMetricsMock.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        primaryEntityId: ObjectID;
        spanName?: string;
        start: Date;
        end: Date;
      };
    });

    expect(spanScopes).toHaveLength(2);
    expect(
      spanScopes
        .map((s: { spanName?: string }) => {
          return s.spanName ?? "(all spans)";
        })
        .sort(),
    ).toEqual(["(all spans)", "documentLoad"]);

    for (const scope of spanScopes) {
      expect(scope.primaryEntityId.toString()).toBe(MODEL_ID);
      expect(scope.start.getTime()).toBe(statsScope.start.getTime());
      expect(scope.end.getTime()).toBe(statsScope.end.getTime());
    }

    const signalsScope: { primaryEntityId: ObjectID; start: Date } =
      fetchSignalsMock.mock.calls[0]![0];
    expect(signalsScope.primaryEntityId.toString()).toBe(MODEL_ID);
    expect(signalsScope.start.getTime()).toBe(statsScope.start.getTime());
  });

  test("each chart is handed the series its title promises", async () => {
    arrange();
    await renderPage();

    expect(
      chartWithSeries(["Page loads", "Failed"]).data.map(
        (s: { data: Array<TimePoint> }) => {
          return s.data;
        },
      ),
    ).toEqual([PAGE_LOAD_SERIES.countSeries, PAGE_LOAD_SERIES.errorSeries]);

    expect(chartWithSeries(["Events", "Errors"]).data[0]!.data).toEqual(
      ALL_SPANS.countSeries,
    );

    const p95Charts: Array<ChartProps> = lineChartMock.mock.calls
      .map((call: Array<unknown>): ChartProps => {
        return call[0] as ChartProps;
      })
      .filter((props: ChartProps): boolean => {
        return props.data.length === 1 && props.data[0]!.seriesName === "p95";
      });
    const p95Data: Array<Array<TimePoint>> = p95Charts.map(
      (props: ChartProps) => {
        return props.data[0]!.data;
      },
    );
    expect(p95Data).toContainEqual(PAGE_LOAD_SERIES.p95Series);
    expect(p95Data).toContainEqual(ALL_SPANS.p95Series);

    // Handled and unhandled are drawn as one line, summed per timestamp.
    expect(chartWithSeries(["Exceptions"]).data[0]!.data).toEqual(
      points([T0, 6], [T1, 8], [T2, 3]),
    );

    expect(
      chartWithSeries(["Log lines", "Errors"]).data.map(
        (s: { data: Array<TimePoint> }) => {
          return s.data;
        },
      ),
    ).toEqual([SIGNALS.logs.countSeries, SIGNALS.logs.errorSeries]);
  });

  /*
   * #5307's follow-up: the row says its state in a few words of the
   * product's own ("Healthy"), not the diagnosis's English title, and its
   * label is Title Case as every Details row's is.
   */
  test("the recording-health line still sits in the details", async () => {
    arrange();
    await renderPage();

    const row: HTMLElement = detailRowLabelled("Recording Health");
    expect(within(row).getByText("Healthy")).toBeInTheDocument();
    expect(screen.queryByText("Recording health")).toBeNull();
    expect(screen.queryByText("Recording healthy")).toBeNull();
  });

  test("in German the row's label and its words read in German", async () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const label: string = german["Recording Health"]!;
    const words: string = german["Healthy"]!;
    expect(label).toBeTruthy();
    expect(label).not.toBe("Recording Health");
    expect(words).toBeTruthy();
    expect(words).not.toBe("Healthy");
    TRANSLATIONS["Recording Health"] = label;
    TRANSLATIONS["Healthy"] = words;

    try {
      arrange();
      await renderPage();

      const row: HTMLElement = detailRowLabelled(label);
      expect(within(row).getByText(words)).toBeInTheDocument();
      expect(screen.queryByText("Recording Health")).toBeNull();
    } finally {
      delete TRANSLATIONS["Recording Health"];
      delete TRANSLATIONS["Healthy"];
    }
  });
});

describe("RUM overview: every tile and chart explains itself", () => {
  test("eight tiles and six charts each carry exactly one (i)", async () => {
    arrange();
    await renderPage();

    for (const [title] of TILE_TITLES) {
      tileInfo(title);
    }
    for (const [title] of CHART_TITLES) {
      chartInfo(title);
    }

    const tileRoots: Array<Element> = Array.from(
      document.querySelectorAll("[aria-busy]"),
    );
    expect(tileRoots).toHaveLength(8);
    for (const root of tileRoots) {
      expect(
        within(root as HTMLElement).getAllByRole("button", { name: /^About / }),
      ).toHaveLength(1);
    }
  });

  test.each(TILE_TITLES)(
    "the %s tile's tooltip is RUM_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: RumMetric) => {
      arrange();
      await renderPage();

      expect(await tooltipTextOf(tileInfo(title))).toBe(
        RUM_METRIC_DESCRIPTIONS[key],
      );
    },
  );

  test.each(CHART_TITLES)(
    "the %s chart's tooltip is RUM_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: RumMetric) => {
      arrange();
      await renderPage();

      expect(await tooltipTextOf(chartInfo(title))).toBe(
        RUM_METRIC_DESCRIPTIONS[key],
      );
    },
  );

  test("the Core Web Vitals card explains itself, and each vital explains itself and its limits", async () => {
    arrange();
    await renderPage();

    expect(
      await tooltipTextOf(
        screen.getByRole("button", { name: "About Core Web Vitals" }),
      ),
    ).toBe(RUM_METRIC_DESCRIPTIONS.webVitals);

    const lcp: HTMLElement = screen.getByRole("button", {
      name: "About LCP (Largest Contentful Paint)",
    });
    const text: string = await tooltipTextOf(lcp);

    expect(text).toContain(WebVitalDefinitions[0]!.description);
    expect(text).toContain("Good below 2.5\u00A0s; poor at 4\u00A0s or more.");

    for (const d of WebVitalDefinitions) {
      expect(
        screen.getByRole("button", {
          name: `About ${d.key.toUpperCase()} (${d.label})`,
        }),
      ).toBeInTheDocument();
    }
  });

  test("tiles still loading already carry their (i)", async () => {
    arrange({
      allSpans: never<SpanMetrics>(),
      pageLoadSeries: never<SpanMetrics>(),
      pageLoadStats: never<SpanNameStats>(),
      signals: never<LogAndExceptionSignals>(),
      clientCount: never<number>(),
      sessionList: never<unknown>(),
      vitals: never<Array<WebVital>>(),
    });
    await renderPage();

    for (const [title] of TILE_TITLES) {
      expect(tile(title)).toHaveAttribute("aria-busy", "true");
      expect(
        within(tile(title)).getByText(`Loading ${title}`),
      ).toBeInTheDocument();
    }
    for (const [title] of CHART_TITLES) {
      chartInfo(title);
    }
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });
});

describe("RUM overview: linked tiles", () => {
  test("Clients links to the clients list through an overlay, and its (i) is not inside the link", async () => {
    arrange();
    await renderPage();

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Clients",
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/clients`,
    );
    expect(link).toHaveClass("absolute", "inset-0");
    expect(tile("Clients")).toContainElement(link);

    const info: HTMLElement = tileInfo("Clients");
    expect(info.closest("a")).toBeNull();
    expect(link).not.toContainElement(info);
    expect(info).toHaveClass("relative", "z-10");
  });

  test("Sessions recorded links to Session Replay with the counted range, and its (i) is not inside the link", async () => {
    arrange();
    await renderPage();

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Sessions recorded",
    });

    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/session-replay?range=Past%201%20Hour`,
    );
    expect(tileInfo("Sessions recorded").closest("a")).toBeNull();
  });

  test("no (i) anywhere on the page is nested in a link or another button", async () => {
    arrange();
    await renderPage();

    const infos: Array<HTMLElement> = screen.getAllByRole("button", {
      name: /^About /,
    });

    // 8 tiles + 6 charts + the web-vitals card + 5 vitals.
    expect(infos).toHaveLength(20);
    for (const info of infos) {
      expect(info.closest("a")).toBeNull();
      expect(info.parentElement?.closest("button")).toBeNull();
    }
  });

  test("only Page loads, Error rate, Clients and Sessions recorded are links", async () => {
    arrange();
    await renderPage();

    const tileLinks: Array<string> = Array.from(
      document.querySelectorAll("[aria-busy] a"),
    ).map((a: Element): string => {
      return a.textContent || "";
    });

    expect(tileLinks).toEqual([
      "View Page loads",
      "View Error rate",
      "View Clients",
      "View Sessions recorded",
    ]);
  });

  // A tile's link, read as the traces explorer reads its address.
  function linkOf(name: string): { route: string; params: URLSearchParams } {
    const href: string =
      screen.getByRole("link", { name: name }).getAttribute("href") || "";
    const [route, query] = href.split("?") as [string, string];

    return { route: route, params: new URLSearchParams(query) };
  }

  /*
   * "3 failed" under Page loads opens those page loads (#9593): the
   * application's documentLoad spans that failed, over the counted range.
   */
  test("Page loads opens its failed page loads while its line counts some", async () => {
    arrange();
    await renderPage();

    expectTile("Page loads", "1.2k", "3 failed");

    const link: { route: string; params: URLSearchParams } =
      linkOf("View Page loads");

    expect(link.route).toBe(`/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/traces`);
    expect(JSON.parse(link.params.get("filters") || "[]")).toEqual([
      ["statusCode", "2"],
      ["name", "documentLoad"],
    ]);
    expect(link.params.get("range")).toBe("Past 1 Hour");
    expect(link.params.get("spanType")).toBe("all");
    expect(tileInfo("Page loads").closest("a")).toBeNull();
  });

  test("Page loads opens every page load when none failed, and nothing when there are none", async () => {
    arrange({
      pageLoadStats: Promise.resolve({ ...PAGE_LOAD_STATS, errorCount: 0 }),
    });
    await renderPage();

    expect(
      JSON.parse(linkOf("View Page loads").params.get("filters") || "[]"),
    ).toEqual([["name", "documentLoad"]]);

    cleanup();
    arrange({
      pageLoadStats: Promise.resolve({ ...PAGE_LOAD_STATS, count: 0 }),
    });
    await renderPage();

    expect(
      screen.queryByRole("link", { name: "View Page loads" }),
    ).not.toBeInTheDocument();
  });

  /*
   * An error rate opens the events that failed (#9593): the application's
   * traces, on its failed spans of every kind - page loads, requests,
   * clicks - over the range the tile counted.
   */
  test("Error rate links to the failed spans over the counted range, and its (i) is not inside the link", async () => {
    arrange();
    await renderPage();

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Error rate",
    });
    const href: string = link.getAttribute("href") || "";
    const [route, query] = href.split("?") as [string, string];
    const params: URLSearchParams = new URLSearchParams(query);

    expect(route).toBe(`/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/traces`);
    expect(JSON.parse(params.get("filters") || "[]")).toEqual([
      ["statusCode", "2"],
    ]);
    expect(params.get("range")).toBe("Past 1 Hour");
    expect(params.get("spanType")).toBe("all");
    expect(tileInfo("Error rate").closest("a")).toBeNull();
  });

  test("Error rate opens nothing while its figure could not be read", async () => {
    arrange({
      allSpans: Promise.resolve({
        total: 0,
        errors: 0,
        errorRatePercent: null,
        p95DurationMs: null,
        countSeries: [],
        errorSeries: [],
        p95Series: [],
        failed: true,
      }),
    });
    await renderPage();

    expect(
      screen.queryByRole("link", { name: "View Error rate" }),
    ).not.toBeInTheDocument();
  });
});

describe("RUM overview: empty and failed lookups", () => {
  test("an app with events but no documentLoad spans names the missing span", async () => {
    arrange({
      pageLoadStats: Promise.resolve({
        count: 0,
        errorCount: 0,
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
      }),
      pageLoadSeries: Promise.resolve({
        ...PAGE_LOAD_SERIES,
        total: 0,
        errors: 0,
        countSeries: [],
        errorSeries: [],
        p95Series: [],
      }),
    });
    await renderPage();

    expectTile("Page loads", "0", "no documentLoad spans");
    expectTile("Page load time (p95)", "—", "no page loads");
    // The other tiles are unaffected.
    expectTile("Events", "45.6k", "spans, selected range");
  });

  test("an app with no events at all shows 0 page loads without blaming a missing span", async () => {
    arrange({
      allSpans: Promise.resolve({
        total: 0,
        errors: 0,
        errorRatePercent: null,
        p95DurationMs: null,
        countSeries: [],
        errorSeries: [],
        p95Series: [],
      }),
      pageLoadStats: Promise.resolve({
        ...PAGE_LOAD_STATS,
        count: 0,
        errorCount: 0,
      }),
    });
    await renderPage();

    expectTile("Page loads", "0", "full page loads");
    expectTile("Page load time (p95)", "—", "no page loads");
    expectTile("Events", "0", "spans, selected range");
    expect(within(tile("Error rate")).getByText("—")).toBeInTheDocument();
    expect(
      within(tile("Event duration (p95)")).getByText("—"),
    ).toBeInTheDocument();
  });

  test("a failed page-load stats request says 'could not load' on both page-load tiles", async () => {
    arrange({ pageLoadStats: rejected("403") });
    await renderPage();

    expectTile("Page loads", "—", "could not load");
    expectTile("Page load time (p95)", "—", "could not load");
    // Nothing else is dragged down with it.
    expectTile("Events", "45.6k", "spans, selected range");
  });

  /*
   * fetchSpanMetrics never rejects: a failed aggregate resolves an empty
   * result with `failed` set. Its zeros must not reach the three span tiles.
   */
  test("a failed span lookup reads 'could not load' on Events, Error rate and Event duration - never 0", async () => {
    arrange({
      allSpans: Promise.resolve({
        total: 0,
        errors: 0,
        errorRatePercent: null,
        p95DurationMs: null,
        countSeries: [],
        errorSeries: [],
        p95Series: [],
        failed: true,
      }),
    });
    await renderPage();

    expectTile("Events", "—", "could not load");
    expectTile("Error rate", "—", "could not load");
    expectTile("Event duration (p95)", "—", "could not load");
    expect(within(tile("Events")).queryByText("0")).not.toBeInTheDocument();
    // The page-load tiles come from their own request and are unaffected.
    expectTile("Page loads", "1.2k", "3 failed");
  });

  test("a failed page-load series request also leaves the page-load tiles unknown", async () => {
    arrange({ pageLoadSeries: rejected("500") });
    await renderPage();

    expectTile("Page loads", "—", "could not load");
    expectTile("Page load time (p95)", "—", "could not load");
  });

  test("a failed exceptions lookup is unknown, not zero", async () => {
    arrange({
      signals: Promise.resolve({
        logs: SIGNALS.logs,
        exceptions: {
          total: 0,
          unhandledCount: 0,
          unhandledSeries: [],
          handledSeries: [],
          failed: true,
        },
      }),
    });
    await renderPage();

    expectTile("Exceptions", "—", "could not load");
    // The chart cannot say there are none either.
    expect(
      within(screen.getByTestId("rum-exceptions-empty")).getByText(
        "Couldn't load exceptions",
      ),
    ).toBeInTheDocument();
  });

  test("zero exceptions from an app that has reported them before show 0", async () => {
    arrange({
      signals: Promise.resolve({
        logs: SIGNALS.logs,
        exceptions: {
          total: 0,
          unhandledCount: 0,
          unhandledSeries: [],
          handledSeries: [],
          failed: false,
        },
      }),
      newestException: Promise.resolve(ago(3 * DAY_MS)),
    });
    await renderPage();

    expectTile("Exceptions", "0", "reported by your app");
  });

  test("a failed client count and a failed session list are unknown, not zero", async () => {
    arrange({
      clientCount: rejected("403"),
      sessionList: rejected("403"),
    });
    await renderPage();

    expectTile("Clients", "—", "could not load");
    expectTile("Sessions recorded", "—", "could not load");
  });

  /*
   * An empty Core Web Vitals card says why (issue #6379), from the same
   * diagnosis as the setup check's Web Vitals row, and the per-vital (i)s
   * are absent.
   */
  const NO_VITALS: Promise<Array<WebVital>> = Promise.resolve(
    VITALS.map((v: WebVital): WebVital => {
      return { ...v, value: null };
    }),
  );

  function webVitalsEmpty(part?: string): HTMLElement {
    return screen.getByTestId(
      part ? `rum-webVitals-empty-${part}` : "rum-webVitals-empty",
    );
  }

  test("no web vitals in 30 days: not set up, and the docs that set them up", async () => {
    arrange({
      app: TRACKED_APP,
      vitals: NO_VITALS,
      newestWebVital: Promise.resolve(null),
    });
    await renderPage();

    expect(webVitalsEmpty()).toHaveAttribute("data-state", "not-set-up");
    expect(webVitalsEmpty("title").textContent).toBe(
      "Web Vitals aren't set up",
    );
    expect(webVitalsEmpty("detail").textContent).toBe(
      "No Web Vital has arrived from this app in the past 30\u00A0days. Web Vitals are metrics your app reports with the web-vitals library, which a few lines send.",
    );
    expect(
      within(webVitalsEmpty()).getByRole("link", { name: "Set up Web Vitals" }),
    ).toHaveAttribute("href", "/docs/rum/web-vitals");
    expect(
      screen.getByRole("button", { name: "About Core Web Vitals" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^About LCP/ }),
    ).not.toBeInTheDocument();
    // One row of one metric's granules: the newest of the past 30 days.
    expect(analyticsGetListMock).toHaveBeenCalledTimes(1);
    expect(
      (analyticsGetListMock.mock.calls[0]![0] as { limit: number }).limit,
    ).toBe(1);
  });

  test("metrics of other names only: says the card reads none of their names", async () => {
    arrange({
      app: { ...TRACKED_APP, metricsLastReceivedAt: new Date() },
      vitals: NO_VITALS,
      newestWebVital: Promise.resolve(null),
    });
    await renderPage();

    expect(webVitalsEmpty()).toHaveAttribute("data-state", "not-set-up");
    expect(webVitalsEmpty("detail").textContent).toBe(
      "Metrics arrive from this app, but none in the past 30\u00A0days under a name this card reads.",
    );
  });

  test("vitals came days ago: none in this range, and the range that shows them", async () => {
    arrange({
      app: { ...TRACKED_APP, metricsLastReceivedAt: new Date() },
      vitals: NO_VITALS,
      newestWebVital: Promise.resolve(ago(3 * DAY_MS)),
    });
    await renderPage();

    expect(webVitalsEmpty()).toHaveAttribute("data-state", "quiet");
    expect(webVitalsEmpty("title").textContent).toBe(
      "No Web Vitals in this time range",
    );
    expect(webVitalsEmpty("detail").textContent).toMatch(
      /^The last Web Vital arrived .+\.$/,
    );
    expect(
      within(webVitalsEmpty()).getByRole("button", {
        name: "Show the past week",
      }),
    ).toBeInTheDocument();
  });

  test("the vitals are in range: no empty state, and nothing more is read", async () => {
    arrange({ app: TRACKED_APP });
    await renderPage();

    expect(screen.queryByTestId("rum-webVitals-empty")).toBeNull();
    expect(analyticsGetListMock).not.toHaveBeenCalled();
  });

  test("the newest vital could not be read: says it could not check, with Try again", async () => {
    arrange({
      app: TRACKED_APP,
      vitals: NO_VITALS,
      newestWebVital: rejected("Network down"),
    });
    await renderPage();

    expect(webVitalsEmpty("title").textContent).toBe(
      "Couldn't check why there are no Web Vitals",
    );
    expect(
      within(webVitalsEmpty()).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("RUM overview: the SDK-missing notice", () => {
  test("names the new tiles when only session replay is reporting", async () => {
    arrange({
      app: {
        ...APP,
        clientType: undefined,
        sdkLanguage: undefined,
        agentVersion: undefined,
        sessionReplayLastChunkReceivedAt: new Date(),
      },
    });
    await renderPage();

    expect(
      screen.getByText("Session replay is reporting, the RUM SDK is not"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Page loads, events, error rate, durations, exceptions and clients/,
      ),
    ).toBeInTheDocument();
  });

  test("is absent once the SDK has reported", async () => {
    arrange();
    await renderPage();

    expect(
      screen.queryByText("Session replay is reporting, the RUM SDK is not"),
    ).not.toBeInTheDocument();
  });
});

describe("RUM overview: refreshing", () => {
  test("a manual refresh keeps every value on screen until its replacement arrives", async () => {
    arrange();
    await renderPage();

    // The second round never answers.
    arrange({
      allSpans: never<SpanMetrics>(),
      pageLoadSeries: never<SpanMetrics>(),
      pageLoadStats: never<SpanNameStats>(),
      signals: never<LogAndExceptionSignals>(),
      sessionList: never<unknown>(),
      vitals: never<Array<WebVital>>(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    expect(fetchSpanNameStatsMock).toHaveBeenCalledTimes(2);
    expectTile("Page loads", "1.2k", "3 failed");
    expectTile("Page load time (p95)", "2.34 s", "median 850 ms");
    expectTile("Exceptions", "17", "reported by your app");
    expectTile("Sessions recorded", "50+", "Past 1 Hour");
  });

  test("a range change reloads with spinners and names the new range on the sessions tile", async () => {
    arrange();
    await renderPage();

    arrange({
      pageLoadStats: never<SpanNameStats>(),
      sessionList: Promise.resolve({
        sessions: sessions(3),
        nextCursor: null,
        ignoredFilters: [],
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick past day" }));
    await flush();

    expect(tile("Page loads")).toHaveAttribute("aria-busy", "true");
    expect(tile("Page load time (p95)")).toHaveAttribute("aria-busy", "true");
    expectTile("Sessions recorded", "3", "Past 1 Day");
  });

  test("a slow response from the previous range does not overwrite the new one", async () => {
    let resolveOld: (stats: SpanNameStats) => void = () => {};
    arrange({
      pageLoadStats: new Promise<SpanNameStats>(
        (resolve: (stats: SpanNameStats) => void) => {
          resolveOld = resolve;
        },
      ),
    });
    await renderPage();

    arrange({
      pageLoadStats: Promise.resolve({ ...PAGE_LOAD_STATS, count: 42 }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Pick past day" }));
    await flush();

    expectTile("Page loads", "42", "3 failed");

    resolveOld({ ...PAGE_LOAD_STATS, count: 999999 });
    await flush();

    expectTile("Page loads", "42", "3 failed");
  });
});

/*
 * Issue #3975. The app-wide INP mixes every view of a single-page app
 * together; the per-route card is where the slow one shows up.
 */
describe("RUM overview: INP by route", () => {
  test("is not shown, and not asked for, until INP has reported", async () => {
    arrange();
    await renderPage();

    expect(fetchWebVitalByRouteMock).not.toHaveBeenCalled();
    expect(screen.queryByText("INP by route")).toBeNull();
  });

  test("asks for INP per route under the name the vitals card found it by", async () => {
    arrange({ vitals: Promise.resolve(VITALS_WITH_INP) });
    await renderPage();

    expect(fetchWebVitalByRouteMock).toHaveBeenCalledTimes(1);

    const request: {
      primaryEntityId: ObjectID;
      metricName: string;
      start: Date;
      end: Date;
    } = fetchWebVitalByRouteMock.mock.calls[0]![0] as {
      primaryEntityId: ObjectID;
      metricName: string;
      start: Date;
      end: Date;
    };

    expect(request.metricName).toBe("web_vital.inp");
    expect(request.primaryEntityId.toString()).toBe(MODEL_ID);
    expect(request.end.getTime()).toBeGreaterThan(request.start.getTime());
  });

  test("lists the routes slowest first, each rated, and explains itself", async () => {
    arrange({
      vitals: Promise.resolve(VITALS_WITH_INP),
      inpByRoute: Promise.resolve({
        routeAttribute: "app.route",
        routes: [
          { route: "/products/:id", value: 620 },
          { route: "/cart", value: 240 },
          { route: "/", value: 90 },
        ],
        totalRoutes: 12,
        failed: false,
      }),
    });
    await renderPage();

    expect(screen.getByText("INP by route")).toBeInTheDocument();
    expect(
      await tooltipTextOf(
        screen.getByRole("button", { name: "About INP by route" }),
      ),
    ).toBe(RUM_METRIC_DESCRIPTIONS.inpByRoute);

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "web-vital-route-row",
    );

    expect(
      rows.map((row: HTMLElement): string => {
        return row.textContent || "";
      }),
    ).toEqual([
      "/products/:id620\u00A0msPoor",
      "/cart240\u00A0msNeeds work",
      "/90\u00A0msGood",
    ]);
    expect(screen.getByText("(app.route)")).toBeInTheDocument();
    expect(screen.getByText(/The 3 slowest of 12/)).toBeInTheDocument();
  });

  test("INP without a route attribute says how to add one", async () => {
    arrange({ vitals: Promise.resolve(VITALS_WITH_INP) });
    await renderPage();

    expect(
      screen.getByText("INP is reported, but not per route"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How to measure INP per route" }),
    ).toHaveAttribute("href", "/docs/rum/web-vitals#single-page-apps");
  });

  test("a failed lookup says so rather than claiming there are no routes", async () => {
    arrange({
      vitals: Promise.resolve(VITALS_WITH_INP),
      inpByRoute: Promise.resolve({ ...NO_ROUTES, failed: true }),
    });
    await renderPage();

    expect(
      screen.getByText("Could not load INP by route."),
    ).toBeInTheDocument();
    expect(screen.queryByText("INP is reported, but not per route")).toBeNull();
  });
});

/*
 * Issue #5770. An empty Exceptions or Logs chart used to say "No data in
 * this time range" whatever the reason. Now it says which of three it is -
 * quiet in this range, not set up, or nothing arriving at all - with the
 * one thing that helps: a longer range, the setup dialog, or the setup
 * steps; and when the check itself fails, a retry.
 */
const NO_SIGNALS: LogAndExceptionSignals = {
  logs: {
    total: 0,
    errorCount: 0,
    countSeries: [],
    errorSeries: [],
    failed: false,
  },
  exceptions: {
    total: 0,
    unhandledCount: 0,
    unhandledSeries: [],
    handledSeries: [],
    failed: false,
  },
};

// The app's arrivals have been kept for ten days.
const TRACKED_APP: Record<string, unknown> = {
  ...APP,
  tracesLastReceivedAt: new Date(),
  signalArrivalsTrackedSince: new Date(Date.now() - 10 * DAY_MS),
};

function emptyChart(signal: "exceptions" | "logs"): HTMLElement {
  return screen.getByTestId(`rum-${signal}-empty`);
}

function textOf(signal: "exceptions" | "logs", part: string): string {
  return screen.getByTestId(`rum-${signal}-empty-${part}`).textContent || "";
}

function lastSignalsWindow(): { start: Date; end: Date } {
  const calls: Array<Array<unknown>> = fetchSignalsMock.mock.calls;
  return calls[calls.length - 1]![0] as { start: Date; end: Date };
}

describe("RUM overview: why Exceptions and Logs are empty", () => {
  test("set up but quiet: when the last one arrived, and the longer range that shows it", async () => {
    const lastException: Date = ago(3 * DAY_MS);
    const lastLog: Date = ago(DAY_MS + 60 * 60 * 1000);
    arrange({
      app: { ...TRACKED_APP, logsLastReceivedAt: lastLog },
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(lastException),
    });
    await renderPage();

    expect(emptyChart("exceptions")).toHaveAttribute("data-state", "quiet");
    expect(textOf("exceptions", "title")).toBe(
      "No exceptions in this time range",
    );
    expect(textOf("exceptions", "detail")).toBe(
      `The last exception arrived ${OneUptimeDate.fromNow(lastException, new Date())}.`,
    );
    expect(textOf("logs", "title")).toBe("No logs in this time range");
    expect(textOf("logs", "detail")).toBe(
      `The last log arrived ${OneUptimeDate.fromNow(lastLog, new Date())}.`,
    );
    // Quiet is not broken: no setup dialog, no troubleshooting link.
    expect(
      screen.queryByRole("button", { name: /Set up/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Why nothing arrives")).toBeNull();
    // A real zero.
    expectTile("Exceptions", "0", "reported by your app");

    fireEvent.click(
      within(emptyChart("exceptions")).getByRole("button", {
        name: "Show the past week",
      }),
    );
    await flush();

    const window: { start: Date; end: Date } = lastSignalsWindow();
    expect(window.end.getTime() - window.start.getTime()).toBe(7 * DAY_MS);
  });

  test("quiet for longer than a week offers the month", async () => {
    arrange({
      app: { ...TRACKED_APP, logsLastReceivedAt: ago(9 * DAY_MS) },
      signals: Promise.resolve(NO_SIGNALS),
    });
    await renderPage();

    expect(
      within(emptyChart("logs")).getByRole("button", {
        name: "Show the past month",
      }),
    ).toBeInTheDocument();
  });

  test("never reported: the tile says not set up, the charts say why and open the setup dialog", async () => {
    arrange({
      app: TRACKED_APP,
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
    });
    await renderPage();

    expectTile("Exceptions", "—", "not set up");

    expect(emptyChart("exceptions")).toHaveAttribute(
      "data-state",
      "not-set-up",
    );
    expect(textOf("exceptions", "title")).toBe("Exceptions aren't set up");
    expect(textOf("exceptions", "detail")).toBe(
      "No exception has arrived from this app. The OpenTelemetry browser SDK doesn't report errors on its own: a few lines in your telemetry file report them.",
    );
    expect(screen.queryByTestId("rum-exceptions-empty-evidence")).toBeNull();
    expect(screen.getByTestId("rum-exceptions-empty-help")).toHaveAttribute(
      "href",
      "/docs/rum/troubleshooting#exceptions-or-logs-are-empty",
    );

    // Logs have been kept for ten days: "none since" names the day.
    expect(textOf("logs", "title")).toBe("Logs aren't set up");
    expect(textOf("logs", "detail")).toMatch(
      /^No logs have arrived from this app since \w{3} \d{2}, \d{4}\. The OpenTelemetry browser SDK sends page loads and requests on its own; logs need a log pipeline and code that writes log records\.$/,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up exceptions" }));
    await flush();

    const dialog: HTMLElement = screen.getByTestId("rum-exceptions-setup");
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Set up exceptions",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Report the errors checkout-web throws, so they appear under Exceptions.",
    );
    expect(
      within(dialog).getByText("Add the error handlers to src/telemetry.ts"),
    ).toBeInTheDocument();
    expect(dialog.textContent).toContain('window.addEventListener("error"');
    /*
     * The trace exporter the app has sends them: no key is asked for. (The
     * empty charts read what the project's keys were refused, issue #6378.)
     */
    expect(
      getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
        const modelType: unknown = (call[0] as { modelType?: unknown })
          .modelType;
        return (
          modelType !== TelemetryException &&
          modelType !== TelemetryIngestionKeyRefusal
        );
      }),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();
    expect(screen.queryByTestId("rum-exceptions-setup")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set up logs" }));
    await flush();

    const logsDialog: HTMLElement = screen.getByTestId("rum-logs-setup");
    expect(screen.getByTestId("modal-title")).toHaveTextContent("Set up logs");
    expect(
      within(logsDialog).getByText("Add a log pipeline to src/telemetry.ts"),
    ).toBeInTheDocument();
    expect(logsDialog.textContent).toContain("/otlp/v1/logs");
  });

  test("recorded sessions with errors back the not-set-up answer up", async () => {
    arrange({
      app: TRACKED_APP,
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
      sessionList: Promise.resolve({
        sessions: [
          { sessionId: "s-1", errorCount: 2, hasError: true },
          { sessionId: "s-2", errorCount: 0, hasError: true },
          { sessionId: "s-3", errorCount: 0, hasError: false },
        ],
        nextCursor: null,
        ignoredFilters: [],
      }),
    });
    await renderPage();

    expect(textOf("exceptions", "evidence")).toBe(
      "Session Replay recorded 2 sessions with errors in this time range, so errors do happen.",
    );
  });

  /*
   * Counted with Session Replay's own errors filter (issue #6379): every
   * recorded session with an error in the range, not those among the
   * newest page of sessions - and past a page of them, "or more".
   */
  test("sessions with errors are counted with Session Replay's errors filter, and past a page say 'or more'", async () => {
    arrange({
      app: TRACKED_APP,
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
      // The newest page of sessions holds none with an error...
      sessionList: Promise.resolve({
        sessions: sessions(50),
        nextCursor: { id: "next" },
        ignoredFilters: [],
      }),
      // ... and the errors filter finds a page of them, and more.
      sessionsWithErrors: Promise.resolve({
        sessions: sessions(50).map((session: { sessionId: string }) => {
          return { ...session, errorCount: 1, hasError: true };
        }),
        nextCursor: { id: "more-with-errors" },
        ignoredFilters: [],
      }),
    });
    await renderPage();

    expect(textOf("exceptions", "evidence")).toBe(
      "Session Replay recorded 50 or more sessions with errors in this time range, so errors do happen.",
    );

    const requests: Array<{ signal: string; startTime: Date; endTime: Date }> =
      fetchSessionReplayListMock.mock.calls.map((call: Array<unknown>) => {
        return call[0] as { signal: string; startTime: Date; endTime: Date };
      });
    const errors: Array<{ signal: string; startTime: Date; endTime: Date }> =
      requests.filter((request: { signal: string }): boolean => {
        return request.signal === "errors";
      });
    expect(errors).toHaveLength(1);
    // The same window as the page's own count.
    const all: { signal: string; startTime: Date; endTime: Date } =
      requests.find((request: { signal: string }): boolean => {
        return request.signal !== "errors";
      })!;
    expect(errors[0]!.startTime).toEqual(all.startTime);
    expect(errors[0]!.endTime).toEqual(all.endTime);
  });

  test("the errors filter's read fails: no evidence, and the not-set-up answer stands", async () => {
    arrange({
      app: TRACKED_APP,
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
      sessionsWithErrors: rejected("403"),
    });
    await renderPage();

    expect(emptyChart("exceptions")).toHaveAttribute(
      "data-state",
      "not-set-up",
    );
    expect(screen.queryByTestId("rum-exceptions-empty-evidence")).toBeNull();
  });

  test("one recorded session with an error reads in the singular", async () => {
    arrange({
      app: TRACKED_APP,
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
      sessionList: Promise.resolve({
        sessions: [{ sessionId: "s-1", errorCount: 1, hasError: true }],
        nextCursor: null,
        ignoredFilters: [],
      }),
    });
    await renderPage();

    expect(textOf("exceptions", "evidence")).toBe(
      "Session Replay recorded 1 session with an error in this time range, so errors do happen.",
    );
  });

  test("an app silent since before its arrivals were kept is quiet, never 'not set up'", async () => {
    const lastHeard: Date = ago(40 * DAY_MS);
    arrange({
      app: {
        ...APP,
        lastSeenAt: lastHeard,
        signalArrivalsTrackedSince: ago(2 * DAY_MS),
      },
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(ago(45 * DAY_MS)),
    });
    await renderPage();

    expect(emptyChart("logs")).toHaveAttribute("data-state", "quiet");
    expect(textOf("logs", "title")).toBe("No logs in this time range");
    expect(textOf("logs", "detail")).toMatch(
      /^Nothing has arrived from this app since \w{3} \d{2}, \d{4}\.$/,
    );
    expect(
      within(emptyChart("logs")).getByRole("link", {
        name: "See the setup steps",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/documentation`,
    );
    expect(screen.queryByText("Logs aren't set up")).toBeNull();
  });

  test("only Session Replay reports: the SDK is what is missing", async () => {
    arrange({
      app: {
        ...APP,
        clientType: undefined,
        sdkLanguage: undefined,
        agentVersion: undefined,
        lastSeenAt: new Date(),
        sessionReplayLastChunkReceivedAt: new Date(),
        signalArrivalsTrackedSince: ago(10 * DAY_MS),
      },
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
    });
    await renderPage();

    expect(textOf("exceptions", "title")).toBe(
      "The OpenTelemetry SDK isn't reporting",
    );
    expect(textOf("logs", "detail")).toBe(
      "Recordings arrive from this app, but logs come through the OpenTelemetry browser SDK, which hasn't reported yet.",
    );
    expect(screen.queryByRole("button", { name: /Set up/ })).toBeNull();
  });

  test("nothing has ever arrived: neither chart blames the signal", async () => {
    arrange({
      app: {
        ...APP,
        clientType: undefined,
        sdkLanguage: undefined,
        agentVersion: undefined,
        lastSeenAt: undefined,
        signalArrivalsTrackedSince: new Date(),
      },
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(null),
    });
    await renderPage();

    expect(emptyChart("exceptions")).toHaveAttribute(
      "data-state",
      "not-arriving",
    );
    expect(textOf("exceptions", "title")).toBe(
      "Nothing has arrived from this app yet",
    );
    expect(textOf("logs", "title")).toBe(
      "Nothing has arrived from this app yet",
    );
    expect(screen.queryByText("Exceptions aren't set up")).toBeNull();
    expect(screen.queryByText("Logs aren't set up")).toBeNull();
  });

  test("a check that failed says so, and Try again reads again", async () => {
    let answer: Promise<Date | null> = rejected<Date | null>("503");
    arrange({
      app: TRACKED_APP,
      signals: Promise.resolve(NO_SIGNALS),
    });
    getListMock.mockImplementation(async () => {
      const at: Date | null = await answer;
      return { data: at ? [{ lastSeenAt: at }] : [], count: 0 };
    });
    await renderPage();

    expect(emptyChart("exceptions")).toHaveAttribute("data-state", "unknown");
    expect(textOf("exceptions", "title")).toBe(
      "Couldn't check why there are no exceptions",
    );
    // Never a guess: the tile stays a real count.
    expectTile("Exceptions", "0", "reported by your app");

    answer = Promise.resolve(null);
    const reads: number = fetchSignalsMock.mock.calls.length;
    fireEvent.click(
      within(emptyChart("exceptions")).getByRole("button", {
        name: "Try again",
      }),
    );
    await flush();

    expect(fetchSignalsMock.mock.calls.length).toBe(reads + 1);
    expect(textOf("exceptions", "title")).toBe("Exceptions aren't set up");
  });

  test("a chart with data draws it, with no explanation", async () => {
    arrange({ app: TRACKED_APP });
    await renderPage();

    expect(screen.queryByTestId("rum-exceptions-empty")).toBeNull();
    expect(screen.queryByTestId("rum-logs-empty")).toBeNull();
    // Nothing to explain, so neither the newest exception nor the refusals are read.
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("in German the empty charts read in German", async () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const keys: Array<string> = [
      "Exceptions aren't set up",
      "Set up exceptions",
      "Why nothing arrives",
      "not set up",
    ];
    for (const key of keys) {
      expect(german[key]).toBeTruthy();
      expect(german[key]).not.toBe(key);
      TRANSLATIONS[key] = german[key]!;
    }

    try {
      arrange({
        app: TRACKED_APP,
        signals: Promise.resolve(NO_SIGNALS),
        newestException: Promise.resolve(null),
      });
      await renderPage();

      expect(textOf("exceptions", "title")).toBe(
        german["Exceptions aren't set up"],
      );
      expect(
        screen.getByRole("button", { name: german["Set up exceptions"]! }),
      ).toBeInTheDocument();
      expect(textOf("exceptions", "help")).toBe(german["Why nothing arrives"]);
      expectTile("Exceptions", "—", german["not set up"]!);
    } finally {
      for (const key of keys) {
        delete TRANSLATIONS[key];
      }
    }
  });
});

describe("RUM overview: telemetry refused at ingest", () => {
  const HOUR_MS: number = 60 * 60 * 1000;

  // Nothing has come from the app for five hours.
  const SILENT_APP: Record<string, unknown> = {
    ...TRACKED_APP,
    lastSeenAt: ago(5 * HOUR_MS),
    tracesLastReceivedAt: ago(5 * HOUR_MS),
    logsLastReceivedAt: ago(5 * HOUR_MS),
  };

  function refusalRow(
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      reason: "key-disabled",
      surface: "otel-traces",
      refusedCount: 250,
      firstRefusedAt: ago(4 * HOUR_MS),
      lastRefusedAt: ago(10 * 60 * 1000),
      telemetryIngestionKeyId: "6c3d0000-0000-4000-8000-0000000000f6",
      telemetryIngestionKey: {
        name: "Checkout key",
        keyType: "Server",
        pinnedServiceName: "checkout-web",
      },
      ...extra,
    };
  }

  function refusalReads(): number {
    return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { modelType?: unknown }).modelType ===
        TelemetryIngestionKeyRefusal
      );
    }).length;
  }

  test("the app's key turned off and the project's budget used up: each empty chart says what refused it, and the fix", async () => {
    const traces: Record<string, unknown> = refusalRow();
    arrange({
      app: SILENT_APP,
      signals: Promise.resolve(NO_SIGNALS),
      newestException: Promise.resolve(ago(3 * DAY_MS)),
      refusals: [
        traces,
        refusalRow({
          reason: "project-daily-budget",
          surface: "otel-logs",
          telemetryIngestionKey: { name: "Backend key", keyType: "Server" },
        }),
      ],
    });
    await renderPage();

    expect(textOf("exceptions", "title")).toBe("Exceptions are being refused");
    expect(textOf("exceptions", "detail")).toBe(
      'The key "Checkout key" is turned off, so everything sent with it is refused.',
    );
    expect(textOf("exceptions", "evidence")).toBe(
      `The latest was refused ${OneUptimeDate.fromNow(
        traces["lastRefusedAt"] as Date,
        new Date(),
      )}.`,
    );

    expect(textOf("logs", "title")).toBe("Logs are being refused");
    expect(
      within(emptyChart("logs")).getByRole("link", { name: "See budgets" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/usage-history`,
    );

    fireEvent.click(
      within(emptyChart("exceptions")).getByRole("button", {
        name: "Pick another key",
      }),
    );
    await flush();

    expect(screen.getByTestId("rum-pick-key-setup")).toBeInTheDocument();
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Pick another key",
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();
    expect(screen.queryByTestId("rum-pick-key-setup")).toBeNull();
  });

  test("telemetry that arrived after the refusal: the chart's own answer", async () => {
    const lastLog: Date = ago(3 * 60 * 1000);
    arrange({
      app: { ...SILENT_APP, logsLastReceivedAt: lastLog },
      signals: Promise.resolve(NO_SIGNALS),
      refusals: [
        refusalRow({ surface: "otel-logs", lastRefusedAt: ago(HOUR_MS) }),
      ],
    });
    await renderPage();

    expect(textOf("logs", "title")).not.toBe("Logs are being refused");
  });

  test("read once a chart is empty, and again on every refresh", async () => {
    arrange({
      app: SILENT_APP,
      signals: Promise.resolve(NO_SIGNALS),
      refusals: [refusalRow()],
    });
    await renderPage();

    expect(refusalReads()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    expect(refusalReads()).toBe(2);
    expect(textOf("exceptions", "title")).toBe("Exceptions are being refused");
  });
});

/*
 * A MOBILE APP'S OVERVIEW (#9588). The same page, for an application ingest
 * names mobile (clientType "mobile"): sessions, crash-free sessions,
 * crashes, ANRs, app starts, cold start time, frozen frames and the share
 * of failed spans, with charts and a frames-by-screen card of its own, and
 * no page load or Web Vital read or drawn.
 */
const MOBILE_APP: Record<string, unknown> = {
  name: "Kiosk Ordering",
  appIdentifier: "kiosk-ordering",
  clientType: "mobile",
  sdkLanguage: "java",
  agentVersion: "1.8.1",
  otelCollectorStatus: "connected",
  lastSeenAt: new Date(),
};

function mobileAppStarts(): MobileAppStarts {
  const result: MobileAppStarts = emptyAppStarts(false);
  result.total = 42;
  result.byType = {
    cold: { count: 12, p50DurationMs: 1100, p95DurationMs: 2300 },
    warm: { count: 30, p50DurationMs: 400, p95DurationMs: 900 },
    hot: { count: 0, p50DurationMs: null, p95DurationMs: null },
  };
  result.countSeries = {
    cold: points([T0, 8], [T1, 4]),
    warm: points([T0, 30]),
    hot: [],
  };
  result.p95Series = {
    cold: points([T0, 2200], [T1, 2400]),
    warm: points([T0, 900]),
    hot: [],
  };
  return result;
}

const MOBILE_SESSIONS: MobileSessions = {
  sessions: 200,
  spans: 4000,
  // An app on an SDK that names no install (#9716): the line under the share is its sessions'.
  installs: 0,
  failed: false,
};

const MOBILE_FAULTS: MobileFaults = {
  crashes: {
    total: 3,
    series: points([T0, 2], [T1, 1]),
    sessions: 2,
    installs: 0,
    failed: false,
  },
  anrs: {
    total: 1,
    series: points([T1, 1]),
    sessions: 1,
    installs: 0,
    failed: false,
  },
};

const MOBILE_FRAMES: MobileFrames = {
  slow: 52,
  frozen: 3,
  slowSeries: points([T0, 40], [T1, 12]),
  frozenSeries: points([T1, 3]),
  byScreen: [
    { screen: "MenuActivity", slow: 40, frozen: 3 },
    { screen: "CartActivity", slow: 12, frozen: 0 },
  ],
  failed: false,
  byScreenFailed: false,
};

const NO_FRAMES: MobileFrames = {
  slow: 0,
  frozen: 0,
  slowSeries: [],
  frozenSeries: [],
  byScreen: [],
  failed: false,
  byScreenFailed: false,
};

const MOBILE_HOUR_MS: number = 60 * 60 * 1000;

/*
 * A description as the page draws it: English drawn as written holds each
 * figure to the duration's word after it ("15\u00A0minutes", #8811).
 */
function asDrawn(english: string): string {
  return withDurationWordsHeld(english);
}

interface MobileScenario {
  appStarts?: Promise<MobileAppStarts> | undefined;
  sessions?: Promise<MobileSessions> | undefined;
  faults?: Promise<MobileFaults> | undefined;
  frames?: Promise<MobileFrames> | undefined;
  newestAppStart?: Promise<Date | null> | undefined;
  newestFrameEvent?: Promise<Date | null> | undefined;
}

function arrangeMobile(
  scenario: MobileScenario = {},
  page: Scenario = {},
): void {
  arrange({ app: MOBILE_APP, ...page });

  fetchMobileAppStartsMock.mockImplementation(() => {
    return scenario.appStarts ?? Promise.resolve(mobileAppStarts());
  });
  fetchMobileSessionsMock.mockImplementation(() => {
    return scenario.sessions ?? Promise.resolve(MOBILE_SESSIONS);
  });
  fetchMobileFaultsMock.mockImplementation(() => {
    return scenario.faults ?? Promise.resolve(MOBILE_FAULTS);
  });
  fetchMobileFramesMock.mockImplementation(() => {
    return scenario.frames ?? Promise.resolve(MOBILE_FRAMES);
  });
  fetchNewestAppStartAtMock.mockImplementation(() => {
    return scenario.newestAppStart ?? Promise.resolve(ago(DAY_MS));
  });
  fetchNewestFrameEventAtMock.mockImplementation(() => {
    return scenario.newestFrameEvent ?? Promise.resolve(ago(DAY_MS));
  });
}

async function renderMobilePage(): Promise<void> {
  render(<RumApplicationOverview {...({} as PageComponentProps)} />);
  await screen.findByText("Kiosk Ordering");
  await flush();
}

const MOBILE_TILE_TITLES: Array<[string, RumMetric]> = [
  ["Sessions", "sessions"],
  ["Crash-free sessions", "crashFreeSessions"],
  ["Crashes", "crashes"],
  ["ANRs", "anrs"],
  ["App starts", "appStarts"],
  ["Cold start (p95)", "coldStartTime"],
  ["Frozen frames", "frozenFrames"],
  ["Error rate", "errorRateMobile"],
];

const MOBILE_CHART_TITLES: Array<[string, RumMetric]> = [
  ["App starts", "appStartsChart"],
  ["Startup time (p95)", "startupTimeChart"],
  ["Crashes and ANRs", "crashesChart"],
  ["Slow and frozen frames", "framesChart"],
  ["Events", "eventsChartMobile"],
  ["Logs", "logsChartMobile"],
];

function tileTitles(): Array<string> {
  return Array.from(document.querySelectorAll("[aria-busy]")).map(
    (root: Element): string => {
      return root.querySelector("span.uppercase")?.textContent || "";
    },
  );
}

function tileHref(title: string): string {
  const link: HTMLAnchorElement | null = tile(title).querySelector("a");
  expect(link).not.toBeNull();
  return decodeURIComponent(link!.getAttribute("href") || "");
}

function mobileEmpty(signal: string): Array<HTMLElement> {
  return screen.queryAllByTestId(`rum-mobile-${signal}-empty`);
}

describe("RUM overview: a mobile app's tiles (#9588)", () => {
  test("shows a mobile app's tiles, in the order a mobile team scans them", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(tileTitles()).toEqual(
      MOBILE_TILE_TITLES.map(([title]: [string, RumMetric]): string => {
        return title;
      }),
    );
  });

  test("every tile shows the value and the line under it that its data supports", async () => {
    arrangeMobile();
    await renderMobilePage();

    expectTile("Sessions", "200", "Past 1 Hour");
    expectTile("Crash-free sessions", "99.00%", "2 sessions crashed");
    expectTile("Crashes", "3", "in 2 sessions");
    expectTile("ANRs", "1", "in 1 session");
    expectTile("App starts", "42", "cold 12, warm 30, hot 0");
    expectTile("Cold start (p95)", "2.30 s", "median 1.10 s");
    expectTile("Frozen frames", "3", "52 slow frames");
    expectTile("Error rate", "2.0%", "912 errored");
  });

  /*
   * #9716: an app that names its installs (OpenTelemetry Android's
   * app.installation.id) reads its crash-free installs under the
   * sessions' share.
   */
  test("an app that names its installs reads its crash-free installs under the sessions' share", async () => {
    arrangeMobile({
      sessions: Promise.resolve({ ...MOBILE_SESSIONS, installs: 80 }),
      faults: Promise.resolve({
        ...MOBILE_FAULTS,
        crashes: { ...MOBILE_FAULTS.crashes, installs: 2 },
      }),
    });
    await renderMobilePage();

    expectTile(
      "Crash-free sessions",
      "99.00%",
      "97.50% of installs crash-free",
    );
    // The sessions a crash ended still read on the Crashes tile.
    expectTile("Crashes", "3", "in 2 sessions");
  });

  test("no browser tile is drawn", async () => {
    arrangeMobile();
    await renderMobilePage();

    for (const title of [
      "Page loads",
      "Page load time (p95)",
      "Event duration (p95)",
      "Clients",
      "Sessions recorded",
    ]) {
      expect(tileTitles()).not.toContain(title);
    }
  });

  test("each tile carries its (i), worded by RUM_METRIC_DESCRIPTIONS", async () => {
    arrangeMobile();
    await renderMobilePage();

    for (const [title, key] of MOBILE_TILE_TITLES) {
      expect(await tooltipTextOf(tileInfo(title))).toBe(
        asDrawn(RUM_METRIC_DESCRIPTIONS[key]),
      );
    }

    // A session's limits read as one figure and its word each.
    expect(await tooltipTextOf(tileInfo("Sessions"))).toContain(
      "after 15 minutes in the background, or after 4 hours.",
    );
  });

  test("the hero says it is a mobile app", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(screen.getAllByText("mobile").length).toBeGreaterThan(0);
  });
});

describe("RUM overview: a mobile app's reads", () => {
  test("asks each mobile read for this app over the page's window", async () => {
    arrangeMobile();
    await renderMobilePage();

    for (const mock of [
      fetchMobileAppStartsMock,
      fetchMobileSessionsMock,
      fetchMobileFaultsMock,
      fetchMobileFramesMock,
    ]) {
      expect(mock).toHaveBeenCalledTimes(1);

      const scope: { primaryEntityId: ObjectID; start: Date; end: Date } = mock
        .mock.calls[0]![0] as never;

      expect(scope.primaryEntityId.toString()).toBe(MODEL_ID);
      expect(scope.end.getTime() - scope.start.getTime()).toBe(MOBILE_HOUR_MS);
    }
  });

  test("reads no page load and no Web Vital, and draws no Web Vitals card", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(fetchWebVitalsMock).not.toHaveBeenCalled();
    expect(fetchWebVitalByRouteMock).not.toHaveBeenCalled();
    expect(fetchSpanNameStatsMock).not.toHaveBeenCalled();

    for (const call of fetchSpanMetricsMock.mock.calls) {
      expect((call[0] as { spanName?: string }).spanName).toBeUndefined();
    }

    expect(screen.queryByText("Core Web Vitals")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Core Web Vitals" }),
    ).not.toBeInTheDocument();
  });

  test("looks up the newest app start or slow frame only when the range has none", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(fetchNewestAppStartAtMock).not.toHaveBeenCalled();
    expect(fetchNewestFrameEventAtMock).not.toHaveBeenCalled();
  });

  test("a browser app never asks a mobile read", async () => {
    arrange();
    await renderPage();

    for (const mock of [
      fetchMobileAppStartsMock,
      fetchMobileSessionsMock,
      fetchMobileFaultsMock,
      fetchMobileFramesMock,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
    expect(fetchWebVitalsMock).toHaveBeenCalled();
  });

  test("a refresh reads the mobile signals again, keeping the tiles on screen", async () => {
    arrangeMobile();
    await renderMobilePage();

    fetchMobileSessionsMock.mockImplementation(() => {
      return never<MobileSessions>();
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    expect(fetchMobileSessionsMock).toHaveBeenCalledTimes(2);
    // The answer is out; the old figure stays rather than a spinner.
    expectTile("Sessions", "200", "Past 1 Hour");
  });
});

describe("RUM overview: a mobile app's charts and cards", () => {
  test("draws the six mobile charts, each with its (i)", async () => {
    arrangeMobile();
    await renderMobilePage();

    for (const [title, key] of MOBILE_CHART_TITLES) {
      expect(await tooltipTextOf(chartInfo(title))).toBe(
        asDrawn(RUM_METRIC_DESCRIPTIONS[key]),
      );
    }
  });

  test("the start charts draw a line per kind of start", async () => {
    arrangeMobile();
    await renderMobilePage();

    const counts: ChartProps = chartWithSeries([
      "Cold starts",
      "Warm starts",
      "Hot starts",
    ]);
    const times: ChartProps = chartWithSeries([
      "Cold start",
      "Warm start",
      "Hot start",
    ]);

    expect(counts.data[0]!.data).toEqual(points([T0, 8], [T1, 4]));
    expect(counts.data[1]!.data).toEqual(points([T0, 30]));
    expect(times.data[0]!.data).toEqual(points([T0, 2200], [T1, 2400]));
  });

  test("crashes and ANRs are lines of their own, beside every other exception", async () => {
    arrangeMobile();
    await renderMobilePage();

    const chart: ChartProps = chartWithSeries([
      "Crashes",
      "ANRs",
      "Other exceptions",
    ]);

    expect(chart.data[0]!.data).toEqual(points([T0, 2], [T1, 1]));
    expect(chart.data[1]!.data).toEqual(points([T1, 1]));
    /*
     * Every exception (T0: 6, T1: 8, T2: 3, from SIGNALS) less the crashes
     * and the ANRs.
     */
    expect(chart.data[2]!.data).toEqual(points([T0, 4], [T1, 6], [T2, 3]));
  });

  test("frames are drawn slow and frozen", async () => {
    arrangeMobile();
    await renderMobilePage();

    const chart: ChartProps = chartWithSeries(["Slow frames", "Frozen frames"]);

    expect(chart.data[0]!.data).toEqual(points([T0, 40], [T1, 12]));
    expect(chart.data[1]!.data).toEqual(points([T1, 3]));
  });

  test("the frames by screen card lists the screens that froze most first", async () => {
    arrangeMobile();
    await renderMobilePage();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "rum-frames-by-screen-row",
    );

    expect(
      rows.map((row: HTMLElement): string => {
        return row.textContent || "";
      }),
    ).toEqual(["MenuActivity340", "CartActivity012"]);
    expect(
      await tooltipTextOf(
        screen.getByRole("button", { name: "About Frozen frames by screen" }),
      ),
    ).toBe(asDrawn(RUM_METRIC_DESCRIPTIONS.framesByScreen));
  });
});

describe("RUM overview: a mobile app's tiles link where the number is read", () => {
  test("crashes open the app's exceptions, ANRs only the types ANR and Hang", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(tileHref("Crashes")).toContain(
      `/dashboard/${PROJECT_ID}/exceptions/unresolved?range=Past 1 Hour`,
    );
    expect(tileHref("Crashes")).toContain(
      `filters=[["rumApplicationId","${MODEL_ID}"]]`,
    );
    expect(tileHref("Crash-free sessions")).toBe(tileHref("Crashes"));
    expect(tileHref("ANRs")).toContain(
      `[["rumApplicationId","${MODEL_ID}"],["exceptionType","ANR"],["exceptionType","Hang"]]`,
    );
  });

  test("app starts open the app's AppStart spans, the cold start tile the cold ones", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(tileHref("App starts")).toContain(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/traces?`,
    );
    expect(tileHref("App starts")).toContain('filters=[["name","AppStart"]]');
    expect(tileHref("Cold start (p95)")).toContain("search=@start.type:cold");
  });

  test("frozen frames open the app's app.jank events, the error rate its failed spans", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(tileHref("Frozen frames")).toContain(
      `/dashboard/${PROJECT_ID}/logs?`,
    );
    expect(tileHref("Frozen frames")).toContain(
      '["attributes.app.jank.threshold",["0.7"]]',
    );
    expect(tileHref("Error rate")).toContain('filters=[["statusCode","2"]]');
  });

  test("sessions open the app's spans, and its recordings when it records them", async () => {
    arrangeMobile();
    await renderMobilePage();

    expect(tileHref("Sessions")).toContain(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/traces?range=Past 1 Hour`,
    );

    cleanup();
    arrangeMobile(
      {},
      {
        app: { ...MOBILE_APP, sessionReplayLastChunkReceivedAt: new Date() },
      },
    );
    await renderMobilePage();

    expect(tileHref("Sessions")).toBe(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/session-replay?range=Past 1 Hour`,
    );
  });

  test("no (i) on a mobile app's page is nested in a link or another button", async () => {
    arrangeMobile();
    await renderMobilePage();

    for (const info of screen.getAllByRole("button", { name: /^About / })) {
      expect(info.closest("a")).toBeNull();
      expect(info.parentElement?.closest("button")).toBeNull();
    }
  });
});

describe("RUM overview: a mobile app's empty and failed reads", () => {
  test("an app that never reported an app start says what turns it on, with the Android Setup docs", async () => {
    arrangeMobile({
      appStarts: Promise.resolve(emptyAppStarts(false)),
      newestAppStart: Promise.resolve(null),
    });
    await renderMobilePage();

    expectTile("App starts", "0", "no app starts");
    expect(
      within(tile("Cold start (p95)")).getByText("no app starts"),
    ).toBeInTheDocument();

    // Both start charts say so.
    const empties: Array<HTMLElement> = mobileEmpty("appStarts");
    expect(empties).toHaveLength(2);
    expect(empties[0]).toHaveAttribute("data-state", "not-reported");
    expect(
      within(empties[0]!).getByText("No app starts reported yet"),
    ).toBeInTheDocument();
    expect(
      within(empties[0]!).getByRole("link", { name: "Open Android Setup" }),
    ).toHaveAttribute("href", RUM_ANDROID_SETUP_DOCS_URL);
    expect(fetchNewestAppStartAtMock).toHaveBeenCalledTimes(1);
  });

  test("starts quiet in this range say when the last one was", async () => {
    arrangeMobile({
      appStarts: Promise.resolve(emptyAppStarts(false)),
      newestAppStart: Promise.resolve(ago(3 * MOBILE_HOUR_MS)),
    });
    await renderMobilePage();

    const empty: HTMLElement = mobileEmpty("appStarts")[0]!;

    expect(empty).toHaveAttribute("data-state", "quiet");
    expect(
      within(empty).getByText("No app starts in this range"),
    ).toBeInTheDocument();
    expect(
      within(empty).getByText("The last app start was 3 hours ago."),
    ).toBeInTheDocument();
    expect(within(empty).queryByRole("link")).not.toBeInTheDocument();
  });

  test("no slow frame in range is good news, and the frames-by-screen card stays away", async () => {
    arrangeMobile({
      frames: Promise.resolve(NO_FRAMES),
      newestFrameEvent: Promise.resolve(ago(DAY_MS)),
    });
    await renderMobilePage();

    const empty: HTMLElement = mobileEmpty("frames")[0]!;

    expect(
      within(empty).getByText("No slow or frozen frames in this range"),
    ).toBeInTheDocument();
    expect(
      within(empty).getByText(
        "Every frame drew in time. The last slow frame was reported a day ago.",
      ),
    ).toBeInTheDocument();
    expectTile("Frozen frames", "0", "0 slow frames");
    expect(
      screen.queryByTestId("rum-frames-by-screen"),
    ).not.toBeInTheDocument();
  });

  test("frames never reported say what turns them on", async () => {
    arrangeMobile({
      frames: Promise.resolve(NO_FRAMES),
      newestFrameEvent: Promise.resolve(null),
    });
    await renderMobilePage();

    const empty: HTMLElement = mobileEmpty("frames")[0]!;

    expect(
      within(empty).getByText("No slow or frozen frames reported yet"),
    ).toBeInTheDocument();
    expect(
      within(empty).getByRole("link", { name: "Open Android Setup" }),
    ).toHaveAttribute("href", RUM_ANDROID_SETUP_DOCS_URL);
  });

  test("a failed read could not load on its tiles, and the others still draw", async () => {
    arrangeMobile({
      sessions: Promise.resolve({
        sessions: 0,
        spans: 0,
        installs: null,
        failed: true,
      }),
    });
    await renderMobilePage();

    expect(
      within(tile("Sessions")).getByText("could not load"),
    ).toBeInTheDocument();
    expect(
      within(tile("Crash-free sessions")).getByText("could not load"),
    ).toBeInTheDocument();
    expectTile("Crashes", "3", "in 2 sessions");
  });

  test("failed app start and frame reads say so on their charts", async () => {
    arrangeMobile({
      appStarts: Promise.resolve(emptyAppStarts(true)),
      frames: Promise.resolve({
        ...NO_FRAMES,
        failed: true,
        byScreenFailed: true,
      }),
    });
    await renderMobilePage();

    expect(screen.getAllByText("Could not load app starts")).toHaveLength(2);
    expect(screen.getByText("Could not load frames")).toBeInTheDocument();
    expect(fetchNewestAppStartAtMock).not.toHaveBeenCalled();
    expect(fetchNewestFrameEventAtMock).not.toHaveBeenCalled();
  });

  test("spans that name no session say so, and open the setup guide", async () => {
    arrangeMobile({
      sessions: Promise.resolve({
        sessions: 0,
        spans: 512,
        installs: 0,
        failed: false,
      }),
    });
    await renderMobilePage();

    expect(
      within(tile("Sessions")).getByText("No session.id"),
    ).toBeInTheDocument();
    expect(
      within(tile("Sessions")).getByText("spans name no session"),
    ).toBeInTheDocument();
    expect(tileHref("Sessions")).toBe(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/documentation`,
    );
    expect(
      within(tile("Crash-free sessions")).getByText("needs session.id"),
    ).toBeInTheDocument();
  });

  test("tiles still loading already carry their (i)", async () => {
    arrangeMobile({
      appStarts: never<MobileAppStarts>(),
      sessions: never<MobileSessions>(),
      faults: never<MobileFaults>(),
      frames: never<MobileFrames>(),
    });
    await renderMobilePage();

    for (const [title] of MOBILE_TILE_TITLES.slice(0, 7)) {
      expect(tile(title)).toHaveAttribute("aria-busy", "true");
    }
  });
});

describe("RUM overview: the tiles name their range in the reader's language (#10552)", () => {
  const german: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
      ),
      "utf8",
    ),
  ) as Record<string, string>;
  // Every English way the range was ever written under a tile.
  const ENGLISH_RANGES: RegExp = /past \d|custom range/i;

  function useGerman(keys: Array<string>): void {
    for (const key of keys) {
      expect(german[key]).toBeTruthy();
      expect(german[key]).not.toBe(key);
      TRANSLATIONS[key] = german[key]!;
    }
  }

  afterEach(() => {
    for (const key of Object.keys(TRANSLATIONS)) {
      delete TRANSLATIONS[key];
    }
  });

  test("a German page reads Sessions recorded over the past hour in German, with no English range on any tile", async () => {
    useGerman(["Past 1 Hour", "Past 1 Day"]);

    arrange();
    await renderPage();

    expectTile("Sessions recorded", "50+", german["Past 1 Hour"]!);
    expect(german["Past 1 Hour"]).toBe("Letzte Stunde");
    for (const title of TILE_TITLES.map(
      ([tileTitle]: [string, RumMetric]): string => {
        return tileTitle;
      },
    )) {
      expect({ title, text: tile(title).textContent }).not.toEqual({
        title,
        text: expect.stringMatching(ENGLISH_RANGES),
      });
    }

    // A new range is named in German too, its noun keeping its capital.
    arrange({
      sessionList: Promise.resolve({
        sessions: sessions(3),
        nextCursor: null,
        ignoredFilters: [],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Pick past day" }));
    await flush();

    expectTile("Sessions recorded", "3", german["Past 1 Day"]!);
    expect(german["Past 1 Day"]).toBe("Letzter Tag");
  });

  test("a German mobile app's Sessions, Crashes and ANRs tiles name the range in German", async () => {
    useGerman(["Past 1 Hour"]);

    arrangeMobile({
      faults: Promise.resolve<MobileFaults>({
        crashes: {
          total: 0,
          series: [],
          sessions: null,
          installs: null,
          failed: false,
        },
        anrs: {
          total: 0,
          series: [],
          sessions: null,
          installs: null,
          failed: false,
        },
      }),
    });
    await renderMobilePage();

    expectTile("Sessions", "200", german["Past 1 Hour"]!);
    expect(
      within(tile("Crashes")).getByText(german["Past 1 Hour"]!),
    ).toBeInTheDocument();
    expect(
      within(tile("ANRs")).getByText(german["Past 1 Hour"]!),
    ).toBeInTheDocument();
    for (const title of ["Sessions", "Crashes", "ANRs"]) {
      expect({ title, text: tile(title).textContent }).not.toEqual({
        title,
        text: expect.stringMatching(ENGLISH_RANGES),
      });
    }
  });
});
