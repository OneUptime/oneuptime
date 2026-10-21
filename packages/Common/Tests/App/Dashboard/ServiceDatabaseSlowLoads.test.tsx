/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 follow-up on the Service (APM) and Database overviews when
 * their telemetry is slower than the 30-second auto-refresh. The Service
 * overview's metrics effect was keyed on the model object, the Database
 * overview's telemetry effect on the row and its endpoint list, and every
 * tick replaced them (the tick reloads the model). The effect's staleness
 * guard then dropped the load still running for the same window and
 * started an identical one. When every load outlasted the interval, none
 * ever landed: the tiles loading for good, the charts skeletons, nothing
 * to zoom - and a zoom on a slow service or database never painted.
 *
 * Each page is rendered for real (ResourceOverview, ChartCard, the
 * Database sections, the hero's AutoRefreshControl and picker, the
 * auto-refresh timer) with the model answered at once and each telemetry
 * query parked until a test answers it:
 *
 *   - a tick while a load runs leaves it alone (the model still reloads);
 *     the load lands and fills the page, however many ticks it outlasts,
 *     whichever of the page's queries is the slow one;
 *   - once it has landed, the next tick loads the slid window, once;
 *   - a zoom, its reset, the picker and Refresh still replace a running
 *     load, and the newest window wins whichever answer lands first;
 *   - a reload that changes what scopes the telemetry (the service's
 *     language, the database's endpoints or pods) still replaces a running
 *     load; one that only re-stamps when a pod was last seen does not;
 *   - a failed load settles, auto-refresh Off still lands, and a database
 *     with no scope yet never queries at all.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const MIB: number = 1024 * 1024;

const PROJECT_ID: string = "21075038-d9f1-4d3a-b878-f64ae861f7be";
const MODEL_ID: string = "42b6aaae-7558-42fe-999b-395bbfc79d63";
const CHECKOUT_SERVICE_ID: string = "3c0e7b2a-1111-4111-8111-000000000001";
const ORDERS_DB: string = "orders-db.example.com:5432";
const ORDERS_DB_REPLICA: string = "orders-db-replica.example.com:5432";
// The member keys of the database's pods.
const ORDERS_DB_POD: string = "c281e9f63ebf20d9";
const ORDERS_DB_SECOND_POD: string = "4f1e2d3c4b5a6978";

// A time on the test's day, e.g. at("11:36") or at("12:00:30").
function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-28T${withSeconds}.000Z`);
}

// The same moment a day earlier: where "Past 1 Day" starts.
function dayBefore(time: Date): Date {
  return new Date(time.getTime() - DAY_MS);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
// Every telemetry query either page asks, as (fetcher, request).
const telemetryMock: MockFunction = getJestMockFunction();

// ProjectUtil's answer, which a row with no projectId falls back to.
let mockCurrentProjectId: string | null = PROJECT_ID;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
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
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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
        if (!mockCurrentProjectId) {
          return null;
        }
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType(mockCurrentProjectId);
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
        return new ObjectIDType("42b6aaae-7558-42fe-999b-395bbfc79d63");
      },
      navigate: (): void => {},
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

// The Service overview's span, runtime and log / exception queries.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const format: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...format,
      fetchSpanMetrics: (request: unknown): unknown => {
        return telemetryMock("span metrics", request);
      },
      fetchLogAndExceptionSignals: (request: unknown): unknown => {
        return telemetryMock("log and exception signals", request);
      },
      fetchMetricSeries: (request: unknown): unknown => {
        return mockRuntimeMetricSeries(request);
      },
    };
  },
);

// The Database overview's query, caller, engine and pod queries.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchDatabaseQueryMetrics: (request: unknown): unknown => {
        return telemetryMock("query metrics", request);
      },
      fetchDatabaseCallingServices: (request: unknown): unknown => {
        return telemetryMock("calling services", request);
      },
      fetchDatabaseEngineMetrics: (request: unknown): unknown => {
        return telemetryMock("engine metrics", request);
      },
      fetchDatabaseMetricSeries: (request: unknown): unknown => {
        return mockPodMetricSeries(request);
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

// The Service details card below the overview loads its own row.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import ServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import DatabaseServerOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  DatabaseCallingServices,
  DatabaseEngineMetricResult,
  DatabaseQueryMetrics,
  DatabaseTimePoint,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  DATABASE_RUNTIME_METRICS,
  DatabaseRuntimePlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import { LogAndExceptionSignals } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import Service from "../../../Models/DatabaseModels/Service";
import { DatabaseServerMetricDefinition } from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  AUTO_REFRESH_MS,
  advance,
  Backlog,
  expectRefreshSettled,
  refreshButton,
} from "./SlowLoadHarness";
import {
  chartWindows,
  customRangeLabel,
  doubleClick,
  dragAcross,
  flush,
  pickerLabel,
  pickPreset,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;
const PAST_HOUR: string = presetLabel(TimeRange.PAST_ONE_HOUR);
const PAST_DAY: string = presetLabel(TimeRange.PAST_ONE_DAY);

type Fetcher =
  | "span metrics"
  | "runtime metrics"
  | "log and exception signals"
  | "query metrics"
  | "calling services"
  | "engine metrics"
  | "pod CPU"
  | "pod memory";

// What the fetchers are asked; each takes a window, some a little more.
interface TelemetryRequest {
  start: Date;
  end: Date;
  // The runtime probe: which metric.
  name?: string | undefined;
  // The database's pod charts: which metric.
  metricName?: string | undefined;
  // The database's engine metrics: its engine's catalog.
  metrics?: Array<DatabaseServerMetricDefinition> | undefined;
  // Every database query: the entity keys it is scoped by.
  keys?: ReadonlyArray<string> | undefined;
}

// A telemetry query, parked until the test answers it.
interface SlowCall {
  fetcher: Fetcher;
  start: Date;
  end: Date;
}

const backlog: Backlog<SlowCall> = new Backlog<SlowCall>();

const SERVICE_FETCHERS: Array<Fetcher> = [
  "span metrics",
  "runtime metrics",
  "log and exception signals",
];
const DATABASE_FETCHERS: Array<Fetcher> = [
  "query metrics",
  "calling services",
  "engine metrics",
  "pod CPU",
  "pod memory",
];
const ALL_FETCHERS: Array<Fetcher> = [
  ...SERVICE_FETCHERS,
  ...DATABASE_FETCHERS,
];

// The fetchers whose queries wait for the test; the rest answer at once.
let slowFetchers: ReadonlyArray<Fetcher> = ALL_FETCHERS;

// What the next model fetch answers; a test may change it before a tick.
let serviceName: string = "checkout";
let serviceLanguage: string = "nodejs";
let databaseName: string = "orders-db";
let databaseEndpoints: Array<string> = [ORDERS_DB];
let databaseProjectId: string | null = PROJECT_ID;
// Its pods' member keys, each with when discovery last saw it.
let databaseMembers: Record<string, string> = {};

/*
 * The runtime metric each language's service emits, and its level. The
 * probe asks for every candidate of the service's language one after
 * another; the rest come back empty at once, as for a metric never sent.
 */
const RUNTIME_METRIC_LEVELS: Record<string, number> = {
  "nodejs.eventloop.utilization": 40,
  "go.goroutine.count": 120,
};

function mockRuntimeMetricSeries(request: unknown): Promise<unknown> {
  const name: string = (request as TelemetryRequest).name || "";

  if (RUNTIME_METRIC_LEVELS[name] === undefined) {
    return Promise.resolve([]);
  }

  return telemetryMock("runtime metrics", request) as Promise<unknown>;
}

// The database's two pod charts, told apart by the metric they ask for.
function mockPodMetricSeries(request: unknown): Promise<unknown> {
  const cpuMetric: string =
    DATABASE_RUNTIME_METRICS[DatabaseRuntimePlatform.Kubernetes].cpu.metricName;
  const fetcher: Fetcher =
    (request as TelemetryRequest).metricName === cpuMetric
      ? "pod CPU"
      : "pod memory";

  return telemetryMock(fetcher, request) as Promise<unknown>;
}

// One bucket a minute from 11:00 to 11:59: those inside [start, end].
function minutesWithin(start: Date, end: Date): Array<Date> {
  const minutes: Array<Date> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));

    if (time.getTime() >= start.getTime() && time.getTime() <= end.getTime()) {
      minutes.push(time);
    }
  }

  return minutes;
}

function seriesOf(minutes: Array<Date>, y: number): Array<DatabaseTimePoint> {
  return minutes.map((x: Date): DatabaseTimePoint => {
    return { x: x, y: y };
  });
}

/*
 * 10 requests (or queries) a minute, 1 of them failed, a 250 ms p95. Over
 * 11:00-12:00 that is 600; over 11:00:30-12:00:30 (from 11:01) 590; over
 * 11:02-12:02 580; over 11:20-11:30 (11 buckets) 110.
 */
function requestsOver(minutes: Array<Date>): DatabaseQueryMetrics {
  const total: number = 10 * minutes.length;

  return {
    total: total,
    errors: minutes.length,
    errorRatePercent: total > 0 ? 10 : null,
    p95DurationMs: total > 0 ? 250 : null,
    countSeries: seriesOf(minutes, 10),
    errorSeries: seriesOf(minutes, 1),
    p95Series: seriesOf(minutes, 250),
  };
}

function signalsOver(minutes: Array<Date>): LogAndExceptionSignals {
  return {
    logs: {
      total: 20 * minutes.length,
      errorCount: 2 * minutes.length,
      countSeries: seriesOf(minutes, 20),
      errorSeries: seriesOf(minutes, 2),
      failed: false,
    },
    exceptions: {
      total: 3 * minutes.length,
      unhandledCount: minutes.length,
      unhandledSeries: seriesOf(minutes, 1),
      handledSeries: seriesOf(minutes, 2),
      failed: false,
    },
  };
}

function callersOver(minutes: Array<Date>): DatabaseCallingServices {
  return {
    services: [
      {
        serviceId: CHECKOUT_SERVICE_ID,
        calls: 10 * minutes.length,
        errors: minutes.length,
        errorRatePercent: 10,
        p95DurationMs: 250,
      },
    ],
    total: 1,
  };
}

// The first two engine metrics have points to chart; the rest only tiles.
function engineOver(
  minutes: Array<Date>,
  request: TelemetryRequest,
): Array<DatabaseEngineMetricResult> {
  return (request.metrics || []).map(
    (
      definition: DatabaseServerMetricDefinition,
      index: number,
    ): DatabaseEngineMetricResult => {
      const series: Array<DatabaseTimePoint> =
        index < 2 ? seriesOf(minutes, 12 + index) : [];
      return {
        definition: definition,
        series: series,
        value: series.length > 0 ? 12 + index : null,
      };
    },
  );
}

// Each fetcher's answer for the minutes of the window it was asked for.
const ANSWERS: Record<
  Fetcher,
  (minutes: Array<Date>, request: TelemetryRequest) => unknown
> = {
  "span metrics": requestsOver,
  "runtime metrics": (
    minutes: Array<Date>,
    request: TelemetryRequest,
  ): unknown => {
    return seriesOf(minutes, RUNTIME_METRIC_LEVELS[request.name || ""] ?? 0);
  },
  "log and exception signals": signalsOver,
  "query metrics": requestsOver,
  "calling services": callersOver,
  "engine metrics": engineOver,
  "pod CPU": (minutes: Array<Date>): unknown => {
    return seriesOf(minutes, 0.5);
  },
  "pod memory": (minutes: Array<Date>): unknown => {
    return seriesOf(minutes, 512 * MIB);
  },
};

// A fresh object per fetch, as the API returns; seen a minute ago.
function serviceModel(): Service {
  const service: Service = new Service();
  service.name = serviceName;
  service.telemetrySdkLanguage = serviceLanguage;
  service.lastSeenAt = new Date(Date.now() - 60_000);
  return service;
}

// A Kubernetes-hosted PostgreSQL with its engine metrics connected.
function databaseRow(): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row.id = new ObjectID(MODEL_ID);
  if (databaseProjectId) {
    row.projectId = new ObjectID(databaseProjectId);
  }
  row.name = databaseName;
  row.dbSystem = "postgresql";
  row.serverAddress = "orders-db.example.com";
  row.serverPort = 5432;
  row.discoverySource = "client-spans";
  row.otelCollectorStatus = "connected";
  row.collectorLastSeenAt = new Date(Date.now() - 60_000);
  row.lastSeenAt = new Date(Date.now() - 60_000);
  row.kubernetesClusterId = new ObjectID(
    "7b2c1d4e-0000-4000-8000-00000000c1a5",
  );
  row.kubernetesNamespace = "shop";
  row.workloadKind = "StatefulSet";
  row.workloadName = "orders-db";
  row.memberEntityKeys = { ...databaseMembers };
  return row;
}

interface OverviewCase {
  Page: React.FunctionComponent<PageComponentProps>;
  // The page's telemetry queries: one load asks each of them once.
  fetchers: Array<Fetcher>;
  // The tile counting requests (Service) or queries (Database).
  countTile: string;
  // The charts a landed load draws.
  charts: number;
  // Where the page remembers the reader's auto-refresh interval.
  storageKey: string;
  // Renames the model for its next fetch.
  rename: (name: string) => void;
}

const SERVICE_OVERVIEW: OverviewCase = {
  Page: ServiceView,
  fetchers: SERVICE_FETCHERS,
  countTile: "Requests",
  // Requests, Latency (p95), Logs, Exceptions and Event loop utilization.
  charts: 5,
  storageKey: "service-overview-auto-refresh-interval",
  rename: (name: string): void => {
    serviceName = name;
  },
};

const DATABASE_OVERVIEW: OverviewCase = {
  Page: DatabaseServerOverview,
  fetchers: DATABASE_FETCHERS,
  countTile: "Queries",
  // Queries, p95, the pods' CPU and memory, and two engine metrics.
  charts: 6,
  storageKey: "database-overview-auto-refresh-interval",
  rename: (name: string): void => {
    databaseName = name;
  },
};

const OVERVIEWS: Array<[string, OverviewCase]> = [
  ["Service overview", SERVICE_OVERVIEW],
  ["Database overview", DATABASE_OVERVIEW],
];

function endsAt(end: Date): (call: SlowCall) => boolean {
  return (call: SlowCall): boolean => {
    return call.end.getTime() === end.getTime();
  };
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

function tileOf(title: string): HTMLElement {
  // The first "About <title>" is the tile's; a chart card may share it.
  return screen
    .getAllByRole("button", { name: `About ${title}` })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

// The figure a tile shows; null while it loads.
function tileValue(title: string): string | null {
  const value: Element | null = tileOf(title).querySelector(".text-2xl");
  return value ? (value.textContent || "").trim() : null;
}

// No load has landed yet: the count tile loads, and no chart is drawn.
function expectNothingPainted(overview: OverviewCase): void {
  expect(tileOf(overview.countTile)).toHaveAttribute("aria-busy", "true");
  expect(tileValue(overview.countTile)).toBeNull();
  expect(zoomCharts()).toHaveLength(0);
}

// The newest load has landed: its count on the tile, every chart over it.
function expectPainted(
  overview: OverviewCase,
  count: string,
  window: [string, string],
): void {
  expect(tileOf(overview.countTile)).toHaveAttribute("aria-busy", "false");
  expect(tileValue(overview.countTile)).toBe(count);
  expect(chartWindows()).toEqual(same(window, overview.charts));
}

// The newest load still runs: the count tile loads.
function expectLoading(overview: OverviewCase): void {
  expect(tileOf(overview.countTile)).toHaveAttribute("aria-busy", "true");
}

// The telemetry requests one fetcher was asked, oldest first.
function requestsTo(fetcher: Fetcher): Array<TelemetryRequest> {
  return telemetryMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === fetcher;
    })
    .map((call: Array<unknown>): TelemetryRequest => {
      return call[1] as TelemetryRequest;
    });
}

function modelLoads(): number {
  return getItemMock.mock.calls.length;
}

async function mount(overview: OverviewCase): Promise<void> {
  render(
    <MemoryRouter>
      <overview.Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

// Renders the page with its first load answered at once.
async function mountPainted(overview: OverviewCase): Promise<void> {
  slowFetchers = [];
  await mount(overview);
  expectPainted(overview, "600", windowOf(at("11:00"), NOW));
  slowFetchers = ALL_FETCHERS;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  telemetryMock.mockReset();
  backlog.clear();
  slowFetchers = ALL_FETCHERS;
  serviceName = "checkout";
  serviceLanguage = "nodejs";
  databaseName = "orders-db";
  databaseEndpoints = [ORDERS_DB];
  databaseProjectId = PROJECT_ID;
  databaseMembers = { [ORDERS_DB_POD]: "2026-09-28T11:00:00.000Z" };
  mockCurrentProjectId = PROJECT_ID;

  getItemMock.mockImplementation((request: unknown): Promise<unknown> => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;
    return Promise.resolve(
      modelType === DatabaseServer ? databaseRow() : serviceModel(),
    );
  });

  getListMock.mockImplementation((request: unknown): Promise<unknown> => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;

    if (modelType === DatabaseServerEndpoint) {
      const rows: Array<DatabaseServerEndpoint> = databaseEndpoints.map(
        (value: string): DatabaseServerEndpoint => {
          const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
          row.endpoint = value;
          return row;
        },
      );
      return Promise.resolve({ data: rows, count: rows.length });
    }

    // The calling services' names.
    const checkout: Service = new Service();
    checkout._id = CHECKOUT_SERVICE_ID;
    checkout.name = "checkout";
    return Promise.resolve({ data: [checkout], count: 1 });
  });

  telemetryMock.mockImplementation(
    (fetcher: unknown, request: unknown): Promise<unknown> => {
      const which: Fetcher = fetcher as Fetcher;
      const call: TelemetryRequest = request as TelemetryRequest;
      // Worked out when asked, so it holds the rows of the window asked for.
      const answer: unknown = ANSWERS[which](
        minutesWithin(call.start, call.end),
        call,
      );

      if (slowFetchers.includes(which)) {
        return backlog.park(
          { fetcher: which, start: call.start, end: call.end },
          answer,
        );
      }

      return Promise.resolve(answer);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(OVERVIEWS)(
  "%s: telemetry that outlasts the auto-refresh",
  (_name: string, overview: OverviewCase) => {
    const perLoad: number = overview.fetchers.length;

    test("a tick while the load runs leaves it alone; it lands, fills the tiles and draws every chart", async () => {
      await mount(overview);

      expect(backlog.calls()).toHaveLength(perLoad);
      expectNothingPainted(overview);
      const loadsBefore: number = modelLoads();

      await advance(AUTO_REFRESH_MS);

      // The model reloaded; the telemetry load was left to run.
      expect(modelLoads()).toBe(loadsBefore + 1);
      expect(backlog.calls()).toHaveLength(perLoad);
      expectRefreshSettled();

      await advance(5_000);
      await backlog.release(endsAt(NOW));

      expectPainted(overview, "600", windowOf(at("11:00"), NOW));
      expectRefreshSettled();
    });

    test("the model still reloads on every tick while the load runs, and the hero shows what it brings", async () => {
      await mount(overview);
      const loadsBefore: number = modelLoads();
      overview.rename("payments");

      await advance(AUTO_REFRESH_MS);
      await advance(AUTO_REFRESH_MS);

      expect(modelLoads()).toBe(loadsBefore + 2);
      expect(
        screen.getByRole("heading", { level: 1, name: "payments" }),
      ).toBeInTheDocument();
      // All the while, one telemetry load: the first.
      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(NOW))).toBe(true);
    });

    test("a load that outlasts three ticks still lands and paints", async () => {
      await mount(overview);

      await advance(3 * AUTO_REFRESH_MS + 5_000);

      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(NOW))).toBe(true);
      expectNothingPainted(overview);

      await backlog.release(endsAt(NOW));

      expectPainted(overview, "600", windowOf(at("11:00"), NOW));
      expectRefreshSettled();
    });

    test("after a load that outlasted three ticks lands, the next tick loads the slid hour exactly once, and the tick after waits for it", async () => {
      await mount(overview);

      await advance(3 * AUTO_REFRESH_MS + 5_000);
      expect(backlog.calls()).toHaveLength(perLoad);
      await backlog.release(endsAt(NOW));
      expect(tileValue(overview.countTile)).toBe("600");

      // 12:02:00: one tick, one load, for the hour up to it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(at("12:02")))).toBe(true);

      // 12:02:30: still running, so this tick leaves it alone.
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(perLoad);

      await backlog.release(endsAt(at("12:02")));
      expectPainted(overview, "580", windowOf(at("11:02"), at("12:02")));
    });

    test("each tick once the load has landed loads the slid hour", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);

      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(at("12:00:30")))).toBe(true);
      await backlog.release(endsAt(at("12:00:30")));
      expectPainted(overview, "590", windowOf(at("11:00:30"), at("12:00:30")));
    });

    test("a drag during a slow auto-refresh load wins when its answer lands first", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      expect(backlog.calls()).toHaveLength(2 * perLoad);

      await backlog.release(endsAt(at("11:30")));
      await backlog.release(endsAt(at("12:00:30")));

      expectPainted(overview, "110", windowOf(at("11:20"), at("11:30")));
      expect(pickerLabel()).toBe(customRangeLabel(at("11:20"), at("11:30")));
    });

    test("a drag during a slow auto-refresh load wins when the older answer lands first", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

      await backlog.release(endsAt(at("12:00:30")));
      // The replaced load is dropped: the tiles still wait for the zoom's.
      expectLoading(overview);

      await backlog.release(endsAt(at("11:30")));
      expectPainted(overview, "110", windowOf(at("11:20"), at("11:30")));
    });

    test("the replaced load landing does not let the next tick replace the zoom's load, which still lands", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      await advance(5_000);
      await backlog.release(endsAt(at("12:00:30")));

      // 12:01:00: the zoom's load is still running; the tick leaves it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(at("11:30")))).toBe(true);

      await backlog.release(endsAt(at("11:30")));
      expectPainted(overview, "110", windowOf(at("11:20"), at("11:30")));
      expect(resetZoomButtons()).toHaveLength(1);
    });

    test("a double-click during the zoom's slow load puts the hour back, and that load wins", async () => {
      await mountPainted(overview);

      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      await advance(AUTO_REFRESH_MS);
      // The tick left the zoom's load alone.
      expect(backlog.calls()).toHaveLength(perLoad);

      await doubleClick(zoomCharts()[1]!);
      await backlog.release(endsAt(at("12:00:30")));
      await backlog.release(endsAt(at("11:30")));

      expectPainted(overview, "590", windowOf(at("11:00:30"), at("12:00:30")));
      expect(pickerLabel()).toBe(PAST_HOUR);
      expect(resetZoomButtons()).toHaveLength(0);
    });

    test("the picker during a slow auto-refresh load wins over it", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await advance(2_000);
      await pickPreset(PAST_DAY);
      expect(backlog.calls()).toHaveLength(2 * perLoad);

      await backlog.release(endsAt(at("12:00:32")));
      await backlog.release(endsAt(at("12:00:30")));

      expectPainted(
        overview,
        "600",
        windowOf(dayBefore(at("12:00:32")), at("12:00:32")),
      );
      expect(pickerLabel()).toBe(PAST_DAY);
    });

    test("a pick during the first slow load wins over it, and the next tick leaves the pick's load alone", async () => {
      await mount(overview);

      await advance(10_000);
      await pickPreset(PAST_DAY);
      expect(backlog.calls()).toHaveLength(2 * perLoad);

      // 12:00:30: the pick's load is running; the tick leaves it.
      await advance(20_000);
      expect(backlog.calls()).toHaveLength(2 * perLoad);

      await backlog.release(endsAt(at("12:00:10")));
      await backlog.release(endsAt(NOW));

      expectPainted(
        overview,
        "600",
        windowOf(dayBefore(at("12:00:10")), at("12:00:10")),
      );
      expect(pickerLabel()).toBe(PAST_DAY);
    });

    test("Refresh during a slow load replaces it at once, and the newer answer wins", async () => {
      await mount(overview);
      await advance(10_000);

      fireEvent.click(refreshButton());
      await flush();
      expect(backlog.calls()).toHaveLength(2 * perLoad);
      // The model reloaded at once; Refresh is not left spinning.
      expectRefreshSettled();

      // The first load, for the hour up to 12:00:00, is not drawn...
      await backlog.release(endsAt(NOW));
      expectNothingPainted(overview);

      // ...the Refresh's, for the hour up to 12:00:10, is.
      await backlog.release(endsAt(at("12:00:10")));
      expectPainted(overview, "590", windowOf(at("11:00:10"), at("12:00:10")));
    });

    test("Refresh pressed shortly before a tick: the tick leaves the Refresh's load alone, and it lands", async () => {
      await mountPainted(overview);

      await advance(25_000);
      fireEvent.click(refreshButton());
      await flush();
      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(at("12:00:25")))).toBe(true);

      // 12:00:30: the tick reloads the model and leaves the telemetry alone...
      await advance(5_000);
      expect(backlog.calls()).toHaveLength(perLoad);

      // ...whose answer lands at 12:00:35 and is drawn.
      await advance(5_000);
      await backlog.release(endsAt(at("12:00:25")));
      expectPainted(overview, "590", windowOf(at("11:00:25"), at("12:00:25")));
      expectRefreshSettled();
    });

    test("a drag shortly before a tick: the tick leaves the zoom's load alone, and it lands", async () => {
      await mountPainted(overview);

      await advance(25_000);
      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      expect(backlog.calls()).toHaveLength(perLoad);

      // 12:00:30: the tick would load the zoomed window again; it waits.
      await advance(5_000);
      expect(backlog.calls()).toHaveLength(perLoad);

      await advance(5_000);
      await backlog.release(endsAt(at("11:30")));
      expectPainted(overview, "110", windowOf(at("11:20"), at("11:30")));
      expect(pickerLabel()).toBe(customRangeLabel(at("11:20"), at("11:30")));
    });

    test("on a remembered 10-second interval, a load that outlasts two ticks still lands, and the ticks go on after it", async () => {
      window.localStorage.setItem(overview.storageKey, "10s");
      await mount(overview);

      // The ticks at 12:00:10 and 12:00:20 leave the first load alone.
      await advance(25_000);
      expect(backlog.calls()).toHaveLength(perLoad);

      await backlog.release(endsAt(NOW));
      expectPainted(overview, "600", windowOf(at("11:00"), NOW));

      // 12:00:30: nothing is running, so the tick loads the slid hour.
      await advance(5_000);
      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(at("12:00:30")))).toBe(true);
    });

    test("a failed load settles too: the charts leave their skeletons, and the next tick loads again", async () => {
      await mount(overview);
      await advance(5_000);

      await backlog.fail(endsAt(NOW), new Error("ClickHouse is down"));

      expect(tileOf(overview.countTile)).toHaveAttribute("aria-busy", "false");
      expect(tileValue(overview.countTile)).toBe("—");
      expect(screen.getAllByText("No data in this time range")).toHaveLength(4);

      // 12:00:30: nothing is running any more, so the tick loads again.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(perLoad);
      expect(backlog.calls().every(endsAt(at("12:00:30")))).toBe(true);
    });

    test("with auto-refresh off, a slow load lands as it always did", async () => {
      window.localStorage.setItem(overview.storageKey, "off");
      await mount(overview);
      const loadsBefore: number = modelLoads();

      await advance(5 * AUTO_REFRESH_MS);
      expect(modelLoads()).toBe(loadsBefore);
      expect(backlog.calls()).toHaveLength(perLoad);

      await backlog.release(endsAt(NOW));
      expectPainted(overview, "600", windowOf(at("11:00"), NOW));
    });
  },
);

/*
 * One slow query holds the whole load: the page draws a load only once
 * every query in it has answered, so each must be left to run.
 */
const SLOW_QUERIES: Array<[string, Fetcher, OverviewCase]> = OVERVIEWS.flatMap(
  ([name, overview]: [string, OverviewCase]): Array<
    [string, Fetcher, OverviewCase]
  > => {
    return overview.fetchers.map(
      (fetcher: Fetcher): [string, Fetcher, OverviewCase] => {
        return [name, fetcher, overview];
      },
    );
  },
);

describe.each(SLOW_QUERIES)(
  "%s, only its %s slower than the auto-refresh",
  (_name: string, fetcher: Fetcher, overview: OverviewCase) => {
    test("the ticks leave the load alone, and it lands", async () => {
      slowFetchers = [fetcher];
      await mount(overview);

      expect(backlog.calls()).toEqual([
        { fetcher: fetcher, start: at("11:00"), end: NOW },
      ]);

      await advance(AUTO_REFRESH_MS);
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(1);
      expectNothingPainted(overview);

      await backlog.release(endsAt(NOW));
      expectPainted(overview, "600", windowOf(at("11:00"), NOW));
    });
  },
);

describe("Service overview: what scopes its metrics", () => {
  test("a reload that finds another language replaces the running load at once, and the new runtime charts win", async () => {
    await mount(SERVICE_OVERVIEW);
    expect(backlog.calls()).toHaveLength(3);

    serviceLanguage = "go";
    await advance(AUTO_REFRESH_MS);

    // The Node.js load is dropped for a Go one, over the hour up to now.
    expect(backlog.calls()).toHaveLength(6);
    expect(
      requestsTo("runtime metrics").map((request: TelemetryRequest) => {
        return request.name;
      }),
    ).toEqual(["nodejs.eventloop.utilization", "go.goroutine.count"]);

    await backlog.release(endsAt(NOW));
    expectLoading(SERVICE_OVERVIEW);

    await backlog.release(endsAt(at("12:00:30")));
    expectPainted(
      SERVICE_OVERVIEW,
      "590",
      windowOf(at("11:00:30"), at("12:00:30")),
    );
    expect(screen.getAllByText("Goroutines").length).toBeGreaterThan(0);
    expect(screen.queryByText("Event loop utilization")).toBeNull();
  });
});

describe("Database overview: what scopes its telemetry", () => {
  test("a reload that brings a new endpoint replaces the running load at once, scoped by it too", async () => {
    await mount(DATABASE_OVERVIEW);
    expect(backlog.calls()).toHaveLength(5);
    const keysBefore: number = requestsTo("query metrics")[0]!.keys!.length;

    databaseEndpoints = [ORDERS_DB, ORDERS_DB_REPLICA];
    await advance(AUTO_REFRESH_MS);

    expect(backlog.calls()).toHaveLength(10);
    const queries: Array<TelemetryRequest> = requestsTo("query metrics");
    expect(queries).toHaveLength(2);
    expect(queries[1]!.keys).toHaveLength(keysBefore + 1);

    await backlog.release(endsAt(NOW));
    expectLoading(DATABASE_OVERVIEW);

    await backlog.release(endsAt(at("12:00:30")));
    expectPainted(
      DATABASE_OVERVIEW,
      "590",
      windowOf(at("11:00:30"), at("12:00:30")),
    );
  });

  test("a reload that only re-stamps when its pod was last seen leaves the running load alone", async () => {
    await mount(DATABASE_OVERVIEW);
    expect(backlog.calls()).toHaveLength(5);

    // Discovery saw the same pod again: a new time, the same member key.
    databaseMembers = { [ORDERS_DB_POD]: "2026-09-28T12:00:20.000Z" };
    await advance(AUTO_REFRESH_MS);

    expect(backlog.calls()).toHaveLength(5);
    expect(backlog.calls().every(endsAt(NOW))).toBe(true);

    await backlog.release(endsAt(NOW));
    expectPainted(DATABASE_OVERVIEW, "600", windowOf(at("11:00"), NOW));
  });

  test("a reload that finds another pod replaces the running load at once, and its pod charts cover both pods", async () => {
    await mount(DATABASE_OVERVIEW);
    expect(requestsTo("pod CPU")[0]!.keys).toEqual([ORDERS_DB_POD]);

    databaseMembers = {
      [ORDERS_DB_POD]: "2026-09-28T12:00:20.000Z",
      [ORDERS_DB_SECOND_POD]: "2026-09-28T12:00:20.000Z",
    };
    await advance(AUTO_REFRESH_MS);

    expect(backlog.calls()).toHaveLength(10);
    expect([...requestsTo("pod CPU")[1]!.keys!].sort()).toEqual(
      [ORDERS_DB_POD, ORDERS_DB_SECOND_POD].sort(),
    );

    await backlog.release(endsAt(NOW));
    expectLoading(DATABASE_OVERVIEW);

    await backlog.release(endsAt(at("12:00:30")));
    expectPainted(
      DATABASE_OVERVIEW,
      "590",
      windowOf(at("11:00:30"), at("12:00:30")),
    );
  });

  test("a database with no scope yet never queries its telemetry, tick or Refresh", async () => {
    databaseProjectId = null;
    mockCurrentProjectId = null;
    await mount(DATABASE_OVERVIEW);

    await advance(AUTO_REFRESH_MS);
    fireEvent.click(refreshButton());
    await flush();
    await advance(AUTO_REFRESH_MS);

    expect(telemetryMock).not.toHaveBeenCalled();
    expect(tileOf("Queries")).toHaveAttribute("aria-busy", "false");
    expect(tileValue("Queries")).toBe("—");
    expect(
      screen.getByTestId("database-server-unscoped-banner"),
    ).toHaveAttribute("data-variant", "unscoped");
  });
});
