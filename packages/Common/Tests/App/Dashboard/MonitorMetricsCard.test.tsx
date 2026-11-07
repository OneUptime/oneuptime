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
 * A metric monitor's own metrics card (issue #5759), rendered: the queries
 * as the monitor reads them over the past three hours, the criteria's
 * thresholds drawn across them, the monitor's status changes and its
 * incidents and alerts marked, what to check when nothing came back, a
 * picker for a monitor with several steps, and the page's Refresh.
 *
 * The card, the metric investigation, MetricView and the time picker are
 * real. The charts are stood in for by what MetricView hands them, with a
 * button for a drag; the metric reads, the event markers and the status
 * timeline read are stood in for too.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const eventLinesInputs: Array<Record<string, unknown>> = [];
let mockPermissions: Array<Permission> = [Permission.ProjectOwner];

interface MockChartsProps {
  metricViewData: {
    startAndEndDate: { startValue: Date; endValue: Date } | null;
    queryConfigs: Array<{
      metricQueryData: {
        filterData: { metricName?: unknown; attributes?: unknown };
      };
    }>;
    formulaConfigs: Array<unknown>;
  };
  thresholds?: Array<Record<string, unknown>> | undefined;
  timeReferenceLines?:
    | Array<{ label?: string; subtitle?: string; color?: string }>
    | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
}

let lastCharts: MockChartsProps | null = null;

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
          lines: [
            {
              date: new Date("2026-11-07T10:31:00.000Z"),
              label: "Incident: High memory on pve1",
              subtitle: "Incident · Critical",
            },
          ],
          markerCount: 1,
        };
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

import MonitorMetricsCard, {
  MONITOR_METRICS_NO_METRIC_TEST_ID,
  MONITOR_METRICS_PERMISSION_FALLBACK_TEST_ID,
  MONITOR_METRICS_STEP_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MetricMonitor/MonitorMetricsCard";
import {
  METRIC_INVESTIGATION_EMPTY_TEST_ID,
  METRIC_INVESTIGATION_THRESHOLD_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigation";
import MetricInvestigationUrl from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationUrl";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { getProxmoxAlertTemplateById } from "../../../Types/Monitor/ProxmoxAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import Dictionary from "../../../Types/Dictionary";

const NOW: Date = new Date("2026-11-07T12:00:00.000Z");
const THREE_HOURS_AGO: string = "2026-11-07T09:00:00.000Z";
const DAY_AGO: string = "2026-11-06T12:00:00.000Z";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ONLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// The Proxmox template the issue's screenshot shows.
const proxmoxStep: () => MonitorStep = (): MonitorStep => {
  return getProxmoxAlertTemplateById("pve-node-high-memory")!.getMonitorStep({
    clusterIdentifier: "pve",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Proxmox",
  });
};

// A Metrics monitor step: one query, one rule that opens an incident.
const metricsStep: (data: {
  id: string;
  metricName?: string;
  aggregation?: MetricsAggregationType;
  threshold?: number;
  settings?: JSONObject;
}) => MonitorStep = (data: {
  id: string;
  metricName?: string;
  aggregation?: MetricsAggregationType;
  threshold?: number;
  settings?: JSONObject;
}): MonitorStep => {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    id: `${data.id}-rule`,
    name: "Too many",
    description: "",
    filterCondition: "Any" as never,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: data.threshold === undefined ? 10 : data.threshold,
        metricMonitorOptions: { metricAlias: "a" },
      },
    ],
    incidents: [{ id: "i", title: "t", description: "d" } as never],
    alerts: [],
    createIncidents: true,
    createAlerts: false,
    changeMonitorStatus: true,
    monitorStatusId: OFFLINE,
  };

  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: data.id,
    monitorCriteria: { data: { monitorCriteriaInstanceArray: [rule] } },
    metricMonitor: {
      ...(data.settings || {}),
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "a",
              title: "",
              description: "",
              legend: "",
              legendUnit: "",
            },
            metricQueryData: {
              filterData: {
                ...(data.metricName === ""
                  ? {}
                  : { metricName: data.metricName || "http.server.errors" }),
                aggegationType: data.aggregation || MetricsAggregationType.Avg,
              },
            },
          },
        ],
        formulaConfigs: [],
      },
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

function renderCard(data: {
  monitorType: MonitorType;
  monitorSteps: MonitorSteps;
  refreshToken?: number;
}): RenderResult {
  return render(
    <MonitorMetricsCard
      monitorId={MONITOR_ID}
      monitorType={data.monitorType}
      monitorSteps={data.monitorSteps}
      refreshToken={data.refreshToken}
    />,
  );
}

function fetchedData(): Array<MetricViewData> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { metricViewData: MetricViewData }).metricViewData;
  });
}

function lastFetchedWindow(): [string, string] | undefined {
  const data: Array<MetricViewData> = fetchedData();
  const last: MetricViewData | undefined = data[data.length - 1];
  return last?.startAndEndDate
    ? [
        last.startAndEndDate.startValue.toISOString(),
        last.startAndEndDate.endValue.toISOString(),
      ]
    : undefined;
}

async function chartsShown(): Promise<void> {
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
  jest.setSystemTime(NOW);
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("metric-investigation-time-button");
}

function pickRelativeRange(label: string): void {
  jest.setSystemTime(NOW);
  fireEvent.click(pickerButton());
  fireEvent.click(
    within(screen.getByTestId("metric-investigation-time-dropdown")).getByText(
      label,
    ),
  );
}

function thresholdNames(): Array<string> {
  return (lastCharts?.thresholds || []).map(
    (threshold: Record<string, unknown>): string => {
      return String(threshold["name"]);
    },
  );
}

function withData(): void {
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([
      {
        data: [{ timestamp: "2026-11-07T11:00:00.000Z", value: 42 }],
        truncated: false,
      },
      {
        data: [{ timestamp: "2026-11-07T11:00:00.000Z", value: 64 }],
        truncated: false,
      },
    ]);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/dashboard/p/monitors/m-1");
  mockPermissions = [Permission.ProjectOwner];
  fetchResultsMock.mockReset();
  withData();
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });
  eventLinesInputs.length = 0;
  lastCharts = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a Proxmox monitor's overview (the issue's own case)", () => {
  test("charts the monitor's queries as it reads them, over the past three hours", async () => {
    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });
    await chartsShown();

    expect(screen.getByRole("heading", { name: "Metrics" })).toBeVisible();
    expect(
      screen.getByText("What this monitor checks, and the values it alerts at."),
    ).toBeVisible();
    expect(pickerButton()).toHaveTextContent("Past 3 Hours");
    expect(lastFetchedWindow()).toEqual([THREE_HOURS_AGO, NOW.toISOString()]);

    // Narrowed to the cluster the monitor watches, as the worker reads them.
    const fetched: MetricViewData = fetchedData()[0]!;
    expect(fetched.queryConfigs).toHaveLength(2);
    expect(fetched.formulaConfigs).toHaveLength(1);
    for (const queryConfig of fetched.queryConfigs) {
      expect(
        queryConfig.metricQueryData.filterData.attributes as unknown as Dictionary<
          unknown
        >,
      ).toMatchObject({
        "resource.proxmox.cluster.name": "pve",
        "pve.scope": "node",
      });
    }
  });

  test("draws the line the monitor alerts at on the share it compares, in red, shading above it", async () => {
    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });
    await chartsShown();

    expect(lastCharts?.thresholds).toEqual([
      {
        metricVariable: "node_memory_utilization",
        value: 85,
        unit: undefined,
        name: "High Node Memory - Utilization > 85%",
        filterType: FilterType.GreaterThan,
        isForecast: false,
        color: "#ef4444",
        shade: "above",
        onlyAtInterval: null,
      },
    ]);
  });

  test("marks the monitor's status changes, in their colours, and the incidents and alerts it opened", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve({
        data: [
          {
            startsAt: "2026-11-07T11:15:00.000Z",
            monitorStatus: { name: "Operational", color: "#16a34a" },
          },
          {
            startsAt: "2026-11-07T10:30:00.000Z",
            monitorStatus: { name: "Offline", color: "#dc2626" },
          },
        ],
        count: 2,
        skip: 0,
        limit: 50,
      });
    });

    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });
    await chartsShown();

    await waitFor(() => {
      expect(
        (lastCharts?.timeReferenceLines || []).map(
          (line: { label?: string }) => {
            return line.label;
          },
        ),
      ).toEqual(["Offline", "Operational", "Incident: High memory on pve1"]);
    });

    const offline: { subtitle?: string; color?: string } =
      lastCharts!.timeReferenceLines![0]!;
    expect(offline.subtitle).toBe("Monitor status");
    expect(offline.color).toBe("#dc2626");

    // The changes inside the charted window only, the newest fifty.
    const request: {
      query: { monitorId: ObjectID; startsAt: InBetween<Date> };
      limit: number;
    } = getListMock.mock.calls[0]![0] as never;
    expect(request.query.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(request.query.startsAt.startValue.toISOString()).toBe(
      THREE_HOURS_AGO,
    );
    expect(request.limit).toBe(50);

    // Its own incidents and alerts, not whatever its filters would find.
    expect(eventLinesInputs[eventLinesInputs.length - 1]!["monitorId"]).toBe(
      MONITOR_ID.toString(),
    );
  });

  test("a status timeline it may not read leaves the charts as they are", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("Forbidden"));
    });

    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });
    await chartsShown();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });
    expect(
      (lastCharts?.timeReferenceLines || []).map((line: { label?: string }) => {
        return line.label;
      }),
    ).toEqual(["Incident: High memory on pve1"]);
  });

  test("with nothing in the range, says what to check", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve([
        { data: [], truncated: false },
        { data: [], truncated: false },
      ]);
    });

    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });

    const empty: HTMLElement = await screen.findByTestId(
      METRIC_INVESTIGATION_EMPTY_TEST_ID,
    );
    expect(empty).toHaveTextContent(
      "No data for these metrics in this time range.",
    );
    expect(empty).toHaveTextContent(
      "Check that the agent reporting on pve is running and sending metrics.",
    );
    expect(within(empty).getByText("Open criteria")).toBeVisible();
  });

  test("with data, says nothing of the kind", async () => {
    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });
    await chartsShown();

    expect(screen.queryByTestId(METRIC_INVESTIGATION_EMPTY_TEST_ID)).toBeNull();
  });
});

describe("a threshold on a count", () => {
  const countSteps: () => MonitorSteps = (): MonitorSteps => {
    return stepsOf(
      metricsStep({ id: "count", aggregation: MetricsAggregationType.Sum }),
    );
  };

  test("is drawn where each point is a minute, as the monitor counts, and offered back from a longer range", async () => {
    renderCard({ monitorType: MonitorType.Metrics, monitorSteps: countSteps() });
    await chartsShown();

    expect(thresholdNames()).toEqual(["Too many"]);
    expect(
      screen.queryByTestId(METRIC_INVESTIGATION_THRESHOLD_HINT_TEST_ID),
    ).toBeNull();

    pickRelativeRange("Past 1 Day");

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual([DAY_AGO, NOW.toISOString()]);
    });
    expect(lastCharts?.thresholds).toBeUndefined();
    const hint: HTMLElement = screen.getByTestId(
      METRIC_INVESTIGATION_THRESHOLD_HINT_TEST_ID,
    );
    expect(hint).toHaveTextContent(
      "Thresholds on counts show only on ranges whose points cover what the monitor reads.",
    );

    jest.setSystemTime(NOW);
    fireEvent.click(within(hint).getByRole("button", { name: "Show Past 3 Hours" }));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual([THREE_HOURS_AGO, NOW.toISOString()]);
    });
    expect(thresholdNames()).toEqual(["Too many"]);
    expect(
      screen.queryByTestId(METRIC_INVESTIGATION_THRESHOLD_HINT_TEST_ID),
    ).toBeNull();
  });

  test("an average's line holds on a chart of any range", async () => {
    renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: stepsOf(metricsStep({ id: "avg" })),
    });
    await chartsShown();

    pickRelativeRange("Past 1 Week");

    await waitFor(() => {
      expect(lastFetchedWindow()?.[0]).toBe("2026-10-31T12:00:00.000Z");
    });
    expect(thresholdNames()).toEqual(["Too many"]);
  });
});

describe("what the reader changes", () => {
  test("a link with a metric of their own draws no line on it, and Reset brings both back", async () => {
    const changed: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "a",
        title: "",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "http.server.duration",
          aggegationType: MetricsAggregationType.Avg,
        } as never,
      },
    };
    const params: Dictionary<string | null> = MetricInvestigationUrl.buildParams(
      {
        prefix: "metrics",
        state: {
          selection: null,
          queries: { queryConfigs: [changed], formulaConfigs: [] },
        },
      },
    );
    const search: URLSearchParams = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value) {
        search.set(name, value);
      }
    }
    window.history.replaceState(
      {},
      "",
      `/dashboard/p/monitors/m-1?${search.toString()}`,
    );

    renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: stepsOf(metricsStep({ id: "avg" })),
    });
    await chartsShown();

    expect(
      String(
        lastCharts?.metricViewData.queryConfigs[0]?.metricQueryData.filterData
          .metricName,
      ),
    ).toBe("http.server.duration");
    expect(lastCharts?.thresholds).toBeUndefined();
    expect(
      screen.getByText(
        "The metrics you picked. Reset brings back the metrics this monitor checks.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(thresholdNames()).toEqual(["Too many"]);
    });
    expect(
      String(
        lastCharts?.metricViewData.queryConfigs[0]?.metricQueryData.filterData
          .metricName,
      ),
    ).toBe("http.server.errors");
  });

  test("a drag zooms in, and the line stays with its metric", async () => {
    renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: stepsOf(metricsStep({ id: "avg" })),
    });
    await chartsShown();

    fireEvent.click(screen.getByText("Drag across the chart"));

    await waitFor(() => {
      expect(lastFetchedWindow()?.[1]).toBe("2026-11-07T10:30:00.000Z");
    });
    expect(thresholdNames()).toEqual(["Too many"]);
  });
});

describe("a monitor with several criteria steps", () => {
  const twoSteps: () => MonitorSteps = (): MonitorSteps => {
    return stepsOf(
      metricsStep({ id: "step-a", metricName: "cpu.load" }),
      metricsStep({ id: "step-b", metricName: "memory.used", threshold: 90 }),
    );
  };

  test("charts one at a time, with a picker kept in the URL", async () => {
    renderCard({ monitorType: MonitorType.Metrics, monitorSteps: twoSteps() });
    await chartsShown();

    const picker: HTMLElement = screen.getByTestId(
      MONITOR_METRICS_STEP_PICKER_TEST_ID,
    );
    expect(within(picker).getByRole("button", { name: "Step 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      String(fetchedData()[0]!.queryConfigs[0]!.metricQueryData.filterData.metricName),
    ).toBe("cpu.load");

    fireEvent.click(within(picker).getByRole("button", { name: "Step 2" }));

    await waitFor(() => {
      expect(
        String(
          lastCharts?.metricViewData.queryConfigs[0]?.metricQueryData.filterData
            .metricName,
        ),
      ).toBe("memory.used");
    });
    expect(
      new URLSearchParams(window.location.search).get("metricsStep"),
    ).toBe("2");
    expect(lastCharts?.thresholds?.[0]?.["value"]).toBe(90);

    // Opened again on that link, it starts on the second step.
    cleanup();
    lastCharts = null;
    renderCard({ monitorType: MonitorType.Metrics, monitorSteps: twoSteps() });
    await chartsShown();

    expect(
      within(screen.getByTestId(MONITOR_METRICS_STEP_PICKER_TEST_ID)).getByRole(
        "button",
        { name: "Step 2" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a monitor with one step has no picker", async () => {
    renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: stepsOf(metricsStep({ id: "only" })),
    });
    await chartsShown();

    expect(screen.queryByTestId(MONITOR_METRICS_STEP_PICKER_TEST_ID)).toBeNull();
  });
});

describe("the page around the card", () => {
  test("its Refresh, and a status change, read the charts again; its poll does not", async () => {
    const steps: MonitorSteps = stepsOf(metricsStep({ id: "avg" }));
    const result: RenderResult = renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: steps,
      refreshToken: 0,
    });
    await chartsShown();
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const fetchesBefore: number = fetchResultsMock.mock.calls.length;

    // The minute poll hands the card an equal step, as a new object.
    result.rerender(
      <MonitorMetricsCard
        monitorId={MONITOR_ID}
        monitorType={MonitorType.Metrics}
        monitorSteps={stepsOf(metricsStep({ id: "avg" }))}
        refreshToken={0}
      />,
    );
    expect(fetchResultsMock.mock.calls.length).toBe(fetchesBefore);

    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    result.rerender(
      <MonitorMetricsCard
        monitorId={MONITOR_ID}
        monitorType={MonitorType.Metrics}
        monitorSteps={stepsOf(metricsStep({ id: "avg" }))}
        refreshToken={1}
      />,
    );

    await waitFor(() => {
      expect(fetchResultsMock.mock.calls.length).toBeGreaterThan(fetchesBefore);
    });
    // The past three hours, up to now.
    expect(lastFetchedWindow()?.[1]).toBe("2026-11-07T12:01:00.000Z");
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
  });

  test("a step with no metric yet says so", () => {
    renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: stepsOf(metricsStep({ id: "new", metricName: "" })),
    });

    expect(screen.getByTestId(MONITOR_METRICS_NO_METRIC_TEST_ID)).toHaveTextContent(
      "This monitor has no metric to chart yet. Pick one in its criteria.",
    );
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("a reader who may not read telemetry is told so, and nothing is read", () => {
    mockPermissions = [Permission.MonitorViewer];

    renderCard({
      monitorType: MonitorType.Proxmox,
      monitorSteps: stepsOf(proxmoxStep()),
    });

    expect(
      screen.getByTestId(MONITOR_METRICS_PERMISSION_FALLBACK_TEST_ID),
    ).toHaveTextContent(
      "Charts of this monitor's metrics need permission to read telemetry.",
    );
    expect(fetchResultsMock).not.toHaveBeenCalled();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a Metrics monitor read for some services says the charts show every service", async () => {
    renderCard({
      monitorType: MonitorType.Metrics,
      monitorSteps: stepsOf(
        metricsStep({
          id: "rum",
          settings: { telemetryServiceIds: ["44444444-4444-4444-8444-444444444444"] },
        }),
      ),
    });
    await chartsShown();

    expect(
      screen.getByText(
        "This monitor checks these metrics for 1 service. The charts show them for every service.",
      ),
    ).toBeVisible();
  });
});
