import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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

/*
 * Issue #4105, end to end on a real dashboard: the authenticated shell
 * (DashboardView) with its real toolbar, canvas and widgets, over a fake
 * data layer. One board carries every kind of time-series widget - log
 * chart, trace chart, SLO history, Data Source chart, metric chart, metric
 * value and Data Source value - and the suite asserts what a person sees:
 *
 *   - a drag on ANY of them retimes EVERY widget on the board (each one
 *     re-queries the dragged window), the time picker shows the custom
 *     window and the toolbar offers "Reset zoom";
 *   - a double-click on a DIFFERENT widget, or "Reset zoom", puts every
 *     widget back on the range the board had before - one step, however
 *     many zooms deep;
 *   - edit mode drops the zoom and no widget offers the gesture.
 *
 * The chart libraries are stood in for (jsdom lays nothing out, so recharts
 * cannot resolve a pointer to a bar). The stand-ins resolve their zoom the
 * way the real chart wrappers do, and the raw-recharts one calls the same
 * mouse props recharts would.
 *
 * The board keeps its default "Past 1 Hour", resolved against the real
 * clock, so windows are compared as "the dragged window, exactly" or "a
 * fresh one-hour window" rather than as fixed instants.
 */

jest.setTimeout(120000);

const HOUR_MS: number = 60 * 60 * 1000;
const MINUTE_MS: number = 60 * 1000;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      /*
       * Permission.ProjectAdmin - a literal, because a jest.mock factory is
       * hoisted above the imports and cannot close over the enum.
       */
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

const getItemMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
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
      aggregate: (...args: Array<any>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
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
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
        getAttributeKeys: () => {
          return [];
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  const objectId: { default: new (id: string) => unknown } = jest.requireActual(
    "../../../Types/ObjectID",
  ) as {
    default: new (id: string) => unknown;
  };
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new objectId.default("55555555-5555-4555-8555-555555555555");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

interface ZoomContextModule {
  useChartTimeRangeZoom: () => ChartTimeRangeZoomContextValue | null;
  resolveChartTimeRangeZoom: (
    input: ResolveChartTimeRangeZoomInput,
  ) => ChartTimeRangeZoomHandlers;
}

interface ZoomableStubProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

interface MetricChartsStubProps extends ZoomableStubProps {
  metricViewData?: MetricViewData | undefined;
}

// The SLO chart's LineChartElement.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const zoomContext: ZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as ZoomContextModule;
  return {
    __esModule: true,
    default: (props: ZoomableStubProps): React.ReactElement => {
      return react.createElement(ZoomableStub, {
        ...props,
        testId: "slo-line-chart",
        zoomContext: zoomContext,
      });
    },
  };
});

// The metric chart and Data Source chart widgets' MetricCharts.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    const zoomContext: ZoomContextModule = jest.requireActual(
      "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
    ) as ZoomContextModule;
    return {
      __esModule: true,
      default: (props: MetricChartsStubProps): React.ReactElement => {
        const firstQuery: MetricQueryConfigData | undefined =
          props.metricViewData?.queryConfigs[0];
        const key: string =
          firstQuery?.metricQueryData.filterData.metricName?.toString() ||
          firstQuery?.id ||
          "unknown";
        return react.createElement(ZoomableStub, {
          ...props,
          testId: `metric-charts-${key}`,
          zoomContext: zoomContext,
        });
      },
    };
  },
);

// recharts, for the Log Chart and Trace Chart widgets.
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

  type StubChart = (props: StubChartProps) => React.ReactElement;

  const chart: (kind: string) => StubChart = (kind: string): StubChart => {
    return (props: StubChartProps): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": `${kind}-chart` },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
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
    };
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: chart("bar"),
    LineChart: chart("line"),
    AreaChart: chart("area"),
    Bar: nothing,
    Line: nothing,
    Area: nothing,
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import { SPARKLINE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  ResolveChartTimeRangeZoomInput,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";

interface ZoomableStubRenderProps extends ZoomableStubProps {
  testId: string;
  zoomContext: ZoomContextModule;
}

/*
 * A chart that resolves its zoom the way the real wrappers do: its host's
 * handlers when it has any, else the enclosing page's. Its two buttons stand
 * for a drag across the plot (over `nextDragWindow`) and a double-click.
 */
let nextDragWindow: [Date, Date] = [new Date(0), new Date(1)];

function ZoomableStub(props: ZoomableStubRenderProps): React.ReactElement {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    props.zoomContext.useChartTimeRangeZoom();
  const zoom: ChartTimeRangeZoomHandlers =
    props.zoomContext.resolveChartTimeRangeZoom({
      onTimeRangeSelect: props.onTimeRangeSelect,
      onTimeRangeReset: props.onTimeRangeReset,
      isTimeAxis: true,
      disableTimeRangeZoom: props.disableTimeRangeZoom,
      pageZoom: pageZoom,
    });

  return (
    <div
      data-testid={props.testId}
      data-can-zoom={String(Boolean(zoom.onTimeRangeSelect))}
      data-can-reset={String(Boolean(zoom.onTimeRangeReset))}
    >
      <button
        type="button"
        data-testid={`${props.testId}-drag`}
        onClick={() => {
          zoom.onTimeRangeSelect?.(nextDragWindow[0], nextDragWindow[1]);
        }}
      />
      <button
        type="button"
        data-testid={`${props.testId}-double-click`}
        onClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      />
    </div>
  );
}

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d0d0d0d0-1111-4111-8111-d0d0d0d0d0d0",
);
const SLO_ID: string = "e0e0e0e0-1111-4111-8111-e0e0e0e0e0e0";

function component(
  componentType: DashboardComponentType,
  rect: { top: number; left: number; width: number; height: number },
  args: JSONObject,
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate(),
    componentType: componentType,
    topInDashboardUnits: rect.top,
    leftInDashboardUnits: rect.left,
    widthInDashboardUnits: rect.width,
    heightInDashboardUnits: rect.height,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: args,
  };
}

// One board with every kind of time-series widget.
function buildBoard(): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 12,
    components: [
      component(
        DashboardComponentType.LogChart,
        { top: 0, left: 0, width: 6, height: 3 },
        { title: "Errors", chartType: DashboardChartType.Line },
      ),
      component(
        DashboardComponentType.TraceChart,
        { top: 0, left: 6, width: 6, height: 3 },
        { title: "Requests", metric: "count" },
      ),
      component(
        DashboardComponentType.Slo,
        { top: 3, left: 0, width: 6, height: 3 },
        {
          serviceLevelObjectiveId: SLO_ID,
          sloMetric: SloWidgetMetric.Sli,
          displayType: SloWidgetDisplayType.Chart,
        },
      ),
      component(
        DashboardComponentType.DataSourceChart,
        { top: 3, left: 6, width: 6, height: 3 },
        {
          chartTitle: "Queue depth",
          chartType: DashboardChartType.Line,
          queries: [
            {
              id: "queue-chart",
              dataSourceId: "f0f0f0f0-1111-4111-8111-f0f0f0f0f0f0",
              query: "chart:sum(queue_depth)",
            },
          ],
        },
      ),
      component(
        DashboardComponentType.Chart,
        { top: 6, left: 0, width: 6, height: 3 },
        {
          chartTitle: "CPU",
          chartType: DashboardChartType.Line,
          metricQueryConfig: {
            metricAliasData: { metricVariable: "a" },
            metricQueryData: {
              filterData: {
                metricName: "cpu.usage",
                aggegationType: MetricsAggregationType.Avg,
              },
            },
          },
        },
      ),
      component(
        DashboardComponentType.Value,
        { top: 6, left: 6, width: 3, height: 4 },
        {
          title: "Requests",
          metricQueryConfig: {
            metricAliasData: { metricVariable: "a" },
            metricQueryData: {
              filterData: {
                metricName: "http.requests",
                aggegationType: MetricsAggregationType.Sum,
              },
            },
          },
        },
      ),
      component(
        DashboardComponentType.DataSourceValue,
        { top: 6, left: 9, width: 3, height: 4 },
        {
          title: "Queue now",
          query: {
            id: "queue-value",
            dataSourceId: "f0f0f0f0-1111-4111-8111-f0f0f0f0f0f0",
            query: "value:sum(queue_depth)",
          },
        },
      ),
    ],
  };
}

type Window = [number, number];

function toClickHouse(date: Date): string {
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

function minuteFloor(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

// Points every five minutes across a window, for the sparklines and charts.
function pointsAcross(
  start: Date,
  end: Date,
): Array<{ timestamp: Date; value: number }> {
  const points: Array<{ timestamp: Date; value: number }> = [];
  for (
    let ms: number = minuteFloor(start.getTime()) + MINUTE_MS;
    ms < end.getTime();
    ms += 5 * MINUTE_MS
  ) {
    points.push({ timestamp: new Date(ms), value: points.length + 1 });
  }
  return points;
}

interface ApiPostArgs {
  url: { toString: () => string };
  data: JSONObject;
}

// The window of every request each widget has made, in order.
function logWindows(): Array<Window> {
  return apiPostMock.mock.calls
    .map((call: Array<unknown>): ApiPostArgs => {
      return call[0] as ApiPostArgs;
    })
    .filter((args: ApiPostArgs): boolean => {
      return args.url.toString().includes("/telemetry/logs/histogram");
    })
    .map((args: ApiPostArgs): Window => {
      return [
        new Date(args.data["startTime"] as string).getTime(),
        new Date(args.data["endTime"] as string).getTime(),
      ];
    });
}

function traceWindows(): Array<Window> {
  return apiPostMock.mock.calls
    .map((call: Array<unknown>): ApiPostArgs => {
      return call[0] as ApiPostArgs;
    })
    .filter((args: ApiPostArgs): boolean => {
      return args.url.toString().includes("/telemetry/traces/analytics");
    })
    .map((args: ApiPostArgs): Window => {
      return [
        new Date(args.data["startTime"] as string).getTime(),
        new Date(args.data["endTime"] as string).getTime(),
      ];
    });
}

function sloWindows(): Array<Window> {
  return aggregateMock.mock.calls.map((call: Array<unknown>): Window => {
    const aggregateBy: { startTimestamp: Date; endTimestamp: Date } = (
      call[0] as {
        aggregateBy: { startTimestamp: Date; endTimestamp: Date };
      }
    ).aggregateBy;
    return [
      aggregateBy.startTimestamp.getTime(),
      aggregateBy.endTimestamp.getTime(),
    ];
  });
}

function metricWindows(metricName: string): Array<Window> {
  return fetchResultsMock.mock.calls
    .map((call: Array<unknown>): MetricViewData => {
      return (call[0] as { metricViewData: MetricViewData }).metricViewData;
    })
    .filter((data: MetricViewData): boolean => {
      return (
        data.queryConfigs[0]?.metricQueryData.filterData.metricName ===
        metricName
      );
    })
    .map((data: MetricViewData): Window => {
      return [
        data.startAndEndDate!.startValue.getTime(),
        data.startAndEndDate!.endValue.getTime(),
      ];
    });
}

function dataSourceWindows(queryPrefix: string): Array<Window> {
  return fetchTimeSeriesMock.mock.calls
    .map(
      (
        call: Array<unknown>,
      ): {
        queryConfig: { query: string };
        startDate: Date;
        endDate: Date;
      } => {
        return call[0] as {
          queryConfig: { query: string };
          startDate: Date;
          endDate: Date;
        };
      },
    )
    .filter((args: { queryConfig: { query: string } }): boolean => {
      return args.queryConfig.query.startsWith(queryPrefix);
    })
    .map((args: { startDate: Date; endDate: Date }): Window => {
      return [args.startDate.getTime(), args.endDate.getTime()];
    });
}

interface WidgetWindows {
  name: string;
  windows: () => Array<Window>;
}

const EVERY_WIDGET: Array<WidgetWindows> = [
  { name: "log chart", windows: logWindows },
  { name: "trace chart", windows: traceWindows },
  { name: "SLO chart", windows: sloWindows },
  {
    name: "Data Source chart",
    windows: (): Array<Window> => {
      return dataSourceWindows("chart:");
    },
  },
  {
    name: "metric chart",
    windows: (): Array<Window> => {
      return metricWindows("cpu.usage");
    },
  },
  {
    name: "metric value",
    windows: (): Array<Window> => {
      return metricWindows("http.requests");
    },
  },
  {
    name: "Data Source value",
    windows: (): Array<Window> => {
      return dataSourceWindows("value:");
    },
  },
];

function lastWindowOf(widget: WidgetWindows): Window | undefined {
  const windows: Array<Window> = widget.windows();
  return windows[windows.length - 1];
}

// Every widget's latest request asks for exactly this window.
async function expectEveryWidgetOn(expected: Window): Promise<void> {
  await waitFor(() => {
    for (const widget of EVERY_WIDGET) {
      expect([widget.name, lastWindowOf(widget)]).toEqual([
        widget.name,
        expected,
      ]);
    }
  });
}

/*
 * Every widget's latest request is a fresh one-hour window ending at or
 * after `notBeforeEndMs`: the board is back on its relative "Past 1 Hour".
 */
async function expectEveryWidgetOnThePastHour(
  notBeforeEndMs: number,
): Promise<void> {
  await waitFor(() => {
    for (const widget of EVERY_WIDGET) {
      const last: Window | undefined = lastWindowOf(widget);
      expect([widget.name, last ? last[1] - last[0] : null]).toEqual([
        widget.name,
        HOUR_MS,
      ]);
      expect(last![1]).toBeGreaterThanOrEqual(notBeforeEndMs);
    }
  });
}

function logBars(): Array<string> {
  return within(screen.getByTestId("line-chart"))
    .getAllByTestId(/^bucket-/)
    .map((element: HTMLElement): string => {
      return element.getAttribute("data-testid")!.replace(/^bucket-/, "");
    });
}

function traceBars(): Array<string> {
  return within(screen.getByTestId("bar-chart"))
    .getAllByTestId(/^bucket-/)
    .map((element: HTMLElement): string => {
      return element.getAttribute("data-testid")!.replace(/^bucket-/, "");
    });
}

function dragAcrossRechartsBars(
  chartTestId: string,
  fromLabel: string,
  toLabel: string,
): void {
  const chart: HTMLElement = screen.getByTestId(chartTestId);
  fireEvent.mouseDown(within(chart).getByTestId(`bucket-${fromLabel}`));
  fireEvent.mouseMove(within(chart).getByTestId(`bucket-${toLabel}`));
  fireEvent.mouseUp(within(chart).getByTestId(`bucket-${toLabel}`));
}

function picker(): HTMLElement {
  return screen.getByText((_content: string, element: Element | null) => {
    return Boolean(
      element?.tagName === "SPAN" &&
        element.parentElement?.tagName === "BUTTON" &&
        element.parentElement.querySelector("svg") &&
        (element.textContent === TimeRange.PAST_ONE_HOUR ||
          (element.textContent || "").includes(" - ")),
    );
  });
}

async function renderBoard(): Promise<void> {
  render(<DashboardViewer dashboardId={DASHBOARD_ID} />);

  await waitFor(() => {
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.getByTestId("slo-line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("metric-charts-cpu.usage")).toBeInTheDocument();
    expect(screen.getByTestId("metric-charts-queue-chart")).toBeInTheDocument();
    expect(screen.getAllByTestId(SPARKLINE_TEST_ID)).toHaveLength(2);
  });
}

let clientWidthDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  /*
   * The canvas sizes every widget from its own measured width, which jsdom
   * reports as 0. Report a desktop-wide board so tiles have real sizes.
   */
  clientWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: (): number => {
      return 1200;
    },
  });
});

afterAll(() => {
  if (clientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      clientWidthDescriptor,
    );
  }
});

beforeEach(() => {
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID.toString()}`);
  nextDragWindow = [new Date(0), new Date(1)];

  getItemMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === Dashboard) {
      return Promise.resolve({
        dashboardViewConfig: buildBoard() as unknown as JSONObject,
        name: "Checkout",
        description: "",
        pageTitle: null,
        pageDescription: null,
      });
    }

    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo._id = SLO_ID;
    slo.name = "Checkout availability";
    slo.targetPercentage = 99.9;
    slo.sloStatus = SloStatus.Healthy;
    return Promise.resolve(slo);
  });

  aggregateMock.mockImplementation((...args: Array<unknown>) => {
    const aggregateBy: { startTimestamp: Date; endTimestamp: Date } = (
      args[0] as { aggregateBy: { startTimestamp: Date; endTimestamp: Date } }
    ).aggregateBy;
    return Promise.resolve({
      data: pointsAcross(aggregateBy.startTimestamp, aggregateBy.endTimestamp),
    } as unknown as AggregatedResult);
  });

  apiPostMock.mockImplementation((...args: Array<unknown>) => {
    const request: ApiPostArgs = args[0] as ApiPostArgs;
    const start: Date = new Date(request.data["startTime"] as string);

    if (request.url.toString().includes("/telemetry/logs/histogram")) {
      return Promise.resolve({
        data: {
          buckets: [10, 11, 12].map((offset: number) => {
            return {
              time: new Date(
                minuteFloor(start.getTime()) + offset * MINUTE_MS,
              ).toISOString(),
              severity: "Error",
              count: offset,
            };
          }),
        },
      });
    }

    return Promise.resolve({
      data: {
        data: [5, 6, 20].map((offset: number) => {
          return {
            time: toClickHouse(
              new Date(minuteFloor(start.getTime()) + offset * MINUTE_MS),
            ),
            value: offset,
            groupValues: {},
          };
        }),
      },
    });
  });

  fetchResultsMock.mockImplementation((...args: Array<unknown>) => {
    const data: MetricViewData = (args[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return Promise.resolve([
      {
        data: pointsAcross(
          data.startAndEndDate!.startValue,
          data.startAndEndDate!.endValue,
        ),
      },
    ]);
  });

  fetchTimeSeriesMock.mockImplementation((...args: Array<unknown>) => {
    const request: { startDate: Date; endDate: Date } = args[0] as {
      startDate: Date;
      endDate: Date;
    };
    return Promise.resolve({
      data: pointsAcross(request.startDate, request.endDate),
    });
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("a dashboard where every time-series widget zooms the whole board", () => {
  test("every widget starts on the board's hour, and every chart offers the board's zoom", async () => {
    const renderedAt: number = Date.now();
    await renderBoard();

    await expectEveryWidgetOnThePastHour(renderedAt);

    expect(screen.getByTestId("slo-line-chart")).toHaveAttribute(
      "data-can-zoom",
      "true",
    );
    expect(screen.getByTestId("metric-charts-cpu.usage")).toHaveAttribute(
      "data-can-zoom",
      "true",
    );
    expect(screen.getByTestId("metric-charts-queue-chart")).toHaveAttribute(
      "data-can-zoom",
      "true",
    );
    // Nothing to undo yet, so no chart is holding clicks open for a reset.
    expect(screen.getByTestId("slo-line-chart")).toHaveAttribute(
      "data-can-reset",
      "false",
    );
    expect(picker()).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  test("a drag on the log chart retimes every widget, and the toolbar shows the window and Reset zoom", async () => {
    await renderBoard();

    const bars: Array<string> = logBars();
    const from: string = bars[10]!;
    const to: string = bars[12]!;
    const dragged: Window = [
      new Date(from).getTime(),
      new Date(to).getTime() + MINUTE_MS,
    ];

    dragAcrossRechartsBars("line-chart", from, to);

    await expectEveryWidgetOn(dragged);
    expect(picker()).not.toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(picker().textContent).toContain(" - ");
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toBeInTheDocument();
    // Every chart can now take a double-click to undo it.
    expect(screen.getByTestId("slo-line-chart")).toHaveAttribute(
      "data-can-reset",
      "true",
    );
    expect(screen.getByTestId("metric-charts-queue-chart")).toHaveAttribute(
      "data-can-reset",
      "true",
    );
  });

  test("a double-click on a DIFFERENT widget puts every widget back on the hour", async () => {
    await renderBoard();
    const bars: Array<string> = logBars();
    const dragged: Window = [
      new Date(bars[10]!).getTime(),
      new Date(bars[12]!).getTime() + MINUTE_MS,
    ];
    dragAcrossRechartsBars("line-chart", bars[10]!, bars[12]!);
    await expectEveryWidgetOn(dragged);

    // Zoomed from the log chart, undone from the SLO chart.
    fireEvent.click(screen.getByTestId("slo-line-chart-double-click"));

    await expectEveryWidgetOnThePastHour(dragged[1]);
    expect(picker()).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  test("a double-click on the trace chart undoes a zoom made on the metric chart", async () => {
    await renderBoard();
    const hourStart: number = lastWindowOf(EVERY_WIDGET[0]!)![0];
    const dragged: Window = [
      hourStart + 20 * MINUTE_MS,
      hourStart + 35 * MINUTE_MS,
    ];
    nextDragWindow = [new Date(dragged[0]), new Date(dragged[1])];

    fireEvent.click(screen.getByTestId("metric-charts-cpu.usage-drag"));
    await expectEveryWidgetOn(dragged);

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    await expectEveryWidgetOnThePastHour(dragged[1]);
  });

  test("the toolbar's Reset zoom puts every widget back on the hour", async () => {
    await renderBoard();
    const hourStart: number = lastWindowOf(EVERY_WIDGET[0]!)![0];
    const dragged: Window = [
      hourStart + 5 * MINUTE_MS,
      hourStart + 25 * MINUTE_MS,
    ];
    nextDragWindow = [new Date(dragged[0]), new Date(dragged[1])];
    fireEvent.click(screen.getByTestId("metric-charts-queue-chart-drag"));
    await expectEveryWidgetOn(dragged);

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    await expectEveryWidgetOnThePastHour(dragged[1]);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  test("zooms from three different widgets still unwind to the hour in one step", async () => {
    const renderedAt: number = Date.now();
    await renderBoard();

    // 1. The value widget's sparkline, across all of its points.
    const hour: Window = lastWindowOf(EVERY_WIDGET[5]!)!;
    const sparkline: SVGSVGElement = screen.getAllByTestId(
      SPARKLINE_TEST_ID,
    )[0] as unknown as SVGSVGElement;
    const width: number = Number(sparkline.getAttribute("width"));
    sparkline.getBoundingClientRect = (): DOMRect => {
      return { left: 0, width: width, top: 0, height: 20 } as DOMRect;
    };
    fireEvent.mouseDown(sparkline, { clientX: 4, button: 0 });
    fireEvent.mouseMove(sparkline, { clientX: width - 4, buttons: 1 });
    fireEvent.mouseUp(sparkline, { clientX: width - 4 });

    /*
     * Its points run every five minutes from a minute into the hour, so
     * the drag covers the first of them through the end of the last one's
     * bucket.
     */
    const points: Array<{ timestamp: Date }> = pointsAcross(
      new Date(hour[0]),
      new Date(hour[1]),
    );
    const firstZoom: Window = [
      points[0]!.timestamp.getTime(),
      points[points.length - 1]!.timestamp.getTime() + 5 * MINUTE_MS,
    ];
    await expectEveryWidgetOn(firstZoom);
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toBeInTheDocument();

    // 2. The trace chart, inside it: its first two buckets.
    await waitFor(() => {
      expect(traceBars().length).toBeGreaterThan(1);
    });
    const traceBuckets: Array<string> = traceBars();
    dragAcrossRechartsBars("bar-chart", traceBuckets[0]!, traceBuckets[1]!);
    const secondZoom: Window = [
      new Date(`${traceBuckets[0]!.replace(" ", "T")}Z`).getTime(),
      new Date(`${traceBuckets[1]!.replace(" ", "T")}Z`).getTime() + MINUTE_MS,
    ];
    await expectEveryWidgetOn(secondZoom);

    // 3. The SLO chart, inside that.
    const thirdZoom: Window = [
      secondZoom[0] + 30 * 1000,
      secondZoom[0] + 60 * 1000,
    ];
    nextDragWindow = [new Date(thirdZoom[0]), new Date(thirdZoom[1])];
    fireEvent.click(screen.getByTestId("slo-line-chart-drag"));
    await expectEveryWidgetOn(thirdZoom);

    // One double-click, on yet another widget, and the board is back.
    fireEvent.click(screen.getByTestId("metric-charts-cpu.usage-double-click"));

    await expectEveryWidgetOnThePastHour(renderedAt);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    expect(picker()).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
  });

  test("a double-click on an un-zoomed board does not refetch anything", async () => {
    await renderBoard();
    await waitFor(() => {
      expect(lastWindowOf(EVERY_WIDGET[6]!)).toBeDefined();
    });
    const callsBefore: Array<number> = EVERY_WIDGET.map(
      (widget: WidgetWindows): number => {
        return widget.windows().length;
      },
    );

    fireEvent.click(screen.getByTestId("slo-line-chart-double-click"));
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));
    fireEvent.doubleClick(screen.getAllByTestId(SPARKLINE_TEST_ID)[1]!);

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });
    expect(
      EVERY_WIDGET.map((widget: WidgetWindows): number => {
        return widget.windows().length;
      }),
    ).toEqual(callsBefore);
  });

  test("editing drops the zoom, and no widget offers the gesture while editing", async () => {
    await renderBoard();
    const bars: Array<string> = logBars();
    const dragged: Window = [
      new Date(bars[10]!).getTime(),
      new Date(bars[12]!).getTime() + MINUTE_MS,
    ];
    dragAcrossRechartsBars("line-chart", bars[10]!, bars[12]!);
    await expectEveryWidgetOn(dragged);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("More dashboard options"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Edit Dashboard"));
    });

    await expectEveryWidgetOnThePastHour(dragged[1]);
    expect(screen.getByTestId("slo-line-chart")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );
    expect(screen.getByTestId("metric-charts-cpu.usage")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );
    expect(screen.getByTestId("metric-charts-queue-chart")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );

    const requestsBefore: number = logWindows().length;
    const editBars: Array<string> = logBars();
    dragAcrossRechartsBars("line-chart", editBars[10]!, editBars[12]!);
    fireEvent.click(screen.getByTestId("slo-line-chart-drag"));
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });

    expect(logWindows().length).toBe(requestsBefore);
  });
});
