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
const fetchSpanMetricsMock: MockFunction = getJestMockFunction();
const fetchSpanNameStatsMock: MockFunction = getJestMockFunction();
const fetchWebVitalsMock: MockFunction = getJestMockFunction();
const fetchWebVitalByRouteMock: MockFunction = getJestMockFunction();
const fetchSignalsMock: MockFunction = getJestMockFunction();
const fetchSessionReplayListMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();

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
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import OneUptimeDate from "../../../Types/Date";
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
   * When the newest exception arrived (null: never), read only when the
   * range has none. Two years ago by default: an app that reports them.
   */
  newestException?: Promise<Date | null> | undefined;
  // What the project's keys were refused in the past day (issue #6378).
  refusals?: Array<Record<string, unknown>> | undefined;
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
  fetchSessionReplayListMock.mockImplementation(() => {
    return (
      scenario.sessionList ??
      Promise.resolve({
        sessions: sessions(50),
        nextCursor: { id: "next" },
        ignoredFilters: [],
      })
    );
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
    fetchSpanMetricsMock,
    fetchSpanNameStatsMock,
    fetchWebVitalsMock,
    fetchWebVitalByRouteMock,
    fetchSignalsMock,
    fetchSessionReplayListMock,
    lineChartMock,
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
    expectTile("Sessions recorded", "50+", "past 1 hour");
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

    expectTile("Sessions recorded", "7", "past 1 hour");
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
    expect(text).toContain("Good below 2.5 s; poor at 4 s or more.");

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

  test("only Clients and Sessions recorded are links", async () => {
    arrange();
    await renderPage();

    const tileLinks: Array<string> = Array.from(
      document.querySelectorAll("[aria-busy] a"),
    ).map((a: Element): string => {
      return a.textContent || "";
    });

    expect(tileLinks).toEqual(["View Clients", "View Sessions recorded"]);
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

  test("no web vitals yet: the card still explains itself, the per-vital (i)s are absent", async () => {
    arrange({
      vitals: Promise.resolve(
        VITALS.map((v: WebVital): WebVital => {
          return { ...v, value: null };
        }),
      ),
    });
    await renderPage();

    expect(screen.getByText("No web vitals reported yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Core Web Vitals" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^About LCP/ }),
    ).not.toBeInTheDocument();
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
    expectTile("Sessions recorded", "50+", "past 1 hour");
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
    expectTile("Sessions recorded", "3", "past 1 day");
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
      "/products/:id620 msPoor",
      "/cart240 msNeeds work",
      "/90 msGood",
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
