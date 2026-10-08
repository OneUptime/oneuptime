import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * Monitor Create opened from an insight's Create Monitor button
 * (`?aiInsightId=<id>`). The page reads the insight itself, plus the
 * project's statuses and severities (and, for a metric drift, what the
 * metric is), and opens the form on the monitor AIInsightMonitorPrefill
 * builds — or says why it cannot, in place of the form.
 *
 * Drives the real page with ModelForm mocked to capture the props it is
 * handed, the same approach as MonitorCreateFromMonitorBackedDevice.test.tsx.
 * What the prefill itself contains is pinned in App/Tests
 * (AIInsightMonitorPrefill.test.ts); this pins that the page asks for the
 * right things and hands the form the result.
 */

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

const INSIGHT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID: string = "33333333-3333-4333-8333-333333333333";
const ONLINE_STATUS_ID: string = "44444444-4444-4444-8444-444444444444";
const OFFLINE_STATUS_ID: string = "55555555-5555-4555-8555-555555555555";
const CRITICAL_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666661";
const MAJOR_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666662";
const HIGH_ALERT_ID: string = "77777777-7777-4777-8777-777777777771";
const LOW_ALERT_ID: string = "77777777-7777-4777-8777-777777777772";

let insightRow: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve(null);
};
let listFailure: Error | null = null;
let getItemRequests: Array<{
  modelType: unknown;
  id?: { toString: () => string } | undefined;
  select?: Record<string, boolean> | undefined;
}> = [];
let analyticsRequests: Array<Record<string, unknown>> = [];
let metricShapeRows: Array<unknown> = [];
let monitorStatusRows: Array<unknown> = [];
let incidentSeverityRows: Array<unknown> = [];
let alertSeverityRows: Array<unknown> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: unknown;
        id?: { toString: () => string } | undefined;
        select?: Record<string, boolean> | undefined;
      }): Promise<unknown> => {
        getItemRequests.push(request);

        if (request.modelType === AIInsight) {
          return insightRow();
        }

        if (request.modelType === Project) {
          return Promise.resolve({
            doNotAddGlobalProbesByDefaultOnNewMonitors: false,
          });
        }

        return Promise.resolve(null);
      },
      getList: (request: { modelType: unknown }): Promise<unknown> => {
        if (listFailure) {
          return Promise.reject(listFailure);
        }

        let rows: Array<unknown> = [];

        if (request.modelType === MonitorStatus) {
          rows = monitorStatusRows;
        } else if (request.modelType === IncidentSeverity) {
          rows = incidentSeverityRows;
        } else if (request.modelType === AlertSeverity) {
          rows = alertSeverityRows;
        }

        return Promise.resolve({
          data: rows,
          count: rows.length,
          skip: 0,
          limit: rows.length,
        });
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: Record<string, unknown>): Promise<unknown> => {
        analyticsRequests.push(request);
        return Promise.resolve({
          data: metricShapeRows,
          count: metricShapeRows.length,
          skip: 0,
          limit: 1,
        });
      },
    },
  };
});

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import {
  AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER,
  AI_INSIGHT_MONITOR_LATENCY_BLOCKER,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill";
import { AI_INSIGHT_MONITOR_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorData";
import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "../../../Models/AnalyticsModels/Metric";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import AIInsightEvidence from "../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);

function withId<T extends { id: ObjectID | null }>(row: T, id: string): T {
  row.id = new ObjectID(id);
  return row;
}

function monitorStatus(data: {
  id: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = withId(new MonitorStatus(), data.id);
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

function insight(data: {
  insightType: AIInsightType;
  severity?: AIInsightSeverity | undefined;
  serviceName?: string | undefined;
  telemetryServiceId?: string | undefined;
  metricName?: string | undefined;
  evidence?: AIInsightEvidence | undefined;
}): AIInsight {
  const row: AIInsight = withId(new AIInsight(), INSIGHT_ID);
  row.insightType = data.insightType;
  row.severity = data.severity || AIInsightSeverity.Medium;
  if (data.serviceName) {
    row.serviceName = data.serviceName;
  }
  if (data.telemetryServiceId) {
    row.telemetryServiceId = new ObjectID(data.telemetryServiceId);
  }
  if (data.metricName) {
    row.metricName = data.metricName;
  }
  if (data.evidence) {
    row.evidence = data.evidence;
  }
  return row;
}

const ERROR_LOG_SPIKE: AIInsight = insight({
  insightType: AIInsightType.ErrorLogSpike,
  severity: AIInsightSeverity.High,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    logSpike: {
      recentErrorCount: 900,
      baselineHourlyAverage: 50,
      spikeMultiplier: 18,
      windowMinutes: 60,
      topServices: [{ serviceName: "checkout", count: 700 }],
    },
  },
});

const EXCEPTION_SPIKE: AIInsight = insight({
  insightType: AIInsightType.ExceptionSpike,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    exception: {
      exceptionType: "TimeoutError",
      exceptionMessage: "Query timed out after 30000 ms for order <UUID>",
      baselineHourlyAverage: 4,
    },
  },
});

const METRIC_DRIFT: AIInsight = insight({
  insightType: AIInsightType.MetricDrift,
  severity: AIInsightSeverity.Low,
  metricName: "queue.depth",
  evidence: {
    metricDrift: {
      metricName: "queue.depth",
      primaryEntityId: ENTITY_ID,
      recentWeekMean: 400,
      priorWeekMean: 160,
      relativeChangePercent: 150,
      recentSampleCount: 5000,
      priorSampleCount: 5000,
    },
  },
});

const LATENCY: AIInsight = insight({
  insightType: AIInsightType.TraceLatencyRegression,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
});

function metricPoint(data: {
  pointType: MetricPointType;
  isMonotonic: boolean;
  temporality: AggregationTemporality;
}): Metric {
  const metric: Metric = new Metric();
  metric.metricPointType = data.pointType;
  metric.isMonotonic = data.isMonotonic;
  metric.aggregationTemporality = data.temporality;
  return metric;
}

function linkTo(params: Record<string, string>): void {
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((paramName: string): string | null => {
      return params[paramName] ?? null;
    });
}

function renderCreatePage(): void {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function openForm(): Promise<CapturedFormProps> {
  renderCreatePage();

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
  });

  return capturedForm!;
}

function stepOf(form: CapturedFormProps): MonitorStep {
  return MonitorSteps.fromJSON(form.initialValues["monitorSteps"] as JSONObject)
    .data!.monitorStepsInstanceArray[0]!;
}

function unhealthyOf(form: CapturedFormProps): MonitorCriteriaInstance {
  return stepOf(form).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray[0]!;
}

function insightRequests(): Array<{
  modelType: unknown;
  id?: { toString: () => string } | undefined;
  select?: Record<string, boolean> | undefined;
}> {
  return getItemRequests.filter((request: { modelType: unknown }): boolean => {
    return request.modelType === AIInsight;
  });
}

describe("the monitor create page opened from an AI insight", () => {
  beforeEach(() => {
    capturedForm = null;
    getItemRequests = [];
    analyticsRequests = [];
    metricShapeRows = [];
    listFailure = null;

    monitorStatusRows = [
      monitorStatus({
        id: ONLINE_STATUS_ID,
        isOperationalState: true,
        isOfflineState: false,
      }),
      monitorStatus({
        id: OFFLINE_STATUS_ID,
        isOperationalState: false,
        isOfflineState: true,
      }),
    ];
    incidentSeverityRows = [
      withId(new IncidentSeverity(), CRITICAL_INCIDENT_ID),
      withId(new IncidentSeverity(), MAJOR_INCIDENT_ID),
    ];
    alertSeverityRows = [
      withId(new AlertSeverity(), HIGH_ALERT_ID),
      withId(new AlertSeverity(), LOW_ALERT_ID),
    ];

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});
    getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
      (): void => {},
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("reads the insight's own columns, by the id in the link", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(ERROR_LOG_SPIKE);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    await openForm();

    expect(insightRequests()).toHaveLength(1);
    expect(insightRequests()[0]!.id?.toString()).toBe(INSIGHT_ID);
    expect(insightRequests()[0]!.select).toEqual(AI_INSIGHT_MONITOR_SELECT);
    expect(Object.keys(AI_INSIGHT_MONITOR_SELECT).sort()).toEqual(
      [
        "evidence",
        "insightType",
        "metricName",
        "serviceName",
        "severity",
        "telemetryServiceId",
      ].sort(),
    );
  });

  test("an error-log spike opens on a Logs monitor for the service", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(ERROR_LOG_SPIKE);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Logs);
    expect(form.initialValues["name"]).toBe("Error-log spike in checkout");

    const step: MonitorStep = stepOf(form);

    expect(
      step.data!.logMonitor!.telemetryServiceIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SERVICE_ID]);
    // max(100, 3 * 50) = 150, under checkout's 700.
    expect(unhealthyOf(form).data!.filters[0]!.value).toBe(150);
    expect(
      MonitorSteps.fromJSON(
        form.initialValues["monitorSteps"] as JSONObject,
      ).data!.defaultMonitorStatusId?.toString(),
    ).toBe(ONLINE_STATUS_ID);
    // No metric read for anything but a drift.
    expect(analyticsRequests).toHaveLength(0);
  });

  test("the incident takes the project's own severity, ranked by its order", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(ERROR_LOG_SPIKE);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    const form: CapturedFormProps = await openForm();

    // A High insight: the most severe incident and alert severities.
    expect(
      unhealthyOf(form).data!.incidents[0]!.incidentSeverityId?.toString(),
    ).toBe(CRITICAL_INCIDENT_ID);
    expect(unhealthyOf(form).data!.alerts[0]!.alertSeverityId?.toString()).toBe(
      HIGH_ALERT_ID,
    );
    expect(unhealthyOf(form).data!.monitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID,
    );
  });

  test("an exception spike opens on an Exceptions monitor", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(EXCEPTION_SPIKE);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Exceptions);
    expect(stepOf(form).data!.exceptionMonitor!.exceptionTypes).toEqual([
      "TimeoutError",
    ]);
    expect(stepOf(form).data!.exceptionMonitor!.message).toBe(
      "Query timed out after 30000 ms for order",
    );
    // A Medium insight: the next severity down.
    expect(
      unhealthyOf(form).data!.incidents[0]!.incidentSeverityId?.toString(),
    ).toBe(MAJOR_INCIDENT_ID);
  });

  test("a metric drift reads the metric's shape and opens on a Metrics monitor", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(METRIC_DRIFT);
    };
    metricShapeRows = [
      metricPoint({
        pointType: MetricPointType.Gauge,
        isMonotonic: false,
        temporality: AggregationTemporality.Cumulative,
      }),
    ];
    linkTo({ aiInsightId: INSIGHT_ID });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Metrics);
    expect(
      stepOf(form).data!.metricMonitor!.telemetryServiceIds!.map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([ENTITY_ID]);
    expect(unhealthyOf(form).data!.filters[0]!.value).toBe(240);

    expect(analyticsRequests).toHaveLength(1);
    expect(
      (analyticsRequests[0]!["query"] as Record<string, unknown>)["name"],
    ).toBe("queue.depth");
  });

  test("a drift on a cumulative counter says why instead of opening a form", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(METRIC_DRIFT);
    };
    metricShapeRows = [
      metricPoint({
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        temporality: AggregationTemporality.Cumulative,
      }),
    ];
    linkTo({ aiInsightId: INSIGHT_ID });

    renderCreatePage();

    expect(
      await screen.findByText(AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER),
    ).toBeInTheDocument();
    expect(capturedForm).toBeNull();
  });

  test("a latency regression says why instead of opening a form", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(LATENCY);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    renderCreatePage();

    expect(
      await screen.findByText(AI_INSIGHT_MONITOR_LATENCY_BLOCKER),
    ).toBeInTheDocument();
    expect(capturedForm).toBeNull();
  });

  test("a link whose id is not an id never reaches the server", async () => {
    linkTo({ aiInsightId: "not-an-id" });

    renderCreatePage();

    expect(
      await screen.findByText(/This link does not point to an insight/),
    ).toBeInTheDocument();
    expect(insightRequests()).toHaveLength(0);
    expect(capturedForm).toBeNull();
  });

  test("an insight that no longer exists says so", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(null);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    renderCreatePage();

    expect(
      await screen.findByText(
        "The insight this monitor was to be created from no longer exists.",
      ),
    ).toBeInTheDocument();
    expect(capturedForm).toBeNull();
  });

  test("an insight that cannot be read shows the server's reason", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.reject(new Error("forbidden"));
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    renderCreatePage();

    expect(await screen.findByText("forbidden")).toBeInTheDocument();
    expect(insightRequests()).toHaveLength(1);
    expect(capturedForm).toBeNull();
    expect(screen.queryByTestId("model-form")).not.toBeInTheDocument();
  });

  test("statuses and severities that cannot be read still leave a monitor to review", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(ERROR_LOG_SPIKE);
    };
    listFailure = new Error("lists are down");
    linkTo({ aiInsightId: INSIGHT_ID });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Logs);
    // Nothing that would need the missing ids: the form asks for them.
    expect(unhealthyOf(form).data!.createIncidents).toBe(false);
    expect(unhealthyOf(form).data!.changeMonitorStatus).toBe(false);
  });

  test("a telemetry monitor made from an insight is not given a probe schedule", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(ERROR_LOG_SPIKE);
    };
    linkTo({ aiInsightId: INSIGHT_ID });

    const form: CapturedFormProps = await openForm();

    expect(
      Object.prototype.hasOwnProperty.call(
        form.initialValues,
        "monitoringInterval",
      ),
    ).toBe(true);

    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Logs;
    monitor.monitoringInterval = String(
      form.initialValues["monitoringInterval"],
    );

    const created: Monitor = (await form.onBeforeCreate!(monitor)) as Monitor;

    expect(created.monitoringInterval).toBeUndefined();
  });

  test("a template link still wins over an insight link", async () => {
    insightRow = (): Promise<unknown> => {
      return Promise.resolve(ERROR_LOG_SPIKE);
    };
    linkTo({
      aiInsightId: INSIGHT_ID,
      monitorTemplateId: "88888888-8888-4888-8888-888888888888",
    });

    await openForm();

    expect(insightRequests()).toHaveLength(0);
  });
});
