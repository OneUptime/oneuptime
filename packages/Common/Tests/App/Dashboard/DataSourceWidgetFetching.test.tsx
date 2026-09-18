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
  RenderResult,
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
 * The four External Data Source widgets each own their own fetch loop, and
 * every one of those loops has to answer the same three questions before it
 * is allowed to touch the network: is this widget actually configured, which
 * concrete time window is it asking about, and is this a public dashboard?
 *
 * Getting the first wrong spams a customer's Postgres/Prometheus with empty
 * queries the moment a widget is dropped on a board. Getting the last wrong
 * is a security boundary failure — the anonymous public dashboard API
 * deliberately exposes no data-source surface, so a widget that fetches
 * anyway leaks project-owned credentials' reach to unauthenticated viewers.
 *
 * Variable interpolation lives on the client (the server receives final query
 * text), so "{{env}}" surviving into the request is a real bug class, not a
 * cosmetic one — which is why it is asserted against the request arguments
 * rather than against anything rendered.
 */

const fetchTimeSeriesMock: MockFunction = getJestMockFunction();
const fetchTableMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
        fetchTable: (...args: Array<any>) => {
          return fetchTableMock(...args);
        },
        getAttributeKeys: (result: { data: Array<Record<string, any>> }) => {
          const keys: Array<string> = [];
          for (const point of result.data || []) {
            const attributes: Record<string, unknown> | undefined = point[
              "attributes"
            ] as Record<string, unknown> | undefined;
            for (const key of Object.keys(attributes || {})) {
              if (!keys.includes(key)) {
                keys.push(key);
              }
            }
          }
          return keys;
        },
      },
    };
  },
);

/*
 * The chart widget's whole job here is what it ASKS for and what it hands
 * down; rendering a real recharts surface in jsdom would test neither.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MetricChartsStubProps): React.ReactElement => {
        metricChartsRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          `results:${props.metricResults.length} configs:${props.metricViewData.queryConfigs.length}`,
        );
      },
    };
  },
);

import DashboardDataSourceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponent, {
  DataSourceValueReduce,
} from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import { DashboardValueTrendDirection } from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DataSourceQueryConfig from "../../../Types/DataSource/DataSourceQueryConfig";
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../Types/DataSource/DataSourceTableResult";
import { ObjectType } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

interface MetricChartsStubProps {
  metricResults: Array<AggregatedResult>;
  metricViewData: MetricViewData;
  hideCard?: boolean | undefined;
  topNOverrideScope?: string | undefined;
}

/** One recorded call into the data source query client. */
interface DataSourceFetchArgs {
  queryConfig: DataSourceQueryConfig;
  startDate: Date;
  endDate: Date;
}

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const START_DATE: Date = new Date("2026-08-10T09:00:00.000Z");
const END_DATE: Date = new Date("2026-08-10T10:00:00.000Z");

/*
 * A CUSTOM range pins the window to fixed instants — a relative range would
 * resolve against the wall clock and make the startDate/endDate assertions
 * untestable.
 */
const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

type BuildBasePropsFunction = (
  overrides?: Partial<DashboardBaseComponentProps>,
) => DashboardBaseComponentProps;

const buildBaseProps: BuildBasePropsFunction = (
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps => {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "data-source-widget",
    onComponentUpdate: (): void => {
      // The widgets under test never write back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  };
};

type BuildPointFunction = (
  value: number | null,
  timestamp: string,
  attributes?: Record<string, string>,
) => AggregatedModel;

const buildPoint: BuildPointFunction = (
  value: number | null,
  timestamp: string,
  attributes?: Record<string, string>,
): AggregatedModel => {
  return {
    timestamp: new Date(timestamp),
    value: value as number,
    ...(attributes ? { attributes: attributes } : {}),
  } as AggregatedModel;
};

type BuildSeriesFunction = (
  points: Array<AggregatedModel>,
  errorMessage?: string,
) => AggregatedResult;

const buildSeries: BuildSeriesFunction = (
  points: Array<AggregatedModel>,
  errorMessage?: string,
): AggregatedResult => {
  return {
    data: points,
    truncated: false,
    ...(errorMessage ? { errorMessage: errorMessage } : {}),
  };
};

type GetFetchCallsFunction = (mock: MockFunction) => Array<DataSourceFetchArgs>;

const getFetchCalls: GetFetchCallsFunction = (
  mock: MockFunction,
): Array<DataSourceFetchArgs> => {
  return mock.mock.calls.map((call: Array<unknown>): DataSourceFetchArgs => {
    return call[0] as DataSourceFetchArgs;
  });
};

type RenderValueFunction = (
  args: DashboardDataSourceValueComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => RenderResult;

const renderValueWidget: RenderValueFunction = (
  args: DashboardDataSourceValueComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult => {
  const component: DashboardDataSourceValueComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceValue,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: args,
  };

  return render(
    <DashboardDataSourceValueComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />,
  );
};

type RenderGaugeFunction = (
  args: DashboardDataSourceGaugeComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => RenderResult;

const renderGaugeWidget: RenderGaugeFunction = (
  args: DashboardDataSourceGaugeComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult => {
  const component: DashboardDataSourceGaugeComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceGauge,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: args,
  };

  return render(
    <DashboardDataSourceGaugeComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />,
  );
};

type RenderTableFunction = (
  args: DashboardDataSourceTableComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => RenderResult;

const renderTableWidget: RenderTableFunction = (
  args: DashboardDataSourceTableComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult => {
  const component: DashboardDataSourceTableComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceTable,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  return render(
    <DashboardDataSourceTableComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />,
  );
};

type RenderChartFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => RenderResult;

const renderChartWidget: RenderChartFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult => {
  const component: DashboardDataSourceChartComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  return render(
    <DashboardDataSourceChartComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />,
  );
};

/*
 * The render helpers above mount and forget. The staleness and refresh-tick
 * tests need to hand the SAME element type back to `rerender` with different
 * base props, so they build the element instead of rendering it.
 */
type BuildValueElementFunction = (
  args: DashboardDataSourceValueComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => React.ReactElement;

const buildValueElement: BuildValueElementFunction = (
  args: DashboardDataSourceValueComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): React.ReactElement => {
  const component: DashboardDataSourceValueComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceValue,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: args,
  };

  return (
    <DashboardDataSourceValueComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />
  );
};

type BuildTableElementFunction = (
  args: DashboardDataSourceTableComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => React.ReactElement;

const buildTableElement: BuildTableElementFunction = (
  args: DashboardDataSourceTableComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): React.ReactElement => {
  const component: DashboardDataSourceTableComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceTable,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  return (
    <DashboardDataSourceTableComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />
  );
};

type BuildChartElementFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => React.ReactElement;

const buildChartElement: BuildChartElementFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): React.ReactElement => {
  const component: DashboardDataSourceChartComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  return (
    <DashboardDataSourceChartComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />
  );
};

/**
 * A promise whose settlement this test file controls, so two fetches can be
 * left in flight at once and completed in whatever order the test needs.
 */
interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type CreateDeferredFunction = <T>() => DeferredPromise<T>;

const createDeferred: CreateDeferredFunction = <T,>(): DeferredPromise<T> => {
  let resolveFunction: (value: T) => void = (): void => {
    // Replaced synchronously by the executor below.
  };
  let rejectFunction: (error: Error) => void = (): void => {
    // Replaced synchronously by the executor below.
  };

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: Error) => void): void => {
      resolveFunction = resolve;
      rejectFunction = reject;
    },
  );

  return {
    promise: promise,
    resolve: resolveFunction,
    reject: rejectFunction,
  };
};

/** Settle a deferred fetch and let React commit whatever it caused. */
type SettleFunction = (settle: () => void) => Promise<void>;

const settleAndFlush: SettleFunction = async (
  settle: () => void,
): Promise<void> => {
  await act(async (): Promise<void> => {
    settle();
  });
};

/** The `value` of the first point of the first result MetricCharts was given. */
type GetChartRenderedValuesFunction = () => Array<number | undefined>;

const getChartRenderedValues: GetChartRenderedValuesFunction = (): Array<
  number | undefined
> => {
  return metricChartsRenderMock.mock.calls.map(
    (call: Array<unknown>): number | undefined => {
      const chartProps: MetricChartsStubProps =
        call[0] as MetricChartsStubProps;
      return chartProps.metricResults[0]?.data[0]?.value;
    },
  );
};

/** The "N rows (truncated)" counter in the table widget's header. */
type GetRowCountLabelFunction = (container: HTMLElement) => string;

const getRowCountLabel: GetRowCountLabelFunction = (
  container: HTMLElement,
): string => {
  const label: Element | null = container.querySelector("span.tabular-nums");

  if (!label) {
    throw new Error("Table widget did not render a row count label.");
  }

  return (label.textContent || "").trim();
};

/** Rendered table body, cell text by row, in DOM order. */
type GetRenderedRowsFunction = (container: HTMLElement) => Array<Array<string>>;

const getRenderedRows: GetRenderedRowsFunction = (
  container: HTMLElement,
): Array<Array<string>> => {
  return Array.from(container.querySelectorAll("tbody tr")).map(
    (row: Element): Array<string> => {
      return Array.from(row.querySelectorAll("td")).map(
        (cell: Element): string => {
          return (cell.textContent || "").trim();
        },
      );
    },
  );
};

const TABLE_RESULT: DataSourceTableResult = {
  columns: [
    { key: "service", title: "Service", type: DataSourceTableColumnType.Text },
    { key: "errors", title: "Errors", type: DataSourceTableColumnType.Number },
  ],
  rows: [
    { service: "checkout", errors: 12 },
    { service: "search", errors: 3 },
    { service: "billing", errors: 41 },
    { service: "auth", errors: 7 },
  ],
  truncated: false,
};

const PUBLIC_DASHBOARD_CONTEXT: PublicDashboardContext = {
  dashboardId: new ObjectID("22222222-2222-4222-8222-222222222222"),
  apiUrl: {
    toString: (): string => {
      return "http://localhost/public-dashboard-api";
    },
  },
  postJSON: () => {
    throw new Error(
      "A data source widget reached the public dashboard API. It must not.",
    );
  },
} as unknown as PublicDashboardContext;

beforeEach((): void => {
  jest.clearAllMocks();
  fetchTimeSeriesMock.mockResolvedValue(buildSeries([]));
  fetchTableMock.mockResolvedValue({
    columns: [],
    rows: [],
    truncated: false,
  });
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("Data Source widget fetching", () => {
  describe("unconfigured widgets never touch the query client", () => {
    test("value widget with a blank data source renders its setup prompt", () => {
      renderValueWidget({
        query: { dataSourceId: "", query: "up" },
        title: "Requests",
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });

    test("value widget with whitespace-only query text is not configured", () => {
      renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "   \n\t " },
        title: "Requests",
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.getByText("Requests")).toBeInTheDocument();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });

    test("value widget with no query object at all renders its setup prompt", () => {
      renderValueWidget({ title: "Requests" });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });

    test("gauge widget with whitespace-only query text is not configured", () => {
      renderGaugeWidget({
        query: { dataSourceId: "ds-prom", query: "  " },
        gaugeTitle: "CPU",
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.getByText("CPU")).toBeInTheDocument();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });

    test("gauge widget falls back to its own setup title when untitled", () => {
      renderGaugeWidget({ query: { dataSourceId: "", query: "" } });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.getByText("Data Source Gauge")).toBeInTheDocument();
    });

    test("table widget with whitespace-only query text is not configured", () => {
      renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "\t  \n" },
        tableTitle: "Slow queries",
      });

      expect(fetchTableMock).not.toHaveBeenCalled();
      expect(screen.getByText("Slow queries")).toBeInTheDocument();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });

    test("table widget with a blank data source renders its setup prompt", () => {
      renderTableWidget({ query: { dataSourceId: "   ", query: "select 1" } });

      expect(fetchTableMock).not.toHaveBeenCalled();
      expect(screen.getByText("Data Source Table")).toBeInTheDocument();
    });

    /*
     * A prompt, not an error tile. Every chart is seeded with one blank
     * query card, so this is the state the widget is in the instant it is
     * added — reporting it as a failure blames the user for the default.
     */
    test("chart widget with only half-filled query cards asks to be configured", () => {
      renderChartWidget({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "   " },
          { id: "q2", dataSourceId: "", query: "up" },
        ],
        chartTitle: "Throughput",
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
      expect(screen.getByText("Throughput")).toBeInTheDocument();
      expect(
        screen.queryByText("Please configure a data source query."),
      ).not.toBeInTheDocument();
    });

    test("chart widget with no queries array at all asks to be configured", () => {
      renderChartWidget({ chartTitle: "Throughput" });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });

    // Untitled, so the prompt has to name the widget itself.
    test("an untitled unconfigured chart names itself in the prompt", () => {
      renderChartWidget({ queries: [] });

      expect(screen.getByText("Data Source Chart")).toBeInTheDocument();
      expect(
        screen.getByText("Click to configure a query"),
      ).toBeInTheDocument();
    });
  });

  describe("configured widgets query once, for the dashboard's window", () => {
    test("value widget sends the data source id and the resolved time range", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([buildPoint(42, "2026-08-10T09:30:00.000Z")]),
      );

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "up" },
        title: "Up",
      });

      await waitFor((): void => {
        expect(rendered.container.textContent).toContain("42");
      });

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);
      const call: DataSourceFetchArgs = getFetchCalls(fetchTimeSeriesMock)[0]!;
      expect(call.queryConfig.dataSourceId).toBe("ds-prom");
      expect(call.queryConfig.query).toBe("up");
      expect(call.startDate).toEqual(START_DATE);
      expect(call.endDate).toEqual(END_DATE);
    });

    test("table widget sends the same window through the table endpoint", async () => {
      fetchTableMock.mockResolvedValue(TABLE_RESULT);

      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(4);
      });

      expect(fetchTableMock).toHaveBeenCalledTimes(1);
      const call: DataSourceFetchArgs = getFetchCalls(fetchTableMock)[0]!;
      expect(call.queryConfig.dataSourceId).toBe("ds-pg");
      expect(call.startDate).toEqual(START_DATE);
      expect(call.endDate).toEqual(END_DATE);
      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
    });

    test("gauge widget reduces the returned series into one number", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([
          buildPoint(10, "2026-08-10T09:10:00.000Z"),
          buildPoint(80, "2026-08-10T09:20:00.000Z"),
        ]),
      );

      const rendered: RenderResult = renderGaugeWidget({
        query: { dataSourceId: "ds-prom", query: "cpu" },
        gaugeTitle: "CPU",
        reduce: DataSourceValueReduce.Max,
      });

      await waitFor((): void => {
        expect(rendered.container.textContent).toContain("80");
      });
      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);
    });

    test("value widget reduces out of TIME order, not array order", async () => {
      /*
       * A hand-written SQL query with no ORDER BY can return anything; Last
       * has to mean "latest timestamp", not "last row the driver emitted".
       */
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([
          buildPoint(7, "2026-08-10T09:50:00.000Z"),
          buildPoint(3, "2026-08-10T09:05:00.000Z"),
        ]),
      );

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-pg", query: "select value from t" },
        title: "Latest",
        reduce: DataSourceValueReduce.Last,
      });

      await waitFor((): void => {
        expect(rendered.container.textContent).toContain("7");
      });
    });

    test("a configured query that returns nothing says so instead of showing zero", async () => {
      fetchTimeSeriesMock.mockResolvedValue(buildSeries([]));

      renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "up" },
        title: "Up",
      });

      await waitFor((): void => {
        expect(
          screen.getByText("No data for the selected time range"),
        ).toBeInTheDocument();
      });
    });

    test("a connector's own error message beats the generic no-data text", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([], "PromQL parse error at char 4"),
      );

      renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "up{" },
        title: "Up",
      });

      await waitFor((): void => {
        expect(
          screen.getByText("PromQL parse error at char 4"),
        ).toBeInTheDocument();
      });
    });

    test("non-finite points are discarded rather than poisoning the reduction", async () => {
      /*
       * A SQL NULL or a missing column arrives as null on a field typed
       * `number` — averaged unchecked it renders NaN.
       */
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([
          buildPoint(null, "2026-08-10T09:10:00.000Z"),
          buildPoint(10, "2026-08-10T09:20:00.000Z"),
          buildPoint(30, "2026-08-10T09:30:00.000Z"),
        ]),
      );

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-pg", query: "select value from t" },
        title: "Average",
        reduce: DataSourceValueReduce.Avg,
      });

      await waitFor((): void => {
        expect(rendered.container.textContent).toContain("20");
      });
      expect(rendered.container.textContent).not.toContain("NaN");
    });
  });

  describe("dashboard variables are interpolated before the request leaves", () => {
    const ENV_VARIABLE: DashboardVariable = {
      id: "var-env",
      name: "env",
      type: DashboardVariableType.TextInput,
      selectedValue: "production",
    };

    test("value widget replaces {{env}} in the query it sends", async () => {
      renderValueWidget(
        {
          query: {
            dataSourceId: "ds-prom",
            query: 'sum(rate(http_requests_total{env="{{env}}"}[5m]))',
          },
          title: "Requests",
        },
        { variables: [ENV_VARIABLE] },
      );

      await waitFor((): void => {
        expect(
          screen.getByText("No data for the selected time range"),
        ).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);
      expect(getFetchCalls(fetchTimeSeriesMock)[0]!.queryConfig.query).toBe(
        'sum(rate(http_requests_total{env="production"}[5m]))',
      );
    });

    test("table widget interpolates too, and keeps the data source id", async () => {
      fetchTableMock.mockResolvedValue(TABLE_RESULT);

      const rendered: RenderResult = renderTableWidget(
        {
          query: {
            dataSourceId: "ds-pg",
            query: "select * from deploys where env = '{{ env }}'",
          },
        },
        { variables: [ENV_VARIABLE] },
      );

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(4);
      });

      expect(fetchTableMock).toHaveBeenCalledTimes(1);
      const call: DataSourceFetchArgs = getFetchCalls(fetchTableMock)[0]!;
      expect(call.queryConfig.query).toBe(
        "select * from deploys where env = 'production'",
      );
      expect(call.queryConfig.dataSourceId).toBe("ds-pg");
    });

    test("a multi-select variable joins its values with regex alternation", async () => {
      const clusterVariable: DashboardVariable = {
        id: "var-cluster",
        name: "cluster",
        type: DashboardVariableType.CustomList,
        isMultiSelect: true,
        selectedValues: ["eu-1", "us-2"],
      };

      renderGaugeWidget(
        {
          query: {
            dataSourceId: "ds-prom",
            query: 'up{cluster=~"{{cluster}}"}',
          },
        },
        { variables: [clusterVariable] },
      );

      await waitFor((): void => {
        expect(
          screen.getByText("No data for the selected time range"),
        ).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);
      expect(getFetchCalls(fetchTimeSeriesMock)[0]!.queryConfig.query).toBe(
        'up{cluster=~"eu-1|us-2"}',
      );
    });

    test("an unresolved variable leaves its token intact for the connector to complain about", async () => {
      const emptyVariable: DashboardVariable = {
        id: "var-env",
        name: "env",
        type: DashboardVariableType.TextInput,
      };

      renderValueWidget(
        {
          query: { dataSourceId: "ds-prom", query: 'up{env="{{env}}"}' },
          title: "Up",
        },
        { variables: [emptyVariable] },
      );

      await waitFor((): void => {
        expect(
          screen.getByText("No data for the selected time range"),
        ).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);
      expect(getFetchCalls(fetchTimeSeriesMock)[0]!.queryConfig.query).toBe(
        'up{env="{{env}}"}',
      );
    });
  });

  describe("public dashboards are a hard boundary, not a cosmetic one", () => {
    beforeEach((): void => {
      setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    });

    test("value widget renders the placeholder and issues no request", () => {
      renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "up" },
        title: "Up",
      });

      expect(
        screen.getByText(/not available on public dashboards/i),
      ).toBeInTheDocument();
      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
    });

    test("gauge widget renders the placeholder and issues no request", () => {
      renderGaugeWidget({
        query: { dataSourceId: "ds-prom", query: "cpu" },
        gaugeTitle: "CPU",
      });

      expect(
        screen.getByText(/not available on public dashboards/i),
      ).toBeInTheDocument();
      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
    });

    test("table widget renders the placeholder and issues no request", () => {
      renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
        tableTitle: "Slow queries",
      });

      expect(
        screen.getByText(/not available on public dashboards/i),
      ).toBeInTheDocument();
      expect(fetchTableMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Slow queries")).not.toBeInTheDocument();
    });

    test("chart widget renders the placeholder and issues no request", () => {
      renderChartWidget({
        queries: [{ id: "q1", dataSourceId: "ds-prom", query: "up" }],
        chartTitle: "Throughput",
      });

      expect(
        screen.getByText(/not available on public dashboards/i),
      ).toBeInTheDocument();
      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("metric-charts")).not.toBeInTheDocument();
    });
  });

  describe("a rejected fetch surfaces a message instead of throwing", () => {
    test("value widget renders the friendly error", async () => {
      fetchTimeSeriesMock.mockRejectedValue(
        new Error("Prometheus refused the connection"),
      );

      renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "up" },
        title: "Up",
      });

      await waitFor((): void => {
        expect(
          screen.getByText("Prometheus refused the connection"),
        ).toBeInTheDocument();
      });
    });

    test("gauge widget renders the friendly error", async () => {
      fetchTimeSeriesMock.mockRejectedValue(new Error("Query timed out"));

      renderGaugeWidget({
        query: { dataSourceId: "ds-prom", query: "cpu" },
        gaugeTitle: "CPU",
      });

      await waitFor((): void => {
        expect(screen.getByText("Query timed out")).toBeInTheDocument();
      });
    });

    test("table widget renders the friendly error instead of an empty grid", async () => {
      fetchTableMock.mockRejectedValue(
        new Error('relation "deploys" does not exist'),
      );

      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select * from deploys" },
      });

      await waitFor((): void => {
        expect(
          screen.getByText('relation "deploys" does not exist'),
        ).toBeInTheDocument();
      });
      expect(rendered.container.querySelector("table")).toBeNull();
    });

    test("chart widget renders the friendly error and no chart", async () => {
      fetchTimeSeriesMock.mockRejectedValue(new Error("Data source not found"));

      renderChartWidget({
        queries: [{ id: "q1", dataSourceId: "ds-prom", query: "up" }],
      });

      await waitFor((): void => {
        expect(screen.getByText("Data source not found")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("metric-charts")).not.toBeInTheDocument();
    });
  });

  describe("table widget row cap", () => {
    beforeEach((): void => {
      fetchTableMock.mockResolvedValue(TABLE_RESULT);
    });

    test("renders every row and no truncation flag when maxRows is unset", async () => {
      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(4);
      });
      expect(getRowCountLabel(rendered.container)).toBe("4 rows");
    });

    test("trims to maxRows and flags the result as truncated", async () => {
      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
        maxRows: 2,
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(2);
      });
      expect(getRowCountLabel(rendered.container)).toBe("2 rows (truncated)");
    });

    test("trims AFTER sorting, so the cap means top-N by the sorted column", async () => {
      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
        maxRows: 2,
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(2);
      });

      // Unsorted: the first two rows the query returned.
      expect(
        getRenderedRows(rendered.container).map(
          (row: Array<string>): string => {
            return row[0]!;
          },
        ),
      ).toEqual(["checkout", "search"]);

      fireEvent.click(screen.getByRole("columnheader", { name: /Errors/ }));

      // Ascending by error count: the two smallest, not the first two rows.
      expect(
        getRenderedRows(rendered.container).map(
          (row: Array<string>): string => {
            return row[0]!;
          },
        ),
      ).toEqual(["search", "auth"]);
      expect(getRowCountLabel(rendered.container)).toBe("2 rows (truncated)");
    });

    test("a maxRows of zero is treated as no cap at all", async () => {
      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
        maxRows: 0,
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(4);
      });
      expect(getRowCountLabel(rendered.container)).toBe("4 rows");
    });

    test("a maxRows larger than the result set does not claim truncation", async () => {
      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
        maxRows: 50,
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(4);
      });
      expect(getRowCountLabel(rendered.container)).toBe("4 rows");
    });

    test("the connector's own truncation is reported even without a widget cap", async () => {
      fetchTableMock.mockResolvedValue({
        ...TABLE_RESULT,
        truncated: true,
      });

      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
      });

      await waitFor((): void => {
        expect(getRenderedRows(rendered.container)).toHaveLength(4);
      });
      expect(getRowCountLabel(rendered.container)).toBe("4 rows (truncated)");
    });

    test("a query returning no columns says so rather than drawing an empty table", async () => {
      fetchTableMock.mockResolvedValue({
        columns: [],
        rows: [],
        truncated: false,
      });

      const rendered: RenderResult = renderTableWidget({
        query: { dataSourceId: "ds-pg", query: "select 1" },
      });

      await waitFor((): void => {
        expect(screen.getByText("No rows returned.")).toBeInTheDocument();
      });
      expect(rendered.container.querySelector("table")).toBeNull();
      expect(getRowCountLabel(rendered.container)).toBe("0 rows");
    });
  });

  describe("chart widget fans out one request per configured query", () => {
    test("fires a request per query and ignores half-filled cards", async () => {
      fetchTimeSeriesMock.mockImplementation(
        (args: DataSourceFetchArgs): Promise<AggregatedResult> => {
          return Promise.resolve(
            buildSeries([
              buildPoint(1, "2026-08-10T09:15:00.000Z", {
                query: args.queryConfig.query,
              }),
            ]),
          );
        },
      );

      renderChartWidget({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "up" },
          // Source picked, query still empty — the user is mid-edit.
          { id: "q2", dataSourceId: "ds-prom", query: "   " },
          // Query typed, source never picked.
          { id: "q3", dataSourceId: "", query: "select 1" },
          { id: "q4", dataSourceId: "ds-pg", query: "select count(*) from t" },
        ],
        chartType: DashboardChartType.Line,
      });

      await waitFor((): void => {
        expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(2);
      const calls: Array<DataSourceFetchArgs> =
        getFetchCalls(fetchTimeSeriesMock);
      expect(
        calls.map((call: DataSourceFetchArgs): string => {
          return call.queryConfig.query;
        }),
      ).toEqual(["up", "select count(*) from t"]);
      expect(
        calls.map((call: DataSourceFetchArgs): string => {
          return call.queryConfig.dataSourceId;
        }),
      ).toEqual(["ds-prom", "ds-pg"]);
    });

    test("hands the chart layer one result and one synthetic config per ready query", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([
          buildPoint(5, "2026-08-10T09:15:00.000Z", { instance: "a:9090" }),
        ]),
      );

      renderChartWidget({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "up" },
          { id: "q2", dataSourceId: "ds-prom", query: "" },
          { id: "q3", dataSourceId: "ds-prom", query: "rate(x[5m])" },
        ],
      });

      await waitFor((): void => {
        expect(screen.getByTestId("metric-charts")).toHaveTextContent(
          "results:2 configs:2",
        );
      });

      const lastProps: MetricChartsStubProps = metricChartsRenderMock.mock
        .calls[
        metricChartsRenderMock.mock.calls.length - 1
      ]![0] as MetricChartsStubProps;

      expect(
        lastProps.metricViewData.queryConfigs.map(
          (config: MetricQueryConfigData): string | undefined => {
            return config.id;
          },
        ),
      ).toEqual(["q1", "q3"]);
      expect(
        lastProps.metricViewData.queryConfigs[0]!.metricQueryData
          .groupByAttributeKeys,
      ).toEqual(["instance"]);
      expect(lastProps.topNOverrideScope).toBe(COMPONENT_ID.toString());
    });

    test("one failing query fails the widget rather than drawing a partial chart", async () => {
      fetchTimeSeriesMock
        .mockResolvedValueOnce(
          buildSeries([buildPoint(1, "2026-08-10T09:15:00.000Z")]),
        )
        .mockRejectedValueOnce(new Error("Query exceeded the statement limit"));

      renderChartWidget({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "up" },
          { id: "q2", dataSourceId: "ds-pg", query: "select 1" },
        ],
      });

      await waitFor((): void => {
        expect(
          screen.getByText("Query exceeded the statement limit"),
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId("metric-charts")).not.toBeInTheDocument();
      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(2);
    });
  });

  /*
   * The staleness guard (`fetchSequenceRef`). A refresh tick or a config
   * edit starts a second request while the first is still in flight, and
   * nothing orders their completions — a data source that is slow once is
   * slow unpredictably. Every one of these tests leaves two fetches open at
   * the same time and completes them in the WRONG order on purpose.
   */
  describe("only the newest fetch is allowed to write state", () => {
    const VALUE_ARGS: DashboardDataSourceValueComponent["arguments"] = {
      query: { dataSourceId: "ds-prom", query: "up" },
      title: "Up",
    };

    const TABLE_ARGS: DashboardDataSourceTableComponent["arguments"] = {
      query: { dataSourceId: "ds-pg", query: "select 1" },
    };

    const CHART_ARGS: DashboardDataSourceChartComponent["arguments"] = {
      queries: [{ id: "q1", dataSourceId: "ds-prom", query: "up" }],
    };

    const STALE_TABLE_RESULT: DataSourceTableResult = {
      columns: [
        {
          key: "service",
          title: "Service",
          type: DataSourceTableColumnType.Text,
        },
      ],
      rows: [{ service: "stale-service" }],
      truncated: false,
    };

    const FRESH_TABLE_RESULT: DataSourceTableResult = {
      columns: [
        {
          key: "service",
          title: "Service",
          type: DataSourceTableColumnType.Text,
        },
      ],
      rows: [{ service: "fresh-service" }],
      truncated: false,
    };

    test("value widget keeps the newer number when the older fetch answers last", async () => {
      const slowFirst: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();
      const newerSecond: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();

      fetchTimeSeriesMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(newerSecond.promise);

      const rendered: RenderResult = render(
        buildValueElement(VALUE_ARGS, { refreshTick: 0 }),
      );

      // The auto-refresh tick, while the first request is still open.
      rendered.rerender(buildValueElement(VALUE_ARGS, { refreshTick: 1 }));

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(2);

      await settleAndFlush((): void => {
        newerSecond.resolve(
          buildSeries([buildPoint(77, "2026-08-10T09:40:00.000Z")]),
        );
      });

      expect(rendered.container.textContent).toContain("77");

      await settleAndFlush((): void => {
        slowFirst.resolve(
          buildSeries([buildPoint(11, "2026-08-10T09:10:00.000Z")]),
        );
      });

      expect(rendered.container.textContent).toContain("77");
      expect(rendered.container.textContent).not.toContain("11");
    });

    /*
     * The parenthetical in the comment: the stale response does not merely
     * lose the value race, it must not run `setError("")` either — that
     * would wipe a failure the user is entitled to see and leave the tile
     * silently blank.
     */
    test("value widget's newer error survives a stale success landing after it", async () => {
      const slowFirst: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();
      const failingSecond: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();

      fetchTimeSeriesMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(failingSecond.promise);

      const rendered: RenderResult = render(
        buildValueElement(VALUE_ARGS, { refreshTick: 0 }),
      );
      rendered.rerender(buildValueElement(VALUE_ARGS, { refreshTick: 1 }));

      await settleAndFlush((): void => {
        failingSecond.reject(new Error("Prometheus refused the connection"));
      });

      expect(
        screen.getByText("Prometheus refused the connection"),
      ).toBeInTheDocument();

      await settleAndFlush((): void => {
        slowFirst.resolve(
          buildSeries([buildPoint(11, "2026-08-10T09:10:00.000Z")]),
        );
      });

      expect(
        screen.getByText("Prometheus refused the connection"),
      ).toBeInTheDocument();
      expect(rendered.container.textContent).not.toContain("11");
    });

    /*
     * The mirror image, and the one that proves the stale response really is
     * delivered rather than dropped: the component is awaiting this promise,
     * so its rejection reaches the widget's own catch (an unawaited one would
     * surface as an unhandled rejection instead). The catch has to bail the
     * same way the success path does.
     */
    test("value widget's newer data survives a stale failure landing after it", async () => {
      const slowFirst: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();
      const newerSecond: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();

      fetchTimeSeriesMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(newerSecond.promise);

      const rendered: RenderResult = render(
        buildValueElement(VALUE_ARGS, { refreshTick: 0 }),
      );
      rendered.rerender(buildValueElement(VALUE_ARGS, { refreshTick: 1 }));

      await settleAndFlush((): void => {
        newerSecond.resolve(
          buildSeries([buildPoint(77, "2026-08-10T09:40:00.000Z")]),
        );
      });

      expect(rendered.container.textContent).toContain("77");

      await settleAndFlush((): void => {
        slowFirst.reject(new Error("Connection reset by peer"));
      });

      expect(rendered.container.textContent).toContain("77");
      expect(
        screen.queryByText("Connection reset by peer"),
      ).not.toBeInTheDocument();
    });

    test("table widget keeps the newer rows when the older fetch answers last", async () => {
      const slowFirst: DeferredPromise<DataSourceTableResult> =
        createDeferred<DataSourceTableResult>();
      const newerSecond: DeferredPromise<DataSourceTableResult> =
        createDeferred<DataSourceTableResult>();

      fetchTableMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(newerSecond.promise);

      const rendered: RenderResult = render(
        buildTableElement(TABLE_ARGS, { refreshTick: 0 }),
      );
      rendered.rerender(buildTableElement(TABLE_ARGS, { refreshTick: 1 }));

      expect(fetchTableMock).toHaveBeenCalledTimes(2);

      await settleAndFlush((): void => {
        newerSecond.resolve(FRESH_TABLE_RESULT);
      });

      expect(getRenderedRows(rendered.container)).toEqual([["fresh-service"]]);

      await settleAndFlush((): void => {
        slowFirst.resolve(STALE_TABLE_RESULT);
      });

      expect(getRenderedRows(rendered.container)).toEqual([["fresh-service"]]);
      expect(rendered.container.textContent).not.toContain("stale-service");
    });

    test("table widget's newer error survives a stale success landing after it", async () => {
      const slowFirst: DeferredPromise<DataSourceTableResult> =
        createDeferred<DataSourceTableResult>();
      const failingSecond: DeferredPromise<DataSourceTableResult> =
        createDeferred<DataSourceTableResult>();

      fetchTableMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(failingSecond.promise);

      const rendered: RenderResult = render(
        buildTableElement(TABLE_ARGS, { refreshTick: 0 }),
      );
      rendered.rerender(buildTableElement(TABLE_ARGS, { refreshTick: 1 }));

      await settleAndFlush((): void => {
        failingSecond.reject(new Error('relation "deploys" does not exist'));
      });

      expect(
        screen.getByText('relation "deploys" does not exist'),
      ).toBeInTheDocument();

      await settleAndFlush((): void => {
        slowFirst.resolve(STALE_TABLE_RESULT);
      });

      expect(
        screen.getByText('relation "deploys" does not exist'),
      ).toBeInTheDocument();
      expect(rendered.container.textContent).not.toContain("stale-service");
      expect(rendered.container.querySelector("table")).toBeNull();
    });

    test("table widget's newer rows survive a stale failure landing after them", async () => {
      const slowFirst: DeferredPromise<DataSourceTableResult> =
        createDeferred<DataSourceTableResult>();
      const newerSecond: DeferredPromise<DataSourceTableResult> =
        createDeferred<DataSourceTableResult>();

      fetchTableMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(newerSecond.promise);

      const rendered: RenderResult = render(
        buildTableElement(TABLE_ARGS, { refreshTick: 0 }),
      );
      rendered.rerender(buildTableElement(TABLE_ARGS, { refreshTick: 1 }));

      await settleAndFlush((): void => {
        newerSecond.resolve(FRESH_TABLE_RESULT);
      });

      expect(getRenderedRows(rendered.container)).toEqual([["fresh-service"]]);

      await settleAndFlush((): void => {
        slowFirst.reject(new Error("Connection reset by peer"));
      });

      expect(getRenderedRows(rendered.container)).toEqual([["fresh-service"]]);
      expect(
        screen.queryByText("Connection reset by peer"),
      ).not.toBeInTheDocument();
    });

    /*
     * Same race on the chart, where the comment adds "and Promise.all
     * completions are not ordered" — the whole batch of a stale tick is one
     * settlement, so a single late batch would replace every series at once.
     */
    test("chart widget never hands the chart layer a stale batch", async () => {
      const slowFirst: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();
      const newerSecond: DeferredPromise<AggregatedResult> =
        createDeferred<AggregatedResult>();

      fetchTimeSeriesMock
        .mockReturnValueOnce(slowFirst.promise)
        .mockReturnValueOnce(newerSecond.promise);

      const chart: RenderResult = render(
        buildChartElement(CHART_ARGS, { refreshTick: 0 }),
      );
      chart.rerender(buildChartElement(CHART_ARGS, { refreshTick: 1 }));

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(2);

      await settleAndFlush((): void => {
        newerSecond.resolve(
          buildSeries([buildPoint(77, "2026-08-10T09:40:00.000Z")]),
        );
      });

      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();

      await settleAndFlush((): void => {
        slowFirst.resolve(
          buildSeries([buildPoint(11, "2026-08-10T09:10:00.000Z")]),
        );
      });

      expect(getChartRenderedValues()).not.toContain(11);
      expect(
        getChartRenderedValues()[getChartRenderedValues().length - 1],
      ).toBe(77);
    });
  });

  /*
   * `refreshTick` is a dependency of the startAndEndDate memo purely so a
   * RELATIVE range re-resolves against the wall clock on every auto-refresh.
   * Every other test in this file pins a CUSTOM range, which resolves to the
   * same two instants forever and therefore cannot tell a working dep from a
   * missing one.
   */
  describe("an auto-refresh re-resolves a relative range against the clock", () => {
    const RELATIVE_RANGE: RangeStartAndEndDateTime = {
      range: TimeRange.PAST_ONE_HOUR,
    };

    const ONE_HOUR_IN_MS: number = 60 * 60 * 1000;
    const FIVE_MINUTES_IN_MS: number = 5 * 60 * 1000;

    beforeEach((): void => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
    });

    afterEach((): void => {
      jest.useRealTimers();
    });

    test("value widget asks for a window that moved with the clock", async () => {
      const rendered: RenderResult = render(
        buildValueElement(
          { query: { dataSourceId: "ds-prom", query: "up" }, title: "Up" },
          { dashboardStartAndEndDate: RELATIVE_RANGE, refreshTick: 0 },
        ),
      );

      await act(async (): Promise<void> => {});

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);

      act((): void => {
        jest.advanceTimersByTime(FIVE_MINUTES_IN_MS);
      });

      rendered.rerender(
        buildValueElement(
          { query: { dataSourceId: "ds-prom", query: "up" }, title: "Up" },
          { dashboardStartAndEndDate: RELATIVE_RANGE, refreshTick: 1 },
        ),
      );

      await act(async (): Promise<void> => {});

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(2);

      const calls: Array<DataSourceFetchArgs> =
        getFetchCalls(fetchTimeSeriesMock);

      // "Past 1 hour" really is an hour wide, both times.
      expect(calls[0]!.endDate.getTime() - calls[0]!.startDate.getTime()).toBe(
        ONE_HOUR_IN_MS,
      );
      expect(calls[1]!.endDate.getTime() - calls[1]!.startDate.getTime()).toBe(
        ONE_HOUR_IN_MS,
      );

      // ...and the second one is the window five minutes later, not the first.
      expect(calls[1]!.endDate.getTime()).toBeGreaterThan(
        calls[0]!.endDate.getTime(),
      );
      expect(calls[1]!.endDate.getTime() - calls[0]!.endDate.getTime()).toBe(
        FIVE_MINUTES_IN_MS,
      );
      expect(
        calls[1]!.startDate.getTime() - calls[0]!.startDate.getTime(),
      ).toBe(FIVE_MINUTES_IN_MS);
    });

    test("chart widget asks for a window that moved with the clock", async () => {
      const chartArgs: DashboardDataSourceChartComponent["arguments"] = {
        queries: [{ id: "q1", dataSourceId: "ds-prom", query: "up" }],
      };

      const rendered: RenderResult = render(
        buildChartElement(chartArgs, {
          dashboardStartAndEndDate: RELATIVE_RANGE,
          refreshTick: 0,
        }),
      );

      await act(async (): Promise<void> => {});

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(1);

      act((): void => {
        jest.advanceTimersByTime(FIVE_MINUTES_IN_MS);
      });

      rendered.rerender(
        buildChartElement(chartArgs, {
          dashboardStartAndEndDate: RELATIVE_RANGE,
          refreshTick: 1,
        }),
      );

      await act(async (): Promise<void> => {});

      expect(fetchTimeSeriesMock).toHaveBeenCalledTimes(2);

      const calls: Array<DataSourceFetchArgs> =
        getFetchCalls(fetchTimeSeriesMock);
      expect(calls[1]!.endDate.getTime() - calls[0]!.endDate.getTime()).toBe(
        FIVE_MINUTES_IN_MS,
      );
      expect(calls[0]!.endDate.getTime() - calls[0]!.startDate.getTime()).toBe(
        ONE_HOUR_IN_MS,
      );
    });
  });

  /*
   * A window that resolves to no dates at all. The chart calls that an error
   * the user has to fix; the other three stop loading and say nothing about
   * it. The asymmetry is deliberate but easy to "tidy up" by accident, so
   * both halves are pinned here.
   */
  describe("a window with no dates: the chart complains, the rest go quiet", () => {
    const NO_DATE_RANGE: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        undefined as unknown as Date,
        undefined as unknown as Date,
      ),
    };

    const MISSING_DATE_ERROR: string =
      "Please select a valid start and end date.";

    test("chart widget reports the missing window and queries nothing", async () => {
      renderChartWidget(
        {
          queries: [{ id: "q1", dataSourceId: "ds-prom", query: "up" }],
          chartTitle: "Throughput",
        },
        { dashboardStartAndEndDate: NO_DATE_RANGE },
      );

      await waitFor((): void => {
        expect(screen.getByText(MISSING_DATE_ERROR)).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("metric-charts")).not.toBeInTheDocument();
    });

    test("value widget stops loading with no error of any kind", async () => {
      renderValueWidget(
        { query: { dataSourceId: "ds-prom", query: "up" }, title: "Up" },
        { dashboardStartAndEndDate: NO_DATE_RANGE },
      );

      await waitFor((): void => {
        expect(
          screen.getByText("No data for the selected time range"),
        ).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.queryByText(MISSING_DATE_ERROR)).not.toBeInTheDocument();
    });

    test("gauge widget stops loading with no error of any kind", async () => {
      renderGaugeWidget(
        { query: { dataSourceId: "ds-prom", query: "cpu" }, gaugeTitle: "CPU" },
        { dashboardStartAndEndDate: NO_DATE_RANGE },
      );

      await waitFor((): void => {
        expect(
          screen.getByText("No data for the selected time range"),
        ).toBeInTheDocument();
      });

      expect(fetchTimeSeriesMock).not.toHaveBeenCalled();
      expect(screen.queryByText(MISSING_DATE_ERROR)).not.toBeInTheDocument();
    });

    test("table widget stops loading with no error of any kind", async () => {
      const rendered: RenderResult = renderTableWidget(
        {
          query: { dataSourceId: "ds-pg", query: "select 1" },
          tableTitle: "Slow queries",
        },
        { dashboardStartAndEndDate: NO_DATE_RANGE },
      );

      await waitFor((): void => {
        expect(screen.getByText("No rows returned.")).toBeInTheDocument();
      });

      expect(fetchTableMock).not.toHaveBeenCalled();
      expect(screen.queryByText(MISSING_DATE_ERROR)).not.toBeInTheDocument();
      // The header still renders, so this is the quiet state, not the error tile.
      expect(screen.getByText("Slow queries")).toBeInTheDocument();
      expect(getRowCountLabel(rendered.container)).toBe("0 rows");
    });
  });

  /*
   * A widget title is NOT a metric name.
   *
   * The Value and Gauge widgets share their renderers with the OneUptime
   * metric widgets, and those renderers take a `metricName` so ValueFormatter
   * can apply two name-based heuristics:
   *
   *   - isFractionMetric(name): with unit "1", a `.utilization` / `.ratio` /
   *     `.fraction` / `.percent` name means the number is a [0, 1] ratio, so
   *     the view multiplies it by 100 before displaying it AND before
   *     comparing it against the widget's thresholds.
   *   - isHigherWorseMetric(name): decides whether a rising trend is drawn
   *     green or red when the widget's own `trendDirection` is unset.
   *
   * Both are safe for OneUptime metrics, whose names are exporter-authored
   * and follow those conventions. Neither is safe for external data: a Data
   * Source widget's title is free text a human typed, and naming a Postgres
   * query "cache.hit.utilization" is a label, not a promise that the number
   * is a ratio. So both widgets pass a hardcoded `metricName=""`
   * (DashboardDataSourceValueComponent.tsx ~201,
   * DashboardDataSourceGaugeComponent.tsx ~172) and the heuristics stay
   * silent.
   *
   * That constant is the kind of thing a later reader "fixes" by wiring the
   * title through — which silently multiplies a customer's 0.9 by 100 and
   * turns a Healthy gauge Critical. Every title below is therefore chosen to
   * be exactly a name that WOULD trip a heuristic, and each test is paired
   * with a control that asks for the same behaviour EXPLICITLY (via `unit` or
   * `trendDirection`). The controls are what make a failure legible: the
   * invariant is "the title is never read as a metric name", not "this widget
   * can never render a percent or a red arrow".
   */
  describe("a widget title is never read as a metric name", () => {
    /*
     * The big number and its unit suffix. Both views draw them in the same
     * `font-bold tabular-nums` box, and everything else on the tile (title,
     * status label, gauge min/max footer, threshold tick tooltips) lives
     * outside it — so this reads the digits, not the chrome around them.
     */
    type GetBigNumberFunction = (container: HTMLElement) => string;

    const getBigNumberText: GetBigNumberFunction = (
      container: HTMLElement,
    ): string => {
      const element: Element | null = container.querySelector(
        "div.font-bold.tabular-nums",
      );

      if (!element) {
        throw new Error("Widget did not render a value.");
      }

      return (element.textContent || "").trim();
    };

    /** The trend chip: which way it points, and which way it was coloured. */
    interface TrendIndicator {
      tone: "good" | "bad";
      text: string;
    }

    type GetTrendIndicatorFunction = (container: HTMLElement) => TrendIndicator;

    const getTrendIndicator: GetTrendIndicatorFunction = (
      container: HTMLElement,
    ): TrendIndicator => {
      const good: Element | null = container.querySelector(
        "span.text-emerald-500",
      );
      const bad: Element | null = container.querySelector("span.text-red-500");

      if (good && !bad) {
        return { tone: "good", text: (good.textContent || "").trim() };
      }

      if (bad && !good) {
        return { tone: "bad", text: (bad.textContent || "").trim() };
      }

      throw new Error(
        "Value widget did not render exactly one trend indicator.",
      );
    };

    /*
     * Ends in ".utilization", so ValueFormatter.isFractionMetric matches it —
     * a perfectly ordinary thing to call a cache hit-rate query.
     */
    const FRACTION_LOOKING_TITLE: string = "cache.hit.utilization";

    /*
     * Contains "error", so ValueFormatter.isHigherWorseMetric matches it,
     * while carrying none of the "higher is better" tokens that regex checks
     * first.
     */
    const HIGHER_WORSE_LOOKING_TITLE: string = "api.error.rate";

    /*
     * Four points is the minimum the trend calculation looks at, and the
     * second half averages double the first — an unambiguous rise, so the
     * only thing left in question is its colour.
     */
    const RISING_SERIES: Array<AggregatedModel> = [
      buildPoint(10, "2026-08-10T09:10:00.000Z"),
      buildPoint(10, "2026-08-10T09:20:00.000Z"),
      buildPoint(20, "2026-08-10T09:30:00.000Z"),
      buildPoint(20, "2026-08-10T09:40:00.000Z"),
    ];

    const FRACTION_GAUGE_ARGS: DashboardDataSourceGaugeComponent["arguments"] =
      {
        query: { dataSourceId: "ds-prom", query: "cache_hit_rate" },
        gaugeTitle: FRACTION_LOOKING_TITLE,
        unit: "1",
        minValue: 0,
        maxValue: 100,
        warningThreshold: 50,
        criticalThreshold: 80,
      };

    test("value widget shows 0.9 as 0.9, not as the percent its title implies", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([buildPoint(0.9, "2026-08-10T09:30:00.000Z")]),
      );

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "cache_hit_rate" },
        title: FRACTION_LOOKING_TITLE,
        unit: "1",
      });

      await waitFor((): void => {
        expect(getBigNumberText(rendered.container)).toBe("0.9");
      });

      // 90.00% is exactly what isFractionMetric would have produced here.
      expect(rendered.container.textContent).not.toContain("90.00");
      expect(getBigNumberText(rendered.container)).not.toContain("%");
    });

    test("the same value widget does render a percent when the UNIT says so", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([buildPoint(0.9, "2026-08-10T09:30:00.000Z")]),
      );

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "cache_hit_rate" },
        title: FRACTION_LOOKING_TITLE,
        unit: "%",
      });

      /*
       * The percent path is alive and the title is unchanged — so the test
       * above is pinning where the "%" decision comes from, not the absence
       * of percent rendering. Still 0.9, not 90: only the fraction heuristic
       * rescales, and it did not fire here either.
       */
      await waitFor((): void => {
        expect(getBigNumberText(rendered.container)).toBe("0.90%");
      });
    });

    test("gauge widget compares 0.9 against its thresholds unscaled", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([buildPoint(0.9, "2026-08-10T09:30:00.000Z")]),
      );

      const rendered: RenderResult = renderGaugeWidget(FRACTION_GAUGE_ARGS);

      /*
       * Thresholds are authored on the gauge's own 0-100 scale. Rescaled,
       * 0.9 would become 90 and cross the critical line at 80; unscaled it
       * sits below both, which is what the user configured.
       */
      await waitFor((): void => {
        expect(screen.getByText("Healthy")).toBeInTheDocument();
      });

      expect(getBigNumberText(rendered.container)).toBe("0.9");
      expect(screen.queryByText("Critical")).not.toBeInTheDocument();
      expect(screen.queryByText("Warning")).not.toBeInTheDocument();
    });

    test("the same gauge does go Critical once the value really is 90", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([buildPoint(90, "2026-08-10T09:30:00.000Z")]),
      );

      const rendered: RenderResult = renderGaugeWidget(FRACTION_GAUGE_ARGS);

      /*
       * Same widget, same thresholds, same title — only the number moved.
       * The critical branch is reachable, so the Healthy above is a
       * statement about the scale of the value, not about dead thresholds.
       */
      await waitFor((): void => {
        expect(screen.getByText("Critical")).toBeInTheDocument();
      });

      expect(getBigNumberText(rendered.container)).toBe("90");
      expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    });

    test("the same gauge does render a percent when the UNIT says so", async () => {
      fetchTimeSeriesMock.mockResolvedValue(
        buildSeries([buildPoint(0.9, "2026-08-10T09:30:00.000Z")]),
      );

      const rendered: RenderResult = renderGaugeWidget({
        ...FRACTION_GAUGE_ARGS,
        unit: "%",
      });

      await waitFor((): void => {
        expect(getBigNumberText(rendered.container)).toBe("0.90%");
      });

      // A percent SUFFIX, still no rescale — and still below the thresholds.
      expect(screen.getByText("Healthy")).toBeInTheDocument();
    });

    test("value widget colours a rise green even under an error-shaped title", async () => {
      fetchTimeSeriesMock.mockResolvedValue(buildSeries(RISING_SERIES));

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "sum(rate(x[5m]))" },
        title: HIGHER_WORSE_LOOKING_TITLE,
        // trendDirection deliberately unset — this is the heuristic's branch.
      });

      await waitFor((): void => {
        expect(getBigNumberText(rendered.container)).toBe("20");
      });

      const trend: TrendIndicator = getTrendIndicator(rendered.container);
      expect(trend.text).toContain("↑");
      // The empty-metricName default: nothing known, so up is good.
      expect(trend.tone).toBe("good");
    });

    test("an explicit Auto is the same heuristic branch, and still reads up as good", async () => {
      fetchTimeSeriesMock.mockResolvedValue(buildSeries(RISING_SERIES));

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "sum(rate(x[5m]))" },
        title: HIGHER_WORSE_LOOKING_TITLE,
        trendDirection: DashboardValueTrendDirection.Auto,
      });

      await waitFor((): void => {
        expect(getBigNumberText(rendered.container)).toBe("20");
      });

      expect(getTrendIndicator(rendered.container).tone).toBe("good");
    });

    test("the same rise IS painted red when the widget explicitly says so", async () => {
      fetchTimeSeriesMock.mockResolvedValue(buildSeries(RISING_SERIES));

      const rendered: RenderResult = renderValueWidget({
        query: { dataSourceId: "ds-prom", query: "sum(rate(x[5m]))" },
        title: HIGHER_WORSE_LOOKING_TITLE,
        trendDirection: DashboardValueTrendDirection.HigherIsWorse,
      });

      await waitFor((): void => {
        expect(getBigNumberText(rendered.container)).toBe("20");
      });

      /*
       * The inverted colouring is reachable through configuration, so the
       * green above is a statement about where the decision came from.
       */
      const trend: TrendIndicator = getTrendIndicator(rendered.container);
      expect(trend.text).toContain("↑");
      expect(trend.tone).toBe("bad");
    });
  });
});
