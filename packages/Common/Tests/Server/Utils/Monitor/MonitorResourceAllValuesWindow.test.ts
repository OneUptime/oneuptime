/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import { getKubernetesAlertTemplateById } from "../../../../Types/Monitor/KubernetesAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #4793 on the path every telemetry check takes: the worker's
 * response for a Kubernetes "Deployment Replica Mismatch" monitor goes into
 * MonitorResourceUtil.monitorResource, through the real criteria evaluator
 * and the real CriteriaInEffect.forMonitor, which reads the monitor's open
 * alerts and incidents. Postgres, Redis and the incident and alert
 * machinery are stood in for, and so are the open records.
 */

const NOW: Date = new Date(Date.UTC(2026, 9, 16, 12, 15, 30));
const START: number = Date.UTC(2026, 9, 16, 12, 0, 0);
const MINUTE: number = 60_000;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const UNRESOLVED_ALERT_STATE: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const UNRESOLVED_INCIDENT_STATE: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";

const step: MonitorStep = getKubernetesAlertTemplateById(
  "k8s-deployment-replica-mismatch",
)!.getMonitorStep({
  clusterIdentifier: "prod",
  onlineMonitorStatusId: ONLINE,
  offlineMonitorStatusId: OFFLINE,
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Replica Mismatch",
});

const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
const firing: MonitorCriteriaInstance =
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
const healthy: MonitorCriteriaInstance =
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!;

function labelsOf(deployment: string): JSONObject {
  return { [NAMESPACE_KEY]: "payments", [DEPLOYMENT_KEY]: deployment };
}

function fingerprintOf(deployment: string): string {
  return MetricSeriesFingerprint.computeFingerprint(labelsOf(deployment));
}

// A deployment desired/available per minute bucket, as the worker reads them.
function series(
  deployment: string,
  minutes: Array<number>,
  desired: number,
  available: number,
): MetricSeriesResult {
  const query: (value: number) => AggregatedResult = (
    value: number,
  ): AggregatedResult => {
    return {
      data: minutes.map((minute: number): AggregateModel => {
        return {
          timestamp: new Date(START + minute * MINUTE),
          value: value,
          attributes: labelsOf(deployment),
        };
      }),
    };
  };
  const queries: Array<AggregatedResult> = [query(desired), query(available)];

  return {
    fingerprint: fingerprintOf(deployment),
    labels: labelsOf(deployment),
    aggregatedResults: [
      ...queries,
      MetricFormulaEvaluator.evaluateFormula({
        formula: view.formulaConfigs[0]!.metricFormulaData.metricFormula,
        queryConfigs: view.queryConfigs,
        formulaConfigs: [],
        results: queries,
      }),
    ],
  };
}

function range(from: number, to: number): Array<number> {
  const minutes: Array<number> = [];
  for (let minute: number = from; minute <= to; minute++) {
    minutes.push(minute);
  }
  return minutes;
}

let monitor: Monitor;
let openAlerts: Array<Alert> = [];
let alertReads: number = 0;
let incidentReads: number = 0;
let createAlerts: jest.SpyInstance;
let resolveAlerts: jest.SpyInstance;

function check(breakdown: Array<MetricSeriesResult>): MetricMonitorResponse {
  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: [],
    seriesBreakdown: breakdown,
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past15Minutes,
      NOW,
    ),
  };
}

async function ingest(
  breakdown: Array<MetricSeriesResult>,
): Promise<ProbeApiIngestResponse> {
  return MonitorResourceUtil.monitorResource(check(breakdown));
}

// The series the alert creator was handed for a criteria, by deployment.
function alertCreatorSeries(criteriaId: string): Array<string> {
  return createAlerts.mock.calls
    .filter((call: Array<unknown>) => {
      return (
        (call[0] as { criteriaInstance: MonitorCriteriaInstance })
          .criteriaInstance.data?.id === criteriaId
      );
    })
    .flatMap((call: Array<unknown>) => {
      return (
        (call[0] as { matchesPerSeries?: Array<PerSeriesCriteriaMatch> })
          .matchesPerSeries || []
      ).map((match: PerSeriesCriteriaMatch) => {
        return String(match.labels[DEPLOYMENT_KEY]);
      });
    });
}

describe("MonitorResourceUtil.monitorResource: All Values waits for a full window (#4793)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    monitor = new Monitor();
    monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
    monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
    monitor.name = "Replica Mismatch";
    monitor.monitorType = MonitorType.Kubernetes;
    monitor.currentMonitorStatusId = ONLINE;
    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: ONLINE,
    };
    monitor.monitorSteps = monitorSteps;

    openAlerts = [];
    alertReads = 0;
    incidentReads = 0;

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(monitor as never);
    jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockImplementation(() => {
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline.monitorStatusId = monitor.currentMonitorStatusId!;
        return Promise.resolve(timeline) as never;
      });
    jest
      .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
      .mockResolvedValue(undefined);
    jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
    jest
      .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
      .mockResolvedValue(null as never);
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
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    resolveAlerts = jest
      .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockResolvedValue(undefined as never);
    createAlerts = jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockResolvedValue(undefined as never);

    // What CriteriaInEffect.forMonitor reads: the monitor's open records.
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([UNRESOLVED_ALERT_STATE]);
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([UNRESOLVED_INCIDENT_STATE]);
    jest
      .spyOn(AlertService, "findBy")
      .mockImplementation(async (): Promise<Array<Alert>> => {
        alertReads++;
        return openAlerts;
      });
    jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(async (): Promise<Array<Incident>> => {
        incidentReads++;
        return [];
      });

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("a deployment one minute old opens nothing; the healthy one beside it keeps the monitor operational", async () => {
    const response: ProbeApiIngestResponse = await ingest([
      series("checkout", range(0, 15), 2, 2),
      series("api", [15], 1, 0),
    ]);

    expect(response.criteriaMetId).toBe(healthy.data!.id);
    expect(alertCreatorSeries(firing.data!.id)).toEqual([]);

    // Waiting, api was looked up among the open records - once.
    expect(alertReads).toBe(1);
    expect(incidentReads).toBe(1);

    // And it waits on the resolve pass too: nothing of the firing criteria breaches.
    const resolveInput: {
      breachingSeriesFingerprintsByCriteriaId?: Dictionary<Set<string>>;
    } = resolveAlerts.mock.calls[0]![0] as {
      breachingSeriesFingerprintsByCriteriaId?: Dictionary<Set<string>>;
    };
    expect(
      Array.from(
        resolveInput.breachingSeriesFingerprintsByCriteriaId?.[
          firing.data!.id
        ] || [],
      ),
    ).toEqual([]);
  });

  test("a deployment short for the whole window opens its alert - and nothing waits, so nothing is read", async () => {
    const response: ProbeApiIngestResponse = await ingest([
      series("checkout", range(0, 15), 2, 2),
      series("api", range(0, 15), 1, 0),
    ]);

    expect(response.criteriaMetId).toBe(firing.data!.id);
    expect(alertCreatorSeries(firing.data!.id)).toEqual(["api"]);
    expect(alertReads).toBe(0);
    expect(incidentReads).toBe(0);
  });

  test("a deployment whose alert is open is held through a gap in its data, not resolved", async () => {
    const open: Alert = new Alert();
    open.createdCriteriaId = firing.data!.id;
    open.seriesFingerprint = fingerprintOf("api");
    openAlerts = [open];
    monitor.currentMonitorStatusId = OFFLINE;

    const response: ProbeApiIngestResponse = await ingest([
      series("checkout", range(0, 15), 2, 2),
      // The agent was away 12:05-12:09.
      series("api", [...range(0, 4), ...range(10, 15)], 1, 0),
    ]);

    expect(response.criteriaMetId).toBe(firing.data!.id);
    // Handed to the creator, which finds it open and adds nothing...
    expect(alertCreatorSeries(firing.data!.id)).toEqual(["api"]);

    // ...and still breaching on the resolve pass, so its alert stays open.
    const resolveInput: {
      breachingSeriesFingerprints?: Set<string>;
      breachingSeriesFingerprintsByCriteriaId?: Dictionary<Set<string>>;
    } = resolveAlerts.mock.calls[0]![0] as {
      breachingSeriesFingerprints?: Set<string>;
      breachingSeriesFingerprintsByCriteriaId?: Dictionary<Set<string>>;
    };
    expect(
      Array.from(
        resolveInput.breachingSeriesFingerprintsByCriteriaId?.[
          firing.data!.id
        ] || [],
      ),
    ).toEqual([fingerprintOf("api")]);
    expect(
      Array.from(resolveInput.breachingSeriesFingerprints || []),
    ).toContain(fingerprintOf("api"));
  });

  test("an open alert of another deployment does not let a new one skip its window", async () => {
    const open: Alert = new Alert();
    open.createdCriteriaId = firing.data!.id;
    open.seriesFingerprint = fingerprintOf("checkout");
    openAlerts = [open];
    monitor.currentMonitorStatusId = OFFLINE;

    const response: ProbeApiIngestResponse = await ingest([
      series("checkout", range(0, 15), 2, 1),
      series("api", [14, 15], 1, 0),
    ]);

    expect(response.criteriaMetId).toBe(firing.data!.id);
    expect(alertCreatorSeries(firing.data!.id)).toEqual(["checkout"]);
  });

  test("a recovered deployment is no longer breaching, open alert or not", async () => {
    const open: Alert = new Alert();
    open.createdCriteriaId = firing.data!.id;
    open.seriesFingerprint = fingerprintOf("api");
    openAlerts = [open];
    monitor.currentMonitorStatusId = OFFLINE;

    const response: ProbeApiIngestResponse = await ingest([
      series("checkout", range(0, 15), 2, 2),
      // Short until 12:14, then its replica came up.
      {
        ...series("api", range(0, 15), 1, 0),
        aggregatedResults: (() => {
          const short: MetricSeriesResult = series("api", range(0, 14), 1, 0);
          const fixed: MetricSeriesResult = series("api", [15], 1, 1);
          return short.aggregatedResults.map(
            (result: AggregatedResult, index: number): AggregatedResult => {
              return {
                data: [...result.data, ...fixed.aggregatedResults[index]!.data],
              };
            },
          );
        })(),
      },
    ]);

    expect(response.criteriaMetId).toBe(healthy.data!.id);
    expect(alertCreatorSeries(firing.data!.id)).toEqual([]);

    const resolveInput: {
      breachingSeriesFingerprintsByCriteriaId?: Dictionary<Set<string>>;
    } = resolveAlerts.mock.calls[0]![0] as {
      breachingSeriesFingerprintsByCriteriaId?: Dictionary<Set<string>>;
    };
    expect(
      Array.from(
        resolveInput.breachingSeriesFingerprintsByCriteriaId?.[
          firing.data!.id
        ] || [],
      ),
    ).toEqual([]);
  });
});
