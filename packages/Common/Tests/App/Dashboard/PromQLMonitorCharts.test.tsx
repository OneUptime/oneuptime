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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission from "../../../Types/Permission";

/*
 * Issue #10227: a Metrics monitor written in PromQL charts its expression -
 * on its Overview every series of it, on an incident or alert it opened the
 * one series that opened it, on its Criteria page the step's preview - with
 * the value it alerts at as a line, the side that alerts shaded, and the
 * moments that matter marked. Each reads through the built-in PromQL source
 * (PromQLQueryUtil.queryMonitorRange: the API's engine and limits, as the
 * person viewing), and draws the chart's shape while it reads.
 *
 * The card, the panel, the investigation, the chart and the time picker
 * are real. The chart layer is stood in for by what it is handed, with a
 * button for a drag; the PromQL read, the builder's metric reads, the
 * event markers and the record reads are stood in for too.
 */

const queryMonitorRangeMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const eventLinesInputs: Array<Record<string, unknown>> = [];
let mockPermissions: Array<Permission> = [Permission.ProjectOwner];

interface MockChartsProps {
  metricResults: Array<{ data: Array<Record<string, unknown>> }>;
  metricViewData: {
    startAndEndDate: { startValue: Date; endValue: Date } | null;
    queryConfigs: Array<{
      metricAliasData?: { metricVariable?: string; legend?: string };
    }>;
  };
  thresholds?: Array<Record<string, unknown>> | undefined;
  thresholdLinesExtendAxis?: boolean | undefined;
  timeReferenceLines?:
    | Array<{ label?: string; subtitle?: string; color?: string }>
    | undefined;
  referenceRegions?: Array<Record<string, unknown>> | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
}

let lastCharts: MockChartsProps | null = null;

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/PromQLQuery", () => {
  return {
    __esModule: true,
    default: {
      queryMonitorRange: (...args: Array<unknown>) => {
        return queryMonitorRangeMock(...args);
      },
      queryRange: () => {
        return Promise.reject(new Error("Not this read."));
      },
      queryInstant: () => {
        return Promise.reject(new Error("Not this read."));
      },
      getMetricNames: () => {
        return Promise.resolve([]);
      },
      getPrometheusServerUrl: () => {
        return "https://oneuptime.example.com/api/prometheus";
      },
      getStepInSeconds: () => {
        return 15;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        lastCharts = props;

        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(
                  new Date("2026-11-07T10:00:00.000Z"),
                  new Date("2026-11-07T10:30:00.000Z"),
                );
              }}
            >
              Drag across the chart
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (input: Record<string, unknown>) => {
        eventLinesInputs.push(input);
        return {
          lines: input["enabled"]
            ? [
                {
                  date: new Date("2026-11-07T10:31:00.000Z"),
                  label: "Incident: API is down",
                  subtitle: "Incident · Critical",
                },
              ]
            : [],
          markerCount: input["enabled"] ? 1 : 0,
        };
      },
    };
  },
);

function mockViewer(name: string): unknown {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid={`viewer-${name}`} />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockViewer("logs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return mockViewer("traces");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return mockViewer("exceptions");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {};
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return mockPermissions;
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import MonitorMetricsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MetricMonitor/MonitorMetricsCard";
import MonitorStepMetricPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview";
import EventMetricInvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import PromQLMonitorChart, {
  PROMQL_MONITOR_CHART_CUT_TEST_ID,
  PROMQL_MONITOR_CHART_EMPTY_TEST_ID,
  PROMQL_MONITOR_CHART_ERROR_TEST_ID,
  PROMQL_MONITOR_CHART_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/PromQL/PromQLMonitorChart";
import { PROMQL_INVESTIGATION_QUERY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/PromQLInvestigation";
import { EventMetricSubject } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";
import { CHART_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/ChartSkeleton";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import {
  MetricMonitorQueryLanguage,
  MonitorStepMetricMonitorUtil,
  PROMQL_METRIC_ALIAS,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import { PrometheusSeries } from "../../../Utils/PromQL/PrometheusResponse";
import { StateListType } from "../../../Utils/StateOrder";

const NOW: Date = new Date("2026-11-07T12:00:00.000Z");
const THREE_HOURS_AGO: string = "2026-11-07T09:00:00.000Z";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ONLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const INCIDENT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE_ID: string = "errors-above-5";

const EXPRESSION: string = "sum by (job, instance) (rate(errors_total[5m]))";

// The two series the expression returns, as the built-in source hands them.
const API_SERIES: Array<PrometheusSeries> = [
  {
    labels: { job: "api", instance: "a:9090" },
    points: [
      { timestampMs: Date.parse("2026-11-07T11:00:00.000Z"), value: 3 },
      { timestampMs: Date.parse("2026-11-07T11:05:00.000Z"), value: 8 },
    ],
  },
  {
    labels: { job: "api", instance: "b:9090" },
    points: [{ timestampMs: Date.parse("2026-11-07T11:00:00.000Z"), value: 1 }],
  },
];

// The query the step kept from before it was switched to PromQL.
const BUILDER_QUERY: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricQueryData: {
    filterData: {
      metricName: "kept.builder.metric",
      aggegationType: MetricsAggregationType.Avg,
    } as never,
  },
};

// "Errors above 5": opens an incident and takes the monitor offline.
const ruleOf: (value: number) => MonitorCriteriaInstance = (
  value: number,
): MonitorCriteriaInstance => {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    id: RULE_ID,
    name: "Errors above 5",
    description: "",
    filterCondition: "Any" as never,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: value,
        metricMonitorOptions: { metricAlias: PROMQL_METRIC_ALIAS },
      },
    ],
    incidents: [{ id: "i", title: "t", description: "d" } as never],
    alerts: [],
    createIncidents: true,
    createAlerts: false,
    changeMonitorStatus: true,
    monitorStatusId: OFFLINE,
  };
  return rule;
};

const promQLStepOf: (data?: {
  query?: string;
  serviceIds?: Array<string>;
  value?: number;
}) => MonitorStep = (data?: {
  query?: string;
  serviceIds?: Array<string>;
  value?: number;
}): MonitorStep => {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: "step-promql",
    monitorCriteria: {
      data: {
        monitorCriteriaInstanceArray: [
          ruleOf(data?.value === undefined ? 5 : data.value),
        ],
      },
    },
    metricMonitor: {
      queryLanguage: MetricMonitorQueryLanguage.PromQL,
      promQLQuery: data?.query === undefined ? EXPRESSION : data.query,
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: { queryConfigs: [BUILDER_QUERY], formulaConfigs: [] },
      ...(data?.serviceIds
        ? {
            telemetryServiceIds: data.serviceIds.map((id: string) => {
              return new ObjectID(id);
            }),
          }
        : {}),
    },
  } as unknown as MonitorStep["data"];
  return step;
};

const stepsOf: (...steps: Array<MonitorStep>) => MonitorSteps = (
  ...steps: Array<MonitorStep>
): MonitorSteps => {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ONLINE,
  };
  return monitorSteps;
};

interface MonitorRangeRead {
  query: string;
  startDate: Date;
  endDate: Date;
  serviceIds?: Array<string> | undefined;
  seriesLabels?: JSONObject | undefined;
}

function reads(): Array<MonitorRangeRead> {
  return queryMonitorRangeMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as MonitorRangeRead;
  });
}

function lastRead(): MonitorRangeRead {
  const all: Array<MonitorRangeRead> = reads();
  return all[all.length - 1]!;
}

function answerWith(series: Array<PrometheusSeries>, isCut?: boolean): void {
  queryMonitorRangeMock.mockImplementation(() => {
    return Promise.resolve({ series, isCut: Boolean(isCut) });
  });
}

function renderCard(monitorSteps: MonitorSteps): RenderResult {
  return render(
    <MonitorMetricsCard
      monitorId={MONITOR_ID}
      monitorType={MonitorType.Metrics}
      monitorSteps={monitorSteps}
    />,
  );
}

async function chartShown(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
  jest.setSystemTime(NOW);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/dashboard/p/monitors/m-1");
  mockPermissions = [Permission.ProjectOwner];
  queryMonitorRangeMock.mockReset();
  answerWith(API_SERIES);
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([]);
  });
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });
  getItemMock.mockReset();
  getItemMock.mockImplementation(() => {
    return Promise.resolve(null);
  });
  eventLinesInputs.length = 0;
  lastCharts = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a PromQL monitor's Overview", () => {
  test("charts its expression, every series of it, for the services it reads, over the past three hours", async () => {
    renderCard(stepsOf(promQLStepOf({ serviceIds: [SERVICE_ID] })));
    await chartShown();

    expect(screen.getByRole("heading", { name: "Metrics" })).toBeVisible();
    expect(
      screen.getByTestId(PROMQL_INVESTIGATION_QUERY_TEST_ID),
    ).toHaveTextContent(EXPRESSION);
    // An expression reads left to right in every language.
    expect(
      screen.getByTestId(PROMQL_INVESTIGATION_QUERY_TEST_ID),
    ).toHaveAttribute("dir", "ltr");

    expect(lastRead().query).toBe(EXPRESSION);
    expect(lastRead().startDate.toISOString()).toBe(THREE_HOURS_AGO);
    expect(lastRead().endDate.toISOString()).toBe(NOW.toISOString());
    expect(lastRead().serviceIds).toEqual([SERVICE_ID]);
    // Every series: the Overview is narrowed to none.
    expect(lastRead().seriesLabels).toBeUndefined();

    // Both series, each point named by its labels.
    expect(
      new Set(
        lastCharts!.metricResults[0]!.data.map(
          (point: Record<string, unknown>) => {
            return point["promQLSeries"];
          },
        ),
      ).size,
    ).toBe(2);

    // Never the builder's query the step kept.
    expect(fetchResultsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("kept.builder.metric")).toBeNull();
  });

  test("draws the value it alerts at as a line on the expression, shading the side that alerts", async () => {
    renderCard(stepsOf(promQLStepOf()));
    await chartShown();

    expect(
      screen.getByText(
        "What this monitor checks, and the values it alerts at.",
      ),
    ).toBeVisible();
    expect(lastCharts?.thresholds).toEqual([
      {
        metricVariable: PROMQL_METRIC_ALIAS,
        value: 5,
        unit: undefined,
        name: "Errors above 5",
        filterType: FilterType.GreaterThan,
        isForecast: false,
        color: "#ef4444",
        shade: "above",
        onlyAtInterval: null,
      },
    ]);
    // On the expression's chart, whatever the series do.
    expect(
      lastCharts?.metricViewData.queryConfigs[0]?.metricAliasData
        ?.metricVariable,
    ).toBe(PROMQL_METRIC_ALIAS);
    expect(lastCharts?.thresholdLinesExtendAxis).toBe(true);
  });

  test("marks the monitor's status changes and the incidents it opened", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve({
        data: [
          {
            startsAt: "2026-11-07T10:30:00.000Z",
            monitorStatus: { name: "Offline", color: "#dc2626" },
          },
        ],
        count: 1,
        skip: 0,
        limit: 50,
      });
    });

    renderCard(stepsOf(promQLStepOf()));
    await chartShown();

    await waitFor(() => {
      expect(
        (lastCharts?.timeReferenceLines || []).map(
          (line: { label?: string }) => {
            return line.label;
          },
        ),
      ).toEqual(["Offline", "Incident: API is down"]);
    });
    expect(
      eventLinesInputs.some((input: Record<string, unknown>) => {
        return (
          input["enabled"] === true &&
          input["monitorId"] === MONITOR_ID.toString()
        );
      }),
    ).toBe(true);
  });

  test("a drag across the chart reads the expression again over what was dragged", async () => {
    renderCard(stepsOf(promQLStepOf()));
    await chartShown();

    fireEvent.click(screen.getByText("Drag across the chart"));

    await waitFor(() => {
      expect(lastRead().startDate.toISOString()).toBe(
        "2026-11-07T10:00:00.000Z",
      );
    });
    expect(lastRead().endDate.toISOString()).toBe("2026-11-07T10:30:00.000Z");
  });

  test("the page's Refresh reads it again", async () => {
    const view: RenderResult = renderCard(stepsOf(promQLStepOf()));
    await chartShown();
    const before: number = reads().length;

    view.rerender(
      <MonitorMetricsCard
        monitorId={MONITOR_ID}
        monitorType={MonitorType.Metrics}
        monitorSteps={stepsOf(promQLStepOf())}
        refreshToken={1}
      />,
    );

    await waitFor(() => {
      expect(reads().length).toBeGreaterThan(before);
    });
  });

  test("says what to check when no series matched, with the way to the criteria", async () => {
    answerWith([]);

    renderCard(stepsOf(promQLStepOf()));

    const empty: HTMLElement = await screen.findByTestId(
      PROMQL_MONITOR_CHART_EMPTY_TEST_ID,
    );
    expect(
      within(empty).getByText(
        "No series matched this query in the time range.",
      ),
    ).toBeVisible();
    expect(within(empty).getByText("Open criteria")).toBeVisible();
    expect(screen.queryByTestId("metric-charts")).toBeNull();
  });

  test("a step with no expression yet has nothing to chart", () => {
    renderCard(stepsOf(promQLStepOf({ query: "  " })));

    expect(queryMonitorRangeMock).not.toHaveBeenCalled();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });
});

describe("the expression's chart", () => {
  const WINDOW: InBetween<Date> = new InBetween<Date>(
    new Date(THREE_HOURS_AGO),
    NOW,
  );

  test("draws the chart's shape while it reads, never a spinner", () => {
    queryMonitorRangeMock.mockImplementation(() => {
      return new Promise(() => {
        // Still reading.
      });
    });

    render(<PromQLMonitorChart query={EXPRESSION} window={WINDOW} />);

    expect(screen.getByTestId(CHART_SKELETON_TEST_ID)).toBeInTheDocument();
    // At the height the chart is drawn at, so the card does not move.
    expect(
      screen.getByTestId(CHART_SKELETON_TEST_ID).querySelector("[style]"),
    ).toHaveStyle({ height: "320px" });
    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(screen.queryByTestId("metric-charts")).toBeNull();
  });

  test("says why the query did not run, in a sentence of its own", async () => {
    queryMonitorRangeMock.mockImplementation(() => {
      return Promise.reject(
        new Error(
          "You do not have permission to read this project's metrics. Ask a Project Owner or Project Admin for a role that reads telemetry.",
        ),
      );
    });

    render(<PromQLMonitorChart query={EXPRESSION} window={WINDOW} />);

    const error: HTMLElement = await screen.findByTestId(
      PROMQL_MONITOR_CHART_ERROR_TEST_ID,
    );
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("The query did not run.");
    expect(error).toHaveTextContent(
      "Ask a Project Owner or Project Admin for a role that reads telemetry.",
    );
  });

  test("says when it charts only the first series the expression returned", async () => {
    answerWith([API_SERIES[0]!], true);

    render(<PromQLMonitorChart query={EXPRESSION} window={WINDOW} />);

    expect(
      await screen.findByTestId(PROMQL_MONITOR_CHART_CUT_TEST_ID),
    ).toHaveTextContent("Showing the first 1 series this expression returns.");
    expect(screen.getByTestId(PROMQL_MONITOR_CHART_TEST_ID)).toBeVisible();
  });

  test("an older read that comes back late never replaces a newer one", async () => {
    let answerOld: (value: unknown) => void = () => {
      // Replaced below.
    };

    queryMonitorRangeMock.mockImplementationOnce(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        answerOld = resolve;
      });
    });

    const view: RenderResult = render(
      <PromQLMonitorChart query="up" window={WINDOW} />,
    );

    answerWith([]);
    view.rerender(<PromQLMonitorChart query="up == 0" window={WINDOW} />);

    await screen.findByTestId(PROMQL_MONITOR_CHART_EMPTY_TEST_ID);

    await act(async () => {
      answerOld({ series: API_SERIES, isCut: false });
      await Promise.resolve();
    });

    expect(
      screen.getByTestId(PROMQL_MONITOR_CHART_EMPTY_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("metric-charts")).toBeNull();
  });
});

describe("the step's preview on the Criteria page", () => {
  test("charts the expression for the step's services, not the builder's queries", async () => {
    render(
      <MonitorStepMetricPreview
        metricsViewConfig={MonitorStepMetricMonitorUtil.getPromQLViewConfig(
          EXPRESSION,
        )}
        rollingTime={RollingTime.Past5Minutes}
        promQLQuery={EXPRESSION}
        serviceIds={[SERVICE_ID]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    expect(lastRead().query).toBe(EXPRESSION);
    expect(lastRead().serviceIds).toEqual([SERVICE_ID]);
    // The window the monitor's checks read.
    expect(lastRead().endDate.getTime() - lastRead().startDate.getTime()).toBe(
      5 * 60 * 1000,
    );
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });
});

describe("an incident the PromQL monitor opened", () => {
  const STARTED_AT: Date = new Date("2026-11-07T10:31:00.000Z");
  const EVALUATED: InBetween<Date> = new InBetween<Date>(
    new Date("2026-11-07T10:26:00.000Z"),
    STARTED_AT,
  );
  const SERIES_LABELS: JSONObject = { job: "api", instance: "a:9090" };

  // What the incident kept of the check: the expression, as its one query.
  const snapshot: TelemetryQuery = {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: EVALUATED,
      queryConfigs:
        MonitorStepMetricMonitorUtil.getPromQLViewConfig(EXPRESSION)
          .queryConfigs,
      formulaConfigs: [],
    },
    metricServiceIds: [SERVICE_ID],
  };

  function monitorReadsAre(monitorSteps: MonitorSteps): void {
    getItemMock.mockImplementation((...args: Array<unknown>) => {
      const request: { modelType: unknown } = args[0] as never;

      if (request.modelType === Incident) {
        return Promise.resolve({
          createdCriteriaId: RULE_ID,
          monitors: [{ id: MONITOR_ID }],
        });
      }

      if (request.modelType === Alert) {
        return Promise.resolve({
          createdCriteriaId: RULE_ID,
          monitorId: MONITOR_ID,
        });
      }

      if (request.modelType === Monitor) {
        return Promise.resolve({
          monitorType: MonitorType.Metrics,
          monitorSteps: monitorSteps,
        });
      }

      return Promise.resolve(null);
    });
  }

  function renderPanel(
    overrides?: Partial<
      React.ComponentProps<typeof EventMetricInvestigationPanel>
    >,
  ): RenderResult {
    return render(
      <EventMetricInvestigationPanel
        telemetryQuery={snapshot}
        evaluationWindow={EVALUATED}
        seriesSummary=""
        seriesLabels={SERIES_LABELS}
        subject={EventMetricSubject.Incident}
        eventId={INCIDENT_ID}
        startedAt={STARTED_AT}
        stateTimeline={[]}
        states={[]}
        stateList={StateListType.IncidentState}
        {...overrides}
      />,
    );
  }

  test("charts the one series that opened it, and says so", async () => {
    monitorReadsAre(stepsOf(promQLStepOf()));

    renderPanel();
    await chartShown();

    expect(lastRead().query).toBe(EXPRESSION);
    expect(lastRead().seriesLabels).toEqual(SERIES_LABELS);
    // The services the check read, as it kept them.
    expect(lastRead().serviceIds).toEqual([SERVICE_ID]);
    expect(
      screen.getByText(
        "Metrics related to this incident, scoped to the affected series (instance = a:9090, job = api).",
      ),
    ).toBeVisible();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("draws the line its rule alerts at, and the span the monitor evaluated", async () => {
    monitorReadsAre(stepsOf(promQLStepOf({ value: 7 })));

    renderPanel();
    await chartShown();

    await waitFor(() => {
      expect(
        (lastCharts?.thresholds || []).map(
          (threshold: Record<string, unknown>) => {
            return [threshold["metricVariable"], threshold["value"]];
          },
        ),
      ).toEqual([[PROMQL_METRIC_ALIAS, 7]]);
    });
    expect(lastCharts?.thresholds?.[0]?.["shade"]).toBe("above");
    expect((lastCharts?.referenceRegions || []).length).toBeGreaterThan(0);
  });

  test("an expression aggregated to one series of no labels charts that series, unscoped", async () => {
    monitorReadsAre(stepsOf(promQLStepOf()));

    renderPanel({ seriesLabels: {} });
    await chartShown();

    expect(lastRead().seriesLabels).toEqual({});
    expect(screen.getByText("Metrics related to this incident.")).toBeVisible();
  });

  test("an incident opened before it kept its series charts every series", async () => {
    monitorReadsAre(stepsOf(promQLStepOf()));

    renderPanel({ seriesLabels: null });
    await chartShown();

    expect(lastRead().seriesLabels).toBeUndefined();
  });
});
