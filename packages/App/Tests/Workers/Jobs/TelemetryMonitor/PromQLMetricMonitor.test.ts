import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "Common/Server/Utils/Logger";
import MonitorDependencySuppression from "Common/Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "Common/Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "Common/Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceContextUtil from "Common/Server/Utils/Monitor/MonitorResourceContext";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorSummaryCapture from "Common/Server/Utils/Monitor/MonitorSummaryCapture";
import OwnerRuleAssignment from "Common/Server/Utils/Rules/OwnerRuleAssignment";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { mockProjectStates } from "Common/Tests/Server/TestingUtils/Services/ProjectStatesHelper";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MetricMonitorQueryLanguage,
  PROMQL_METRIC_ALIAS,
  PROMQL_MONITOR_MAX_SERIES,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { PROMQL_METRIC_NAME_LABEL } from "Common/Utils/PromQL/PromQLAst";
import {
  PromQLMatrixResultSeries,
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
} from "Common/Utils/PromQL/PromQLEngineTypes";
import {
  PromQLLabels,
  PromQLLabelsTest,
  compilePromQLMatchers,
} from "Common/Utils/PromQL/PromQLLabels";

/*
 * ------------------------------------------------------------------
 * A Metrics monitor written in PromQL (issue #7712): every series the
 * expression returns is judged on its own, opens its own incident and
 * alert, and resolves when it recovers.
 * ------------------------------------------------------------------
 *
 * REAL: the worker's PromQL check (monitorPromQLMetric) and the PromQL
 * engine; the verdict and what follows from it, MonitorResourceUtil
 * .monitorResource with MonitorCriteriaEvaluator, the per-series fan-out,
 * MonitorIncident's and MonitorAlert's one-per-series dedupe and their
 * resolve pass.
 *
 * STOOD IN FOR: the metrics are series held here (a PromQLSeriesSource,
 * as the engine's own tests read), and Postgres is lists - an incident
 * created is added to the open ones, one resolved taken from them.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { executeQuery: jest.fn(), aggregateBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import {
  PROMQL_MONITOR_MAX_EVALUATIONS,
  getPromQLMonitorEvaluationTimes,
  limitPromQLMonitorSeries,
  monitorPromQLMetric,
  toPromQLSeriesBreakdown,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/PromQLMetricMonitor";

const executeQuery: jest.Mock =
  MetricService.executeQuery as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const MINUTE_MS: number = 60_000;
const START_MS: number = Date.UTC(2026, 10, 20, 9, 0, 0);

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

/*
 * Series held in memory, read the way a source must: only those every
 * matcher accepts, and only their samples after the start and up to the
 * end of the selection.
 */
class HeldSeries implements PromQLSeriesSource {
  public series: Array<PromQLSeries> = [];

  public async select(
    selection: PromQLSeriesSelection,
  ): Promise<Array<PromQLSeries>> {
    const accepts: PromQLLabelsTest = compilePromQLMatchers(selection.matchers);
    const answered: Array<PromQLSeries> = [];

    for (const item of this.series) {
      if (!accepts(item.labels)) {
        continue;
      }

      const timestampsMs: Array<number> = [];
      const values: Array<number> = [];

      for (let index: number = 0; index < item.values.length; index++) {
        const atMs: number = item.timestampsMs[index]!;

        if (atMs > selection.startTimeMs && atMs <= selection.endTimeMs) {
          timestampsMs.push(atMs);
          values.push(item.values[index]!);
        }
      }

      if (values.length > 0) {
        answered.push({ labels: item.labels, timestampsMs, values });
      }
    }

    return answered;
  }
}

// A gauge sampled every minute: value(minute) for minutes from -10 to 60.
const gauge: (
  labels: PromQLLabels,
  value: (minute: number) => number,
) => PromQLSeries = (
  labels: PromQLLabels,
  value: (minute: number) => number,
): PromQLSeries => {
  const timestampsMs: Array<number> = [];
  const values: Array<number> = [];

  for (let minute: number = -10; minute <= 60; minute++) {
    timestampsMs.push(START_MS + minute * MINUTE_MS);
    values.push(value(minute));
  }

  return { labels, timestampsMs, values };
};

const promQLMonitor: (query: string) => MonitorStepMetricMonitor = (
  query: string,
): MonitorStepMetricMonitor => {
  return {
    queryLanguage: MetricMonitorQueryLanguage.PromQL,
    promQLQuery: query,
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    rollingTime: RollingTime.Past1Minute,
  };
};

describe("when a check evaluates its expression", () => {
  const windowOf: (minutes: number) => InBetween<Date> = (
    minutes: number,
  ): InBetween<Date> => {
    return new InBetween<Date>(
      new Date(START_MS - minutes * MINUTE_MS),
      new Date(START_MS),
    );
  };

  test("a minute's window once, at the check's time", () => {
    expect(getPromQLMonitorEvaluationTimes(windowOf(1))).toEqual({
      startMs: START_MS,
      endMs: START_MS,
      stepMs: MINUTE_MS,
    });
  });

  test("a longer window every minute back from its end, never before its start", () => {
    expect(getPromQLMonitorEvaluationTimes(windowOf(5))).toEqual({
      startMs: START_MS - 4 * MINUTE_MS,
      endMs: START_MS,
      stepMs: MINUTE_MS,
    });
  });

  test("a day's window as many times as an hour's, whole minutes apart", () => {
    const day: ReturnType<typeof getPromQLMonitorEvaluationTimes> =
      getPromQLMonitorEvaluationTimes(windowOf(24 * 60));

    expect(day.stepMs).toBe(24 * MINUTE_MS);
    expect((day.endMs - day.startMs) / day.stepMs + 1).toBe(
      PROMQL_MONITOR_MAX_EVALUATIONS,
    );
  });
});

describe("the series of a check", () => {
  const seriesOf: (
    labels: Record<string, string>,
    values: Array<number>,
  ) => PromQLMatrixResultSeries = (
    labels: Record<string, string>,
    values: Array<number>,
  ): PromQLMatrixResultSeries => {
    return {
      labels,
      points: values.map((value: number, index: number) => {
        return { timestampMs: START_MS + index * MINUTE_MS, value };
      }),
    };
  };

  test("are named by their labels, without the metric's name", () => {
    const breakdown: Array<MetricSeriesResult> = toPromQLSeriesBreakdown([
      seriesOf({ __name__: "up", job: "api", instance: "a:9100" }, [0]),
      seriesOf({ __name__: "up", job: "api", instance: "b:9100" }, [0]),
    ]);

    expect(
      breakdown.map((series: MetricSeriesResult) => {
        return series.labels;
      }),
    ).toEqual([
      { job: "api", instance: "a:9100" },
      { job: "api", instance: "b:9100" },
    ]);
    expect(breakdown[0]!.fingerprint).not.toBe(breakdown[1]!.fingerprint);
    // The same labels are the same series, check after check.
    expect(
      toPromQLSeriesBreakdown([
        seriesOf({ job: "api", instance: "a:9100" }, [5]),
      ])[0]!.fingerprint,
    ).toBe(breakdown[0]!.fingerprint);
  });

  test("keep their names when only their names tell them apart", () => {
    const breakdown: Array<MetricSeriesResult> = toPromQLSeriesBreakdown([
      seriesOf({ __name__: "a", job: "api" }, [1]),
      seriesOf({ __name__: "b", job: "api" }, [1]),
    ]);

    expect(
      breakdown.map((series: MetricSeriesResult) => {
        return series.labels[PROMQL_METRIC_NAME_LABEL];
      }),
    ).toEqual(["a", "b"]);
    expect(breakdown[0]!.fingerprint).not.toBe(breakdown[1]!.fingerprint);
  });

  test("hold every value but NaN, at the times they were evaluated", () => {
    const breakdown: Array<MetricSeriesResult> = toPromQLSeriesBreakdown([
      seriesOf({ job: "api" }, [1, Number.NaN, Number.POSITIVE_INFINITY]),
    ]);

    expect(breakdown[0]!.aggregatedResults).toEqual([
      {
        data: [
          { timestamp: new Date(START_MS), value: 1 },
          {
            timestamp: new Date(START_MS + 2 * MINUTE_MS),
            value: Number.POSITIVE_INFINITY,
          },
        ],
      },
    ]);
  });

  test("a series with no labels at all is the whole monitor's", () => {
    expect(toPromQLSeriesBreakdown([seriesOf({}, [1])])[0]!.fingerprint).toBe(
      "__all__",
    );
  });
});

describe("the most series a check judges", () => {
  const breakdownOf: (count: number) => Array<MetricSeriesResult> = (
    count: number,
  ): Array<MetricSeriesResult> => {
    return Array.from({ length: count }).map(
      (_item: unknown, index: number): MetricSeriesResult => {
        return {
          fingerprint: `fp-${String(index).padStart(3, "0")}`,
          labels: { job: `job-${index}` },
          aggregatedResults: [{ data: [] }],
        };
      },
    );
  };

  test("as many as it returns, up to the bound", () => {
    const breakdown: Array<MetricSeriesResult> = breakdownOf(
      PROMQL_MONITOR_MAX_SERIES,
    );

    expect(
      limitPromQLMonitorSeries({ breakdown, openFingerprints: new Set() }),
    ).toBe(breakdown);
  });

  test("over it: those already acted on first, then the rest in order", () => {
    const kept: Array<MetricSeriesResult> = limitPromQLMonitorSeries({
      breakdown: breakdownOf(PROMQL_MONITOR_MAX_SERIES + 50),
      openFingerprints: new Set(["fp-149", "fp-120"]),
    });

    expect(kept).toHaveLength(PROMQL_MONITOR_MAX_SERIES);
    expect(
      kept.slice(0, 3).map((series: MetricSeriesResult) => {
        return series.fingerprint;
      }),
    ).toEqual(["fp-120", "fp-149", "fp-000"]);
    expect(kept[PROMQL_MONITOR_MAX_SERIES - 1]!.fingerprint).toBe("fp-097");
  });
});

describe("a check's read of the project's metrics", () => {
  beforeEach(() => {
    executeQuery.mockReset();
    metricTypeFindBy.mockReset();
  });

  test("reads only the monitor's services, as the worker, through the engine", async () => {
    const statements: Array<Statement> = [];

    metricTypeFindBy.mockResolvedValue([
      { name: "queue.depth", unit: "{message}", isMonotonic: false },
    ] as never);
    executeQuery.mockImplementation(async (statement: unknown) => {
      statements.push(statement as Statement);
      return {
        json: async (): Promise<{ data: Array<unknown> }> => {
          return {
            data: [
              {
                name: "queue.depth",
                metricPointType: "Gauge",
                aggregationTemporality: "",
                attributes: { "resource.service.name": "api" },
                timestampMs: String(START_MS - 30_000),
                value: 140,
              },
            ],
          };
        },
      };
    });

    const response: MetricMonitorResponse = await monitorPromQLMetric({
      metricMonitor: {
        ...promQLMonitor("queue_depth > 100"),
        telemetryServiceIds: [SERVICE_ID],
      },
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      evaluateUntil: new Date(START_MS),
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]!.query).toContain("primaryEntityId IN");
    expect(Object.values(statements[0]!.query_params)).toContainEqual([
      SERVICE_ID.toString(),
    ]);
    expect(Object.values(statements[0]!.query_params)).toContain(
      PROJECT_ID.toString(),
    );

    expect(response.queryServiceIds).toEqual([SERVICE_ID.toString()]);
    expect(response.metricViewConfig.queryConfigs[0]!.metricAliasData).toEqual(
      expect.objectContaining({
        metricVariable: PROMQL_METRIC_ALIAS,
        title: "queue_depth > 100",
      }),
    );
    expect(response.seriesBreakdown).toHaveLength(1);
    expect(response.seriesBreakdown![0]!.labels).toEqual({
      resource_service_name: "api",
      job: "api",
    });
    expect(response.seriesBreakdown![0]!.aggregatedResults[0]!.data).toEqual([
      { timestamp: new Date(START_MS), value: 140 },
    ]);
  });

  test("an expression that cannot run is refused, and nothing is read", async () => {
    await expect(
      monitorPromQLMetric({
        metricMonitor: promQLMonitor("sum("),
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("The PromQL expression does not parse");
    expect(executeQuery).not.toHaveBeenCalled();
  });
});

// A criteria that opens an incident and an alert for each series in breach.
const criteriaWith: (filter: CriteriaFilter) => MonitorCriteriaInstance = (
  filter: CriteriaFilter,
): MonitorCriteriaInstance => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: "queue-too-deep",
    name: "Queue too deep",
    description: "",
    monitorStatusId: OFFLINE,
    filterCondition: FilterCondition.All,
    filters: [filter],
    incidents: [
      {
        id: "queue-too-deep-incident",
        title: "Queue too deep",
        description: "The queue is backing up.",
        incidentSeverityId: ObjectID.generate(),
        autoResolveIncident: true,
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        id: "queue-too-deep-alert",
        title: "Queue too deep",
        description: "The queue is backing up.",
        alertSeverityId: ObjectID.generate(),
        autoResolveAlert: true,
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];

  return instance;
};

interface Run {
  monitor: Monitor;
  step: MonitorStep;
  source: HeldSeries;
  opened: Array<Incident>;
  openIncidents: Array<Incident>;
  openedAlerts: Array<Alert>;
  openAlerts: Array<Alert>;
  resolved: Array<string>;
  resolvedAlerts: Array<string>;
}

const buildRun: (data: {
  query: string;
  filter: CriteriaFilter;
}) => Run = (data: { query: string; filter: CriteriaFilter }): Run => {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    monitorCriteria: (() => {
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = {
        monitorCriteriaInstanceArray: [criteriaWith(data.filter)],
      };
      return criteria;
    })(),
  } as unknown as MonitorStep["data"];
  step.setMetricMonitor(promQLMonitor(data.query));

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Queue depth";
  monitor.monitorType = MonitorType.Metrics;
  monitor.currentMonitorStatusId = ONLINE;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;

  return {
    monitor,
    step,
    source: new HeldSeries(),
    opened: [],
    openIncidents: [],
    openedAlerts: [],
    openAlerts: [],
    resolved: [],
    resolvedAlerts: [],
  };
};

const useRun: (run: Run) => void = (run: Run): void => {
  jest.spyOn(MonitorService, "findOneById").mockImplementation(() => {
    return Promise.resolve(run.monitor) as never;
  });
  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation(() => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorStatusId = run.monitor.currentMonitorStatusId!;
      return Promise.resolve(timeline) as never;
    });
  jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      run.monitor.currentMonitorStatusId = (
        createBy as { data: { monitorStatusId: ObjectID } }
      ).data.monitorStatusId;
      return Promise.resolve(new MonitorStatusTimeline()) as never;
    });
  jest.spyOn(IncidentService, "findBy").mockImplementation(() => {
    return Promise.resolve([...run.openIncidents]) as never;
  });
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation((createBy: unknown) => {
      const incident: Incident = (createBy as { data: Incident }).data;
      incident.id = ObjectID.generate();
      run.opened.push(incident);
      run.openIncidents.push(incident);
      return Promise.resolve(incident) as never;
    });
  jest.spyOn(AlertService, "findBy").mockImplementation(() => {
    return Promise.resolve([...run.openAlerts]) as never;
  });
  jest.spyOn(AlertService, "create").mockImplementation((createBy: unknown) => {
    const alert: Alert = (createBy as { data: Alert }).data;
    alert.id = ObjectID.generate();
    run.openedAlerts.push(alert);
    run.openAlerts.push(alert);
    return Promise.resolve(alert) as never;
  });
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const incidentId: string = (
        createBy as { data: { incidentId: ObjectID } }
      ).data.incidentId.toString();
      run.resolved.push(incidentId);
      run.openIncidents = run.openIncidents.filter((incident: Incident) => {
        return incident.id!.toString() !== incidentId;
      });
      return Promise.resolve(undefined) as never;
    });
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const alertId: string = (
        createBy as { data: { alertId: ObjectID } }
      ).data.alertId.toString();
      run.resolvedAlerts.push(alertId);
      run.openAlerts = run.openAlerts.filter((alert: Alert) => {
        return alert.id!.toString() !== alertId;
      });
      return Promise.resolve(undefined) as never;
    });
};

// One check at this minute, as the worker makes it.
const checkAt: (run: Run, minute: number) => Promise<void> = async (
  run: Run,
  minute: number,
): Promise<void> => {
  jest.setSystemTime(new Date(START_MS + minute * MINUTE_MS));

  const response: MetricMonitorResponse = await monitorPromQLMetric({
    metricMonitor: run.step.data!.metricMonitor!,
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
    source: run.source,
  });

  await MonitorResourceUtil.monitorResource(response);
};

// Which jobs have an incident open, and an alert.
const openJobs: (run: Run) => {
  incidents: Array<string>;
  alerts: Array<string>;
} = (run: Run): { incidents: Array<string>; alerts: Array<string> } => {
  const jobOf: (record: Incident | Alert) => string = (
    record: Incident | Alert,
  ): string => {
    return String((record.seriesLabels as Record<string, unknown>)?.["job"]);
  };

  return {
    incidents: run.openIncidents.map(jobOf).sort(),
    alerts: run.openAlerts.map(jobOf).sort(),
  };
};

describe("one incident per series, opened and resolved series by series", () => {
  let loggedErrors: Array<string> = [];
  let loggedWarnings: Array<string> = [];

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    mockProjectStates();
    loggedErrors = [];
    loggedWarnings = [];

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockResolvedValue(true as never);
    jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest
      .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
      .mockImplementation((async (data: { ids?: Array<unknown> }) => {
        return { usableIds: data.ids || [], droppedIds: [] };
      }) as never);
    jest
      .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
      .mockResolvedValue(undefined);
    jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
    jest
      .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
      .mockResolvedValue({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      } as never);
    jest
      .spyOn(MonitorDependencySuppression, "getDependencySuppression")
      .mockResolvedValue({ isSuppressed: false } as never);
    jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext() as never);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext() as never);
    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] } as never);
    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(IncidentService, "addOwners")
      .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());
    jest
      .spyOn(AlertService, "addOwners")
      .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(logger, "error")
      .mockImplementation((...args: Array<unknown>) => {
        loggedErrors.push(String(args[0]));
        return undefined as never;
      });
    jest.spyOn(logger, "warn").mockImplementation((...args: Array<unknown>) => {
      loggedWarnings.push(String(args[0]));
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /*
   * Two queues. The api's backs up at minute 4 and drains at minute 10;
   * the worker's backs up at minute 7 and drains at minute 13.
   */
  const queues: (run: Run) => void = (run: Run): void => {
    run.source.series = [
      gauge({ __name__: "queue_depth", job: "api" }, (minute: number) => {
        return minute >= 4 && minute < 10 ? 150 : 50;
      }),
      gauge({ __name__: "queue_depth", job: "worker" }, (minute: number) => {
        return minute >= 7 && minute < 13 ? 220 : 40;
      }),
    ];
  };

  const playTwoQueues: (run: Run) => Promise<void> = async (
    run: Run,
  ): Promise<void> => {
    for (let minute: number = 1; minute <= 3; minute++) {
      await checkAt(run, minute);
    }
    expect(run.opened).toHaveLength(0);
    expect(run.monitor.currentMonitorStatusId!.toString()).toBe(
      ONLINE.toString(),
    );

    // The api's queue: one incident and one alert, its own.
    for (let minute: number = 4; minute <= 6; minute++) {
      await checkAt(run, minute);
    }
    expect(openJobs(run)).toEqual({ incidents: ["api"], alerts: ["api"] });
    expect(run.opened).toHaveLength(1);
    expect(run.opened[0]!.seriesLabels).toEqual({ job: "api" });
    expect(run.opened[0]!.seriesFingerprint).toBeTruthy();
    expect(run.monitor.currentMonitorStatusId!.toString()).toBe(
      OFFLINE.toString(),
    );

    // The worker's too, its own, and the api's is not opened again.
    for (let minute: number = 7; minute <= 9; minute++) {
      await checkAt(run, minute);
    }
    expect(openJobs(run)).toEqual({
      incidents: ["api", "worker"],
      alerts: ["api", "worker"],
    });
    expect(run.opened).toHaveLength(2);
    expect(run.resolved).toHaveLength(0);

    // The api's drains: its incident resolves, the worker's stays open.
    for (let minute: number = 10; minute <= 12; minute++) {
      await checkAt(run, minute);
    }
    expect(openJobs(run)).toEqual({
      incidents: ["worker"],
      alerts: ["worker"],
    });
    expect(run.resolved).toEqual([run.opened[0]!.id!.toString()]);
    expect(run.monitor.currentMonitorStatusId!.toString()).toBe(
      OFFLINE.toString(),
    );

    // The worker's drains: everything resolved, and the monitor back online.
    for (let minute: number = 13; minute <= 15; minute++) {
      await checkAt(run, minute);
    }
    expect(openJobs(run)).toEqual({ incidents: [], alerts: [] });
    expect(run.resolved).toEqual([
      run.opened[0]!.id!.toString(),
      run.opened[1]!.id!.toString(),
    ]);
    expect(run.openedAlerts).toHaveLength(2);
    expect(run.resolvedAlerts).toHaveLength(2);
    expect(run.monitor.currentMonitorStatusId!.toString()).toBe(
      ONLINE.toString(),
    );
    expect(loggedErrors).toEqual([]);
  };

  test("the expression's value, compared under When to alert", async () => {
    const run: Run = buildRun({
      query: "queue_depth",
      filter: {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: 100,
        metricMonitorOptions: {
          metricAlias: PROMQL_METRIC_ALIAS,
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      },
    });
    queues(run);
    useRun(run);

    await playTwoQueues(run);
  }, 120000);

  test("a comparison in the expression, a series in breach while it is returned", async () => {
    const run: Run = buildRun({
      query: "queue_depth > 100",
      filter: {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.IsNotEmpty,
        value: undefined,
        metricMonitorOptions: {
          metricAlias: PROMQL_METRIC_ALIAS,
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      },
    });
    queues(run);
    useRun(run);

    await playTwoQueues(run);
  }, 120000);

  test(`over ${PROMQL_MONITOR_MAX_SERIES} series: the first are judged, and one already open is kept`, async () => {
    const run: Run = buildRun({
      query: "queue_depth > 100",
      filter: {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.IsNotEmpty,
        value: undefined,
        metricMonitorOptions: {
          metricAlias: PROMQL_METRIC_ALIAS,
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      },
    });
    const count: number = PROMQL_MONITOR_MAX_SERIES + 20;

    // Every queue is backed up from minute 2; the last one alone from minute 1.
    run.source.series = Array.from({ length: count }).map(
      (_item: unknown, index: number): PromQLSeries => {
        const job: string = `job-${String(index).padStart(3, "0")}`;

        return gauge({ __name__: "queue_depth", job }, (minute: number) => {
          return minute >= 2 || (index === count - 1 && minute >= 1) ? 500 : 10;
        });
      },
    );
    useRun(run);

    // The last queue alone: its incident opens.
    await checkAt(run, 1);
    expect(openJobs(run).incidents).toEqual([
      `job-${String(count - 1).padStart(3, "0")}`,
    ]);

    // Then all of them: the bound, the open one among them, and it stays open.
    await checkAt(run, 2);
    expect(run.openIncidents).toHaveLength(PROMQL_MONITOR_MAX_SERIES);
    expect(openJobs(run).incidents).toContain(
      `job-${String(count - 1).padStart(3, "0")}`,
    );
    expect(run.resolved).toHaveLength(0);
    expect(
      loggedWarnings.some((line: string): boolean => {
        return line.includes(
          `returned ${count} series, more than the ${PROMQL_MONITOR_MAX_SERIES} a check judges`,
        );
      }),
    ).toBe(true);

    // Checked again: nothing flaps.
    await checkAt(run, 3);
    expect(run.openIncidents).toHaveLength(PROMQL_MONITOR_MAX_SERIES);
    expect(run.opened).toHaveLength(PROMQL_MONITOR_MAX_SERIES);
    expect(run.resolved).toHaveLength(0);
  }, 120000);
});
