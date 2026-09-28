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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on a database's Overview: every chart on the page - the two
 * query charts, the runtime CPU / memory charts and each engine metric chart
 * - shares ONE zoom over the page's range. A drag on any of them narrows the
 * range, and every tile, card and section (they are all fetched over that
 * one range) follows; a double-click on any chart, or "Reset zoom" beside
 * the picker, puts back the range the page had before the first zoom.
 *
 * Only the network is replaced: the telemetry fetchers (so the window each
 * section asks for can be read off their calls), the model API and the
 * activity cards. The page, ResourceOverview, ChartCard, the runtime and
 * engine sections and the real time picker all render for real. The chart
 * library's line chart is stood in for by ChartZoomStandIn, which resolves
 * its zoom exactly as the real wrapper does, with a button that performs a
 * drag and a plot that takes a double-click.
 */

const MODEL_ID: string = "42b6aaae-7558-42fe-999b-395bbfc79d63";
const PROJECT_ID: string = "21075038-d9f1-4d3a-b878-f64ae861f7be";

const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:35:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:25:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");

const QUERIES_CHART: string = "Queries + Errors";
const P95_CHART: string = "p95 [ms]";
const CPU_CHART: string = "CPU per pod";
const MEMORY_CHART: string = "Memory per pod";
const CONNECTIONS_CHART: string = "Connections";
const MAX_CONNECTIONS_CHART: string = "Max connections";

const ALL_CHARTS: Array<string> = [
  QUERIES_CHART,
  P95_CHART,
  CPU_CHART,
  MEMORY_CHART,
  CONNECTIONS_CHART,
  MAX_CONNECTIONS_CHART,
];

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const queryMetricsMock: MockFunction = getJestMockFunction();
const callingServicesMock: MockFunction = getJestMockFunction();
const engineMetricsMock: MockFunction = getJestMockFunction();
const metricSeriesMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Line/LineChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchDatabaseQueryMetrics: (...args: Array<unknown>): unknown => {
        return queryMetricsMock(...args);
      },
      fetchDatabaseCallingServices: (...args: Array<unknown>): unknown => {
        return callingServicesMock(...args);
      },
      fetchDatabaseEngineMetrics: (...args: Array<unknown>): unknown => {
        return engineMetricsMock(...args);
      },
      fetchDatabaseMetricSeries: (...args: Array<unknown>): unknown => {
        return metricSeriesMock(...args);
      },
    };
  },
);

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
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
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
        return new ObjectIDType("21075038-d9f1-4d3a-b878-f64ae861f7be");
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="page-loader" />;
    },
  };
});

/*
 * The hero's refresh control: renders the picker it is handed and a
 * "Refresh now" button, which is what an auto-refresh tick calls too.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        timeRangePicker?: React.ReactNode;
        onManualRefresh: () => void;
      }): React.ReactElement => {
        return (
          <div data-testid="auto-refresh">
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
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="activity-cards" />;
      },
    };
  },
);

import DatabaseServerOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  StandInChartRecord,
  getStandInChart,
  resetStandInCharts,
  standInDrag,
} from "./ChartZoomStandIn";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import Service from "../../../Models/DatabaseModels/Service";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

const PICKER_BUTTON_TEST_ID: string = "telemetry-time-range-picker-button";

interface FetchWindow {
  start: Date;
  end: Date;
}

function windowOf(call: Array<unknown> | undefined): FetchWindow {
  if (!call) {
    throw new Error("The fetcher was never called");
  }
  const request: FetchWindow = call[0] as FetchWindow;
  return { start: request.start, end: request.end };
}

function lastWindow(mock: MockFunction): FetchWindow {
  return windowOf(mock.mock.calls[mock.mock.calls.length - 1]);
}

function minutesOf(window: FetchWindow): number {
  return (window.end.getTime() - window.start.getTime()) / MINUTE;
}

function point(at: Date, y: number): { x: Date; y: number } {
  return { x: new Date(at.getTime() + MINUTE), y: y };
}

// A Kubernetes-hosted PostgreSQL with its engine metrics connected.
function databaseRow(): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row.id = new ObjectID(MODEL_ID);
  row.projectId = new ObjectID(PROJECT_ID);
  row.name = "orders-db";
  row.dbSystem = "postgresql";
  row.serverAddress = "orders-db.example.com";
  row.serverPort = 5432;
  row.discoverySource = "client-spans";
  row.otelCollectorStatus = "connected";
  row.collectorLastSeenAt = new Date(NOW.getTime() - MINUTE);
  row.lastSeenAt = new Date(NOW.getTime() - MINUTE);
  row.kubernetesClusterId = new ObjectID(
    "7b2c1d4e-0000-4000-8000-00000000c1a5",
  );
  row.kubernetesNamespace = "shop";
  row.workloadKind = "StatefulSet";
  row.workloadName = "orders-db";
  row.memberEntityKeys = { c281e9f63ebf20d9: "2026-09-28T11:00:00.000Z" };
  return row;
}

const ENGINE_DEFINITIONS: Array<DatabaseServerMetricDefinition> =
  getDatabaseServerMetrics("postgresql");

function arrange(): void {
  getItemMock.mockResolvedValue(databaseRow());

  getListMock.mockImplementation(async (request: unknown) => {
    const modelType: unknown = (request as { modelType?: unknown }).modelType;
    if (modelType === DatabaseServerEndpoint) {
      const endpoint: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      endpoint.endpoint = "orders-db.example.com:5432";
      return { data: [endpoint], count: 1 };
    }
    if (modelType === Service) {
      const checkout: Service = new Service();
      checkout._id = "3c0e7b2a-1111-4111-8111-000000000001";
      checkout.name = "checkout";
      const billing: Service = new Service();
      billing._id = "3c0e7b2a-1111-4111-8111-000000000002";
      billing.name = "billing";
      return { data: [checkout, billing], count: 2 };
    }
    return { data: [], count: 0 };
  });

  /*
   * Every figure depends on the window asked for, so a tile or card that
   * did not follow the zoom would show the wrong number.
   */
  queryMetricsMock.mockImplementation(async (window: unknown) => {
    const w: FetchWindow = window as FetchWindow;
    return {
      total: minutesOf(w) * 7,
      errors: 1,
      errorRatePercent: 1,
      p95DurationMs: 12,
      countSeries: [point(w.start, minutesOf(w) * 7)],
      errorSeries: [point(w.start, 1)],
      p95Series: [point(w.start, 12)],
    };
  });

  callingServicesMock.mockImplementation(async (window: unknown) => {
    const w: FetchWindow = window as FetchWindow;
    const zoomed: boolean = minutesOf(w) < 60;
    const services: Array<Record<string, unknown>> = [
      {
        serviceId: "3c0e7b2a-1111-4111-8111-000000000001",
        calls: 40,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 10,
      },
    ];
    if (!zoomed) {
      services.push({
        serviceId: "3c0e7b2a-1111-4111-8111-000000000002",
        calls: 20,
        errors: 1,
        errorRatePercent: 5,
        p95DurationMs: 20,
      });
    }
    return { services: services, total: services.length };
  });

  engineMetricsMock.mockImplementation(async (window: unknown) => {
    const w: FetchWindow = window as FetchWindow;
    return ENGINE_DEFINITIONS.map(
      (definition: DatabaseServerMetricDefinition, index: number) => {
        // Two engine metrics have points to chart; the rest only tiles.
        const series: Array<{ x: Date; y: number }> =
          index < 2 ? [point(w.start, 10 + index)] : [];
        return {
          definition: definition,
          series: series,
          value: series.length > 0 ? 10 + index : null,
        };
      },
    );
  });

  metricSeriesMock.mockImplementation(async (window: unknown) => {
    const w: FetchWindow = window as FetchWindow;
    return [point(w.start, 0.5)];
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <DatabaseServerOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
  await waitFor(() => {
    for (const chart of ALL_CHARTS) {
      expect(screen.getByTestId(`chart ${chart}`)).toBeInTheDocument();
    }
  });
}

interface ChartSeen {
  zoom: StandInChartRecord["zoom"];
  windowStart: Date;
  windowEnd: Date;
}

// What the named chart was last rendered with: its zoom and its window.
function chart(name: string): ChartSeen {
  const record: StandInChartRecord = getStandInChart(name);
  return {
    zoom: record.zoom,
    windowStart: record.props.xAxis.options.min as Date,
    windowEnd: record.props.xAxis.options.max as Date,
  };
}

async function dragAcross(
  name: string,
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(screen.getByRole("button", { name: `Drag across ${name}` }));
  await flush();
}

async function doubleClick(name: string): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId(`chart ${name}`));
  await flush();
}

function pickerLabel(): string {
  return screen.getByTestId(PICKER_BUTTON_TEST_ID).textContent || "";
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function tileValue(title: string): string {
  const tile: HTMLElement | null = screen
    .getByRole("button", { name: `About ${title}` })
    .closest("div.rounded-xl");
  if (!tile) {
    throw new Error(`No tile titled ${title}`);
  }
  return (
    (tile.querySelector("div.text-2xl") as HTMLElement | null)?.textContent ||
    ""
  );
}

// Every section's fetcher, by name, with its latest window.
function sectionWindows(): Record<string, FetchWindow> {
  const cpuAndMemory: Array<Array<unknown>> = metricSeriesMock.mock.calls;
  return {
    queries: lastWindow(queryMetricsMock),
    callingServices: lastWindow(callingServicesMock),
    engine: lastWindow(engineMetricsMock),
    cpu: windowOf(cpuAndMemory[cpuAndMemory.length - 2]),
    memory: windowOf(cpuAndMemory[cpuAndMemory.length - 1]),
  };
}

function expectEverySectionOn(start: Date, end: Date): void {
  for (const [section, window] of Object.entries(sectionWindows())) {
    expect([
      section,
      window.start.toISOString(),
      window.end.toISOString(),
    ]).toEqual([section, start.toISOString(), end.toISOString()]);
  }
}

function expectEverySectionOnThePastHour(): void {
  for (const [section, window] of Object.entries(sectionWindows())) {
    expect([section, minutesOf(window)]).toEqual([section, 60]);
    // The past hour resolves against the clock again: it ends now.
    expect(window.end.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(window.end.getTime()).toBeLessThan(NOW.getTime() + 10 * MINUTE);
  }
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  for (const mock of [
    getItemMock,
    getListMock,
    queryMetricsMock,
    callingServicesMock,
    engineMetricsMock,
    metricSeriesMock,
  ]) {
    mock.mockReset();
  }
  resetStandInCharts();
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Database Overview: one zoom for every chart on the page", () => {
  test("every chart - query, runtime and engine - takes the same page zoom", async () => {
    await renderOverview();

    const select: unknown = chart(QUERIES_CHART).zoom.onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    for (const name of ALL_CHARTS) {
      expect([name, chart(name).zoom.onTimeRangeSelect]).toEqual([
        name,
        select,
      ]);
      // Nothing to undo yet, so no chart holds its clicks for a reset.
      expect([name, chart(name).zoom.onTimeRangeReset]).toEqual([
        name,
        undefined,
      ]);
    }
  });

  test("every chart card names the gesture, and the picker offers no reset before a zoom", async () => {
    await renderOverview();

    const hints: Array<HTMLElement> = screen.getAllByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );
    expect(hints).toHaveLength(ALL_CHARTS.length);
    for (const hint of hints) {
      expect(hint).toHaveTextContent(/^Drag to zoom$/);
    }
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(resetButtons()).toHaveLength(0);
  });

  test("the page starts on the past hour, for every section", async () => {
    await renderOverview();

    expectEverySectionOnThePastHour();
    expect(chart(QUERIES_CHART).windowEnd.getTime()).toBe(NOW.getTime());
  });

  test("a drag on one chart re-fetches every section over the dragged window", async () => {
    await renderOverview();
    const fetchesBefore: number = queryMetricsMock.mock.calls.length;

    await dragAcross(QUERIES_CHART);

    expect(queryMetricsMock.mock.calls.length).toBe(fetchesBefore + 1);
    expectEverySectionOn(ZOOM_START, ZOOM_END);
  });

  test("after a drag every chart draws the dragged window, and the picker says so", async () => {
    await renderOverview();

    await dragAcross(P95_CHART);

    await waitFor(() => {
      for (const name of ALL_CHARTS) {
        expect([name, chart(name).windowStart.toISOString()]).toEqual([
          name,
          ZOOM_START.toISOString(),
        ]);
        expect([name, chart(name).windowEnd.toISOString()]).toEqual([
          name,
          ZOOM_END.toISOString(),
        ]);
      }
    });
    expect(pickerLabel()).toBe(
      getTimeRangeButtonLabel({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(ZOOM_START, ZOOM_END),
      }),
    );
    expect(resetButtons()).toHaveLength(1);
    expect(resetButtons()[0]).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_ONE_HOUR}, the time range before the zoom`,
    );
  });

  test("while zoomed every chart offers the reset, and the hints say so", async () => {
    await renderOverview();

    await dragAcross(CPU_CHART);

    await waitFor(() => {
      for (const name of ALL_CHARTS) {
        expect([name, typeof chart(name).zoom.onTimeRangeReset]).toEqual([
          name,
          "function",
        ]);
      }
    });
    for (const hint of screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)) {
      expect(hint).toHaveTextContent("Drag to zoom · double-click to reset");
    }
  });

  test("the tiles and the calling-services card follow the zoom", async () => {
    await renderOverview();

    expect(tileValue("Queries")).toBe("420");
    expect(tileValue("Calling services")).toBe("2");
    expect(screen.getAllByTestId("database-calling-service-row")).toHaveLength(
      2,
    );

    await dragAcross(MEMORY_CHART);

    await waitFor(() => {
      expect(tileValue("Queries")).toBe("105");
    });
    expect(tileValue("Calling services")).toBe("1");
    expect(screen.getAllByTestId("database-calling-service-row")).toHaveLength(
      1,
    );
  });

  test("a double-click on a DIFFERENT chart puts the original range back", async () => {
    await renderOverview();

    await dragAcross(QUERIES_CHART);
    expectEverySectionOn(ZOOM_START, ZOOM_END);

    await waitFor(() => {
      expect(chart(CONNECTIONS_CHART).zoom.onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });
    await doubleClick(CONNECTIONS_CHART);

    expectEverySectionOnThePastHour();
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(resetButtons()).toHaveLength(0);
    await waitFor(() => {
      expect(tileValue("Queries")).toBe("420");
    });
  });

  test("once reset, the charts stop holding their clicks for a reset", async () => {
    await renderOverview();

    await dragAcross(QUERIES_CHART);
    await waitFor(() => {
      expect(chart(MEMORY_CHART).zoom.onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });
    await doubleClick(MEMORY_CHART);

    await waitFor(() => {
      for (const name of ALL_CHARTS) {
        expect([name, chart(name).zoom.onTimeRangeReset]).toEqual([
          name,
          undefined,
        ]);
      }
    });
  });

  test("a double-click with nothing to undo does not retime the page", async () => {
    await renderOverview();
    const fetchesBefore: number = queryMetricsMock.mock.calls.length;

    await doubleClick(P95_CHART);

    expect(queryMetricsMock.mock.calls.length).toBe(fetchesBefore);
    expect(pickerLabel()).toBe("Past 1 Hour");
  });

  test("Reset zoom beside the picker puts the range back too", async () => {
    await renderOverview();

    await dragAcross(CPU_CHART);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expectEverySectionOnThePastHour();
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(resetButtons()).toHaveLength(0);
  });

  test("a zoom within a zoom: one reset returns to the range before the first", async () => {
    await renderOverview();

    await dragAcross(QUERIES_CHART);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: `Drag across ${CPU_CHART}` }),
      ).toBeInTheDocument();
    });
    await dragAcross(CPU_CHART, INNER_ZOOM_START, INNER_ZOOM_END);
    expectEverySectionOn(INNER_ZOOM_START, INNER_ZOOM_END);
    expect(resetButtons()[0]).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_ONE_HOUR}, the time range before the zoom`,
    );

    await waitFor(() => {
      expect(chart(P95_CHART).zoom.onTimeRangeReset).toBeInstanceOf(Function);
    });
    await doubleClick(P95_CHART);

    expectEverySectionOnThePastHour();
    expect(pickerLabel()).toBe("Past 1 Hour");
  });

  test("picking a range in the picker ends the zoom; it is the new starting point", async () => {
    await renderOverview();

    await dragAcross(QUERIES_CHART);
    expect(resetButtons()).toHaveLength(1);

    fireEvent.click(screen.getByTestId(PICKER_BUTTON_TEST_ID));
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Day" }));
    await flush();

    expect(pickerLabel()).toBe("Past 1 Day");
    expect(resetButtons()).toHaveLength(0);
    for (const [section, window] of Object.entries(sectionWindows())) {
      expect([section, minutesOf(window)]).toEqual([section, 24 * 60]);
    }
    await waitFor(() => {
      expect(chart(QUERIES_CHART).zoom.onTimeRangeReset).toBeUndefined();
    });
  });

  test("a refresh while zoomed keeps the zoomed window pinned", async () => {
    await renderOverview();

    await dragAcross(QUERIES_CHART);
    const fetchesBefore: number = queryMetricsMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    // The refresh re-read everything, over the same zoomed window.
    expect(queryMetricsMock.mock.calls.length).toBeGreaterThan(fetchesBefore);
    expectEverySectionOn(ZOOM_START, ZOOM_END);
    expect(resetButtons()).toHaveLength(1);

    // And the zoom still resets to where it started.
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();
    expectEverySectionOnThePastHour();
  });

  test("a zoom into a quiet stretch still has a way back: the empty chart takes the double-click", async () => {
    await renderOverview();

    // The p95 series is empty in the zoomed window.
    queryMetricsMock.mockImplementation(async (window: unknown) => {
      const w: FetchWindow = window as FetchWindow;
      return {
        total: minutesOf(w) * 7,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: null,
        countSeries: [point(w.start, minutesOf(w) * 7)],
        errorSeries: [],
        p95Series: minutesOf(w) < 60 ? [] : [point(w.start, 12)],
      };
    });

    await dragAcross(QUERIES_CHART);

    const empty: HTMLElement = await screen.findByText(
      "No data in this time range",
    );
    fireEvent.doubleClick(empty);
    await flush();

    expectEverySectionOnThePastHour();
    expect(resetButtons()).toHaveLength(0);
  });

  test("the zoom is the page's alone: the picker, hero and sections share it", async () => {
    await renderOverview();

    await dragAcross(MAX_CONNECTIONS_CHART);

    // The one reset button sits in the hero, beside the picker.
    const controls: HTMLElement = screen.getByTestId(
      "resource-overview-controls",
    );
    expect(
      within(controls).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(
      within(controls).getByTestId(PICKER_BUTTON_TEST_ID),
    ).toHaveTextContent(
      getTimeRangeButtonLabel({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(ZOOM_START, ZOOM_END),
      }),
    );
  });
});
