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
 * A chart query may fall back to another when it has no data in the window
 * (MetricQueryConfigData.fallback). The Kubernetes dashboard's "Container
 * Restarts Over Time" chart is the one that ships with one: it reads the
 * restarts per interval that kubernetes-agent sends from chart 0.7.1
 * (k8s.container.restarts.increase, summed per bar), and falls back to the
 * running count every agent sends (k8s.container.restarts) - a line that
 * only ever steps up - with a hint that links the agent's upgrade.
 *
 * Drawn here by the real Chart widget, from the template's own stored
 * config, with the data layer answering per metric and per window as a
 * cluster would:
 *
 *   - an upgraded agent's window: both metrics have data;
 *   - an older agent's window: only the running count has data;
 *   - a window with no agent at all: neither has.
 *
 * And a chart without a fallback is held to what it did before: one request,
 * its own query, no hint, empty or not.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();
const openInExplorerMock: MockFunction = getJestMockFunction();

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

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/ExplorerLink",
  () => {
    return {
      __esModule: true,
      default: {
        openInExplorer: (...args: Array<any>) => {
          return openInExplorerMock(...args);
        },
      },
    };
  },
);

/*
 * The widget's job under test is which queries it ASKS for and which it
 * hands the chart to draw; a real recharts surface in jsdom would test
 * neither.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        metricChartsRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          "chart",
        );
      },
    };
  },
);

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const COMPONENT_ID: ObjectID = new ObjectID(
  "33333333-1111-4111-8111-333333333333",
);

const RESTARTS_PER_INTERVAL: string = "k8s.container.restarts.increase";
const RESTART_COUNT: string = "k8s.container.restarts";

const RESTARTS_CHART_TITLE: string = "Container Restarts Over Time";
const MAIN_LEGEND: string = "Restarts per interval";
const FALLBACK_LEGEND: string =
  "Restart count (older agent: upgrade it for restarts per interval)";
const HINT_TEXT: string =
  "Older Kubernetes agents send only the running restart count.";
const HINT_LINK_TEXT: string = "Upgrade the agent";
const UPGRADE_DOCS: string = "/docs/monitor/kubernetes-agent#upgrading";

/*
 * Three windows of one day, each a CUSTOM range so the window is pinned to
 * fixed instants: a relative range would resolve against the wall clock.
 */
function windowAt(hour: number): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(Date.UTC(2026, 9, 31, hour, 0)),
      new Date(Date.UTC(2026, 9, 31, hour + 1, 0)),
    ),
  };
}

const UPGRADED_AGENT_WINDOW: RangeStartAndEndDateTime = windowAt(9);
const OLDER_AGENT_WINDOW: RangeStartAndEndDateTime = windowAt(6);
const NO_AGENT_WINDOW: RangeStartAndEndDateTime = windowAt(3);

function rows(hour: number, values: Array<number>): Array<AggregatedModel> {
  return values.map((value: number, minute: number): AggregatedModel => {
    return {
      timestamp: new Date(Date.UTC(2026, 9, 31, hour, minute * 10)),
      value: value,
    };
  });
}

/*
 * What the cluster holds: per metric, the points of each window (by the
 * hour it starts). The running count only ever steps up; the increase is
 * what happened in each interval.
 */
const CLUSTER_DATA: Record<string, Record<number, Array<AggregatedModel>>> = {
  [RESTARTS_PER_INTERVAL]: {
    9: rows(9, [0, 1, 0, 2, 0, 0]),
  },
  [RESTART_COUNT]: {
    9: rows(9, [5, 6, 6, 8, 8, 8]),
    6: rows(6, [3, 3, 4, 4, 4, 5]),
  },
  "k8s.pod.cpu.usage": {
    9: rows(9, [0.2, 0.3, 0.25]),
  },
};

function answer(metricViewData: MetricViewData): Array<AggregatedResult> {
  const startHour: number = (
    metricViewData.startAndEndDate?.startValue as Date
  ).getUTCHours();

  return metricViewData.queryConfigs.map(
    (config: MetricQueryConfigData): AggregatedResult => {
      const metricName: string = String(
        config.metricQueryData.filterData.metricName,
      );

      return {
        data: CLUSTER_DATA[metricName]?.[startHour] || [],
        truncated: false,
      };
    },
  );
}

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function buildBaseProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "restarts-chart",
    onComponentUpdate: (): void => {
      // The widget under test never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: UPGRADED_AGENT_WINDOW,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  } as DashboardBaseComponentProps;
}

/*
 * The restarts chart exactly as a dashboard created from the Kubernetes
 * template stores it: through JSON, as the dashboard's column holds it.
 */
function storedRestartsChart(): DashboardChartComponent {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Kubernetes,
  );
  const chart: DashboardBaseComponent | undefined = config?.components.find(
    (component: DashboardBaseComponent): boolean => {
      return (
        component.componentType === DashboardComponentType.Chart &&
        (component.arguments as Record<string, unknown>)["chartTitle"] ===
          RESTARTS_CHART_TITLE
      );
    },
  );

  if (!chart) {
    throw new Error("The Kubernetes template has no restarts chart");
  }

  return JSON.parse(JSON.stringify(chart)) as DashboardChartComponent;
}

// A chart of the kind every dashboard has: one query, no fallback.
function plainChart(metricName: string): DashboardChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Chart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 6,
    minHeightInDashboardUnits: 3,
    arguments: {
      chartTitle: "Pod CPU",
      chartType: DashboardChartType.Line,
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a", legend: "CPU Cores" },
        metricQueryData: {
          filterData: {
            metricName: metricName,
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    },
  } as unknown as DashboardChartComponent;
}

function renderChart(
  component: DashboardChartComponent,
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult {
  return render(
    <DashboardChartComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />,
  );
}

interface CapturedChartProps {
  metricViewData: MetricViewData;
  metricResults: Array<AggregatedResult>;
}

function lastChartProps(): CapturedChartProps {
  const calls: Array<Array<unknown>> = metricChartsRenderMock.mock.calls;
  return calls[calls.length - 1]?.[0] as CapturedChartProps;
}

interface CapturedFetchArgs {
  metricViewData: MetricViewData;
  defaultTopN?: boolean;
  topNOverrideScope?: string;
}

function fetchArgs(): Array<CapturedFetchArgs> {
  return fetchResultsMock.mock.calls.map(
    (call: Array<unknown>): CapturedFetchArgs => {
      return call[0] as CapturedFetchArgs;
    },
  );
}

// The metric each request asked for, request by request.
function askedMetrics(): Array<Array<string>> {
  return fetchArgs().map((args: CapturedFetchArgs): Array<string> => {
    return args.metricViewData.queryConfigs.map(
      (config: MetricQueryConfigData): string => {
        return String(config.metricQueryData.filterData.metricName);
      },
    );
  });
}

// What the chart is drawing: each query's metric and legend.
function drawnQueries(): Array<{ metricName: string; legend: string }> {
  return lastChartProps().metricViewData.queryConfigs.map(
    (config: MetricQueryConfigData) => {
      return {
        metricName: String(config.metricQueryData.filterData.metricName),
        legend: String(config.metricAliasData?.legend),
      };
    },
  );
}

function drawnValues(): Array<number> {
  return (lastChartProps().metricResults[0]?.data || []).map(
    (point: AggregatedModel): number => {
      return point.value;
    },
  );
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 4; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  metricChartsRenderMock.mockReset();
  openInExplorerMock.mockReset();
  fetchResultsMock.mockImplementation(
    (args: unknown): Promise<Array<AggregatedResult>> => {
      return Promise.resolve(
        answer((args as CapturedFetchArgs).metricViewData),
      );
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("the Kubernetes restarts chart, which falls back to the running count", () => {
  test("an upgraded agent: restarts per interval, in one request, with no hint", async () => {
    renderChart(storedRestartsChart());

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    await settle();

    expect(askedMetrics()).toEqual([[RESTARTS_PER_INTERVAL]]);
    expect(drawnQueries()).toEqual([
      { metricName: RESTARTS_PER_INTERVAL, legend: MAIN_LEGEND },
    ]);
    expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0]);
    expect(screen.getByText(RESTARTS_CHART_TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
  });

  test("an older agent: the running count, under its own legend, with a hint linking the upgrade", async () => {
    renderChart(storedRestartsChart(), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
    });

    // Asked once for the increase, then once more with the count in its place.
    expect(askedMetrics()).toEqual([[RESTARTS_PER_INTERVAL], [RESTART_COUNT]]);

    // The second request is the fallback in the main query's slot and variable.
    const second: MetricQueryConfigData =
      fetchArgs()[1]!.metricViewData.queryConfigs[0]!;
    expect(second.metricAliasData?.metricVariable).toBe("a");
    expect(second.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );
    expect(second).not.toHaveProperty("fallback");
    // Both read the same window, with the chart's own Top-N scope.
    expect(fetchArgs()[1]!.metricViewData.startAndEndDate).toEqual(
      fetchArgs()[0]!.metricViewData.startAndEndDate,
    );
    expect(fetchArgs()[1]!.defaultTopN).toBe(true);
    expect(fetchArgs()[1]!.topNOverrideScope).toBe(COMPONENT_ID.toString());

    expect(drawnQueries()).toEqual([
      { metricName: RESTART_COUNT, legend: FALLBACK_LEGEND },
    ]);
    expect(drawnValues()).toEqual([3, 3, 4, 4, 4, 5]);

    const hint: HTMLElement = screen.getByTestId("chart-fallback-hint");
    expect(hint).toHaveTextContent(`${HINT_TEXT} ${HINT_LINK_TEXT}`);

    const link: HTMLElement = screen.getByRole("link", {
      name: HINT_LINK_TEXT,
    });
    expect(link).toHaveAttribute("href", UPGRADE_DOCS);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("no agent at all: the main query's empty chart, with no hint and no error", async () => {
    renderChart(storedRestartsChart(), {
      dashboardStartAndEndDate: NO_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalledTimes(2);
    });
    await settle();

    expect(askedMetrics()).toEqual([[RESTARTS_PER_INTERVAL], [RESTART_COUNT]]);
    expect(drawnQueries()).toEqual([
      { metricName: RESTARTS_PER_INTERVAL, legend: MAIN_LEGEND },
    ]);
    expect(drawnValues()).toEqual([]);
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
    expect(screen.getByText(RESTARTS_CHART_TITLE)).toBeInTheDocument();
  });

  test("switching the time range decides again: per interval, the running count, then per interval", async () => {
    const component: DashboardChartComponent = storedRestartsChart();
    const { rerender } = renderChart(component);

    await waitFor(() => {
      expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0]);
    });
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();

    // The days before the agent was upgraded.
    rerender(
      <DashboardChartComponentElement
        {...buildBaseProps({ dashboardStartAndEndDate: OLDER_AGENT_WINDOW })}
        component={component}
      />,
    );

    await waitFor(() => {
      expect(drawnValues()).toEqual([3, 3, 4, 4, 4, 5]);
    });
    expect(drawnQueries()[0]?.legend).toBe(FALLBACK_LEGEND);
    expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();

    // And back.
    rerender(
      <DashboardChartComponentElement
        {...buildBaseProps({ dashboardStartAndEndDate: UPGRADED_AGENT_WINDOW })}
        component={component}
      />,
    );

    await waitFor(() => {
      expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0]);
    });
    expect(drawnQueries()).toEqual([
      { metricName: RESTARTS_PER_INTERVAL, legend: MAIN_LEGEND },
    ]);
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
    // Three loads; only the older agent's needed a second request.
    expect(askedMetrics()).toEqual([
      [RESTARTS_PER_INTERVAL],
      [RESTARTS_PER_INTERVAL],
      [RESTART_COUNT],
      [RESTARTS_PER_INTERVAL],
    ]);
  });

  test("the fallback follows the dashboard's variables, as the main query does", async () => {
    const variables: Array<DashboardVariable> = [
      {
        id: "cluster",
        name: "cluster",
        label: "Cluster",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "resource.k8s.cluster.name",
        selectedValue: "prod-eu",
      },
      {
        id: "namespace",
        name: "namespace",
        label: "Namespace",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "resource.k8s.namespace.name",
        isMultiSelect: true,
        selectedValues: ["payments", "checkout"],
      },
    ];

    renderChart(storedRestartsChart(), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
      variables: variables,
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalledTimes(2);
    });

    for (const args of fetchArgs()) {
      const attributes: Record<string, unknown> = args.metricViewData
        .queryConfigs[0]!.metricQueryData.filterData.attributes as Record<
        string,
        unknown
      >;

      expect(attributes["resource.k8s.cluster.name"]).toBe("prod-eu");
      expect(attributes["resource.k8s.namespace.name"]).toEqual(
        new Includes(["payments", "checkout"]),
      );
    }

    await waitFor(() => {
      expect(drawnQueries()[0]?.metricName).toBe(RESTART_COUNT);
    });
    expect(
      (
        lastChartProps().metricViewData.queryConfigs[0]!.metricQueryData
          .filterData.attributes as Record<string, unknown>
      )["resource.k8s.cluster.name"],
    ).toBe("prod-eu");
  });

  test("Open in Metric Explorer opens the query the chart is drawing", async () => {
    renderChart(storedRestartsChart(), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open in Metric Explorer" }),
    );

    expect(openInExplorerMock).toHaveBeenCalledTimes(1);
    const opened: MetricViewData = openInExplorerMock.mock
      .calls[0]![0] as MetricViewData;
    expect(
      opened.queryConfigs.map((config: MetricQueryConfigData): string => {
        return String(config.metricQueryData.filterData.metricName);
      }),
    ).toEqual([RESTART_COUNT]);
  });

  test("a fallback that cannot be read leaves the main query's chart, with no error", async () => {
    fetchResultsMock.mockImplementation(
      (args: unknown): Promise<Array<AggregatedResult>> => {
        const data: MetricViewData = (args as CapturedFetchArgs).metricViewData;

        if (
          data.queryConfigs[0]?.metricQueryData.filterData.metricName ===
          RESTART_COUNT
        ) {
          // Fails once the widget is waiting for it, as a request does.
          return new Promise(
            (
              _resolve: (value: Array<AggregatedResult>) => void,
              reject: (error: Error) => void,
            ): void => {
              setTimeout((): void => {
                reject(new Error("The fallback could not be read."));
              }, 0);
            },
          );
        }

        return Promise.resolve(answer(data));
      },
    );

    renderChart(storedRestartsChart(), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    await settle();

    expect(drawnQueries()).toEqual([
      { metricName: RESTARTS_PER_INTERVAL, legend: MAIN_LEGEND },
    ]);
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
    expect(screen.queryByText("The fallback could not be read.")).toBeNull();
  });

  test("a late fallback answer for an old window never lands on the new one", async () => {
    // The older agent's fallback answers only when the test says so.
    const pending: { release: (() => void) | null } = { release: null };

    fetchResultsMock.mockImplementation(
      (args: unknown): Promise<Array<AggregatedResult>> => {
        const data: MetricViewData = (args as CapturedFetchArgs).metricViewData;
        const isFallback: boolean =
          data.queryConfigs[0]?.metricQueryData.filterData.metricName ===
          RESTART_COUNT;

        if (isFallback && !pending.release) {
          return new Promise(
            (resolve: (value: Array<AggregatedResult>) => void) => {
              pending.release = (): void => {
                resolve(answer(data));
              };
            },
          );
        }

        return Promise.resolve(answer(data));
      },
    );

    const component: DashboardChartComponent = storedRestartsChart();
    const { rerender } = renderChart(component, {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalledTimes(2);
    });

    // The reader moves on to the upgraded agent's window before it answers.
    rerender(
      <DashboardChartComponentElement
        {...buildBaseProps({ dashboardStartAndEndDate: UPGRADED_AGENT_WINDOW })}
        component={component}
      />,
    );

    await waitFor(() => {
      expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0]);
    });

    expect(pending.release).not.toBeNull();

    act(() => {
      pending.release?.();
    });
    await settle();

    expect(drawnQueries()).toEqual([
      { metricName: RESTARTS_PER_INTERVAL, legend: MAIN_LEGEND },
    ]);
    expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0]);
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
  });
});

describe("a chart without a fallback is drawn as before", () => {
  test("with data: one request, its own query, no hint", async () => {
    renderChart(plainChart("k8s.pod.cpu.usage"));

    await waitFor(() => {
      expect(drawnValues()).toEqual([0.2, 0.3, 0.25]);
    });
    await settle();

    expect(askedMetrics()).toEqual([["k8s.pod.cpu.usage"]]);
    expect(drawnQueries()).toEqual([
      { metricName: "k8s.pod.cpu.usage", legend: "CPU Cores" },
    ]);
    // The very queries it asked for are the ones it draws.
    expect(lastChartProps().metricResults).toEqual(
      answer(fetchArgs()[0]!.metricViewData),
    );
    expect(screen.queryByTestId("chart-fallback-hints")).toBeNull();
  });

  test("empty: still one request, its own empty chart, no hint", async () => {
    renderChart(plainChart("k8s.pod.cpu.usage"), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    await settle();

    expect(askedMetrics()).toEqual([["k8s.pod.cpu.usage"]]);
    expect(drawnQueries()).toEqual([
      { metricName: "k8s.pod.cpu.usage", legend: "CPU Cores" },
    ]);
    expect(drawnValues()).toEqual([]);
    expect(screen.queryByTestId("chart-fallback-hints")).toBeNull();
  });

  test("a fallback on an additional query is honoured in that query's slot only", async () => {
    const component: DashboardChartComponent = plainChart("k8s.pod.cpu.usage");
    const restarts: MetricQueryConfigData = storedRestartsChart().arguments
      .metricQueryConfig as MetricQueryConfigData;

    component.arguments.metricQueryConfigs = [
      {
        ...restarts,
        metricAliasData: { ...restarts.metricAliasData!, metricVariable: "b" },
      },
    ];

    renderChart(component, { dashboardStartAndEndDate: OLDER_AGENT_WINDOW });

    await waitFor(() => {
      expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
    });

    expect(askedMetrics()).toEqual([
      ["k8s.pod.cpu.usage", RESTARTS_PER_INTERVAL],
      ["k8s.pod.cpu.usage", RESTART_COUNT],
    ]);
    expect(drawnQueries()).toEqual([
      { metricName: "k8s.pod.cpu.usage", legend: "CPU Cores" },
      { metricName: RESTART_COUNT, legend: FALLBACK_LEGEND },
    ]);
    expect(
      lastChartProps().metricViewData.queryConfigs[1]?.metricAliasData
        ?.metricVariable,
    ).toBe("b");
  });
});

describe("a fallback's hint", () => {
  function chartWithHintLink(linkUrl: string): DashboardChartComponent {
    const component: DashboardChartComponent = storedRestartsChart();
    const query: MetricQueryConfigData = component.arguments
      .metricQueryConfig as MetricQueryConfigData;

    query.fallback = {
      ...query.fallback!,
      hint: { ...query.fallback!.hint!, linkUrl: linkUrl },
    };

    return component;
  }

  test.each([
    "javascript:alert(document.cookie)",
    "//evil.example.com/docs",
    "data:text/html,<script>alert(1)</script>",
  ])("keeps its words but draws no link to %s", async (linkUrl: string) => {
    renderChart(chartWithHintLink(linkUrl), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
    });

    await waitFor(() => {
      expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
    });

    expect(screen.getByTestId("chart-fallback-hint")).toHaveTextContent(
      HINT_TEXT,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(HINT_LINK_TEXT)).toBeNull();
  });

  test("a click on its link does not also select the widget", async () => {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <div onClick={onClick as unknown as React.MouseEventHandler}>
        <DashboardChartComponentElement
          {...buildBaseProps({ dashboardStartAndEndDate: OLDER_AGENT_WINDOW })}
          component={storedRestartsChart()}
        />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
    });

    const link: HTMLElement = screen.getByRole("link", {
      name: HINT_LINK_TEXT,
    });
    // jsdom does not open pages: keep the browser's own part out of it.
    link.addEventListener("click", (event: Event): void => {
      event.preventDefault();
    });

    fireEvent.click(link);

    expect(onClick).not.toHaveBeenCalled();
  });
});

/*
 * Scoped to a workload by a variable of the dashboard's own - a Deployment
 * picker on resource.k8s.deployment.name, say - the chart's queries read
 * that workload's series alone. kubernetes-agent sends the restarts per
 * interval with the workload names of the container's pod (its metrics
 * pipeline gives them the names it gives the running count), so the chart
 * draws that Deployment's restarts per interval. An agent that sends them
 * without the names has none for the Deployment, and the chart falls back
 * to the running count, which carries them, with the upgrade hint - which
 * is what that agent needs.
 */
describe("the Kubernetes restarts chart, scoped to a workload by a dashboard variable", () => {
  const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";

  interface StoredSeries {
    metricName: string;
    hour: number;
    attributes: Record<string, string>;
    points: Array<AggregatedModel>;
  }

  // Two Deployments' containers, in the upgraded and the older agent's windows.
  function storedSeries(): Array<StoredSeries> {
    const upgraded: number = 9;
    const older: number = 6;
    const checkout: Record<string, string> = {
      "resource.k8s.namespace.name": "payments",
      [DEPLOYMENT_KEY]: "checkout",
    };
    const search: Record<string, string> = {
      "resource.k8s.namespace.name": "payments",
      [DEPLOYMENT_KEY]: "search",
    };

    return [
      // An upgraded agent: the increase carries the Deployment's name.
      {
        metricName: RESTARTS_PER_INTERVAL,
        hour: upgraded,
        attributes: checkout,
        points: rows(upgraded, [0, 1, 0, 2, 0, 0]),
      },
      {
        metricName: RESTARTS_PER_INTERVAL,
        hour: upgraded,
        attributes: search,
        points: rows(upgraded, [3, 0, 0, 0, 0, 1]),
      },
      {
        metricName: RESTART_COUNT,
        hour: upgraded,
        attributes: checkout,
        points: rows(upgraded, [5, 6, 6, 8, 8, 8]),
      },
      // An agent from before: the increase has the namespace, not the name.
      {
        metricName: RESTARTS_PER_INTERVAL,
        hour: older,
        attributes: { "resource.k8s.namespace.name": "payments" },
        points: rows(older, [0, 1, 0, 1, 0, 0]),
      },
      {
        metricName: RESTART_COUNT,
        hour: older,
        attributes: checkout,
        points: rows(older, [3, 3, 4, 4, 4, 5]),
      },
      {
        metricName: RESTART_COUNT,
        hour: older,
        attributes: search,
        points: rows(older, [9, 9, 9, 9, 9, 9]),
      },
    ];
  }

  function selects(
    series: StoredSeries,
    filter: Record<string, unknown>,
  ): boolean {
    return Object.entries(filter).every(
      ([key, value]: [string, unknown]): boolean => {
        if (value instanceof Includes) {
          return (value.values as Array<string>).includes(
            series.attributes[key] as string,
          );
        }
        return series.attributes[key] === value;
      },
    );
  }

  // The data layer: each query's series its attribute filters select.
  function answerByAttributes(
    metricViewData: MetricViewData,
  ): Array<AggregatedResult> {
    const startHour: number = (
      metricViewData.startAndEndDate?.startValue as Date
    ).getUTCHours();

    return metricViewData.queryConfigs.map(
      (config: MetricQueryConfigData): AggregatedResult => {
        const filter: Record<string, unknown> =
          (config.metricQueryData.filterData.attributes as
            | Record<string, unknown>
            | undefined) || {};

        return {
          data: storedSeries()
            .filter((series: StoredSeries): boolean => {
              return (
                series.metricName ===
                  String(config.metricQueryData.filterData.metricName) &&
                series.hour === startHour &&
                selects(series, filter)
              );
            })
            .flatMap((series: StoredSeries): Array<AggregatedModel> => {
              return series.points;
            }),
          truncated: false,
        };
      },
    );
  }

  function deploymentVariable(
    selected: string | Array<string>,
  ): DashboardVariable {
    return {
      id: "deployment",
      name: "deployment",
      label: "Deployment",
      type: DashboardVariableType.TelemetryAttribute,
      attributeKey: DEPLOYMENT_KEY,
      ...(Array.isArray(selected)
        ? { isMultiSelect: true, selectedValues: selected }
        : { selectedValue: selected }),
    } as DashboardVariable;
  }

  function askedAttributes(): Array<Record<string, unknown>> {
    return fetchArgs().map(
      (args: CapturedFetchArgs): Record<string, unknown> => {
        return (args.metricViewData.queryConfigs[0]!.metricQueryData.filterData
          .attributes || {}) as Record<string, unknown>;
      },
    );
  }

  beforeEach(() => {
    fetchResultsMock.mockImplementation(
      (args: unknown): Promise<Array<AggregatedResult>> => {
        return Promise.resolve(
          answerByAttributes((args as CapturedFetchArgs).metricViewData),
        );
      },
    );
  });

  test("an agent that sends the workload names: that Deployment's restarts per interval, in one request, with no hint", async () => {
    renderChart(storedRestartsChart(), {
      variables: [deploymentVariable("checkout")],
    });

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    await settle();

    expect(askedMetrics()).toEqual([[RESTARTS_PER_INTERVAL]]);
    expect(askedAttributes()[0]![DEPLOYMENT_KEY]).toBe("checkout");
    expect(drawnQueries()).toEqual([
      { metricName: RESTARTS_PER_INTERVAL, legend: MAIN_LEGEND },
    ]);
    // checkout's alone, not search's.
    expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0]);
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
  });

  test("and the Deployments a multi-select picks, in one request", async () => {
    renderChart(storedRestartsChart(), {
      variables: [deploymentVariable(["checkout", "search"])],
    });

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    await settle();

    expect(askedMetrics()).toEqual([[RESTARTS_PER_INTERVAL]]);
    expect(askedAttributes()[0]![DEPLOYMENT_KEY]).toEqual(
      new Includes(["checkout", "search"]),
    );
    expect(drawnValues()).toEqual([0, 1, 0, 2, 0, 0, 3, 0, 0, 0, 0, 1]);
    expect(screen.queryByTestId("chart-fallback-hint")).toBeNull();
  });

  test("an agent that sends the increase without them: the Deployment's running count, with the upgrade hint", async () => {
    renderChart(storedRestartsChart(), {
      dashboardStartAndEndDate: OLDER_AGENT_WINDOW,
      variables: [deploymentVariable("checkout")],
    });

    await waitFor(() => {
      expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
    });

    // The scoped increase is empty; the scoped running count is not.
    expect(askedMetrics()).toEqual([[RESTARTS_PER_INTERVAL], [RESTART_COUNT]]);
    for (const attributes of askedAttributes()) {
      expect(attributes[DEPLOYMENT_KEY]).toBe("checkout");
    }
    expect(drawnQueries()).toEqual([
      { metricName: RESTART_COUNT, legend: FALLBACK_LEGEND },
    ]);
    expect(drawnValues()).toEqual([3, 3, 4, 4, 4, 5]);
    expect(screen.getByRole("link", { name: HINT_LINK_TEXT })).toHaveAttribute(
      "href",
      UPGRADE_DOCS,
    );
  });
});
