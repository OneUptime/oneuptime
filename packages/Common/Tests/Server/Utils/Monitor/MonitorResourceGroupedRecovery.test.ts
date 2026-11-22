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
import SeriesBehindStatus from "../../../../Server/Utils/Monitor/SeriesBehindStatus";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
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
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { MonitorEvaluationEvent } from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A GROUPED MONITOR KEEPS ITS STATUS WHILE THE SERIES BEHIND IT WAIT (issue
 * #10061), on the path every telemetry check takes: the worker's answer goes
 * into MonitorResourceUtil.monitorResource, through the real criteria
 * evaluator, with the series behind the status kept in Redis between checks.
 *
 * A Host monitor from High Filesystem Usage fires above 90% and recovers at
 * or below 81%. Its full disk dropping to 89% used to bring it back online,
 * through the disks that were never near full. Now the monitor keeps its
 * status, its disk's incident and alert still resolve on their own series,
 * and the log says why. Postgres, Redis and the incident and alert
 * machinery are stood in for; what is asserted is what they are asked to do.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 22, 9, 10, 30));
const START: number = Date.UTC(2026, 10, 22, 9, 5, 0);
const MINUTE: number = 60_000;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const ROOT: { mountpoint: string; device: string } = {
  mountpoint: "/",
  device: "/dev/sda1",
};
const DATA: { mountpoint: string; device: string } = {
  mountpoint: "/data",
  device: "/dev/sdb1",
};

const DATA_FINGERPRINT: string = MetricSeriesFingerprint.computeFingerprint(DATA);

let monitor: Monitor;
let step: MonitorStep;
let redis: Map<string, string>;
let timelineCreate: jest.SpyInstance;
let updateTimeline: jest.SpyInstance;
let closeIncidents: jest.SpyInstance;
let closeAlerts: jest.SpyInstance;
let saveMonitorLog: jest.SpyInstance;

function useStep(monitorStep: MonitorStep): void {
  step = monitorStep;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;
}

function filesystemStep(): MonitorStep {
  return getHostAlertTemplateById("host-high-filesystem")!.getMonitorStep({
    hostIdentifier: "web-01",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-01",
  });
}

function criteriaId(role: "offline" | "online"): string {
  const instance: MonitorCriteriaInstance | undefined =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.find(
      (criteria: MonitorCriteriaInstance): boolean => {
        return (
          criteria.data!.monitorStatusId!.toString() ===
          (role === "offline" ? OFFLINE : ONLINE).toString()
        );
      },
    );

  return instance!.data!.id.toString();
}

// One disk's query results and the formula computed from them, minute by minute.
function diskResults(percent: number): Array<AggregatedResult> {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;

  const queryResults: Array<AggregatedResult> = view.queryConfigs.map(
    (): AggregatedResult => {
      return {
        data: [0, 1, 2, 3, 4, 5].map((minute: number): AggregateModel => {
          return {
            timestamp: new Date(START + minute * MINUTE),
            value: percent / 100,
          } as AggregateModel;
        }),
      };
    },
  );

  return [
    ...queryResults,
    ...view.formulaConfigs.map(
      (formula: MetricFormulaConfigData): AggregatedResult => {
        return MetricFormulaEvaluator.evaluateFormula({
          formula: formula.metricFormulaData.metricFormula,
          queryConfigs: view.queryConfigs,
          formulaConfigs: [],
          results: queryResults,
        });
      },
    ),
  ];
}

function check(
  disks: Array<[{ mountpoint: string; device: string }, number]>,
): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
  const grouped: boolean = MonitorStep.isJudgedPerSeries(step);

  const seriesBreakdown: Array<MetricSeriesResult> = disks.map(
    ([disk, percent]: [
      { mountpoint: string; device: string },
      number,
    ]): MetricSeriesResult => {
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(disk),
        labels: { ...disk },
        aggregatedResults: diskResults(percent),
      };
    },
  );

  const fullest: number = Math.max(
    ...disks.map(
      ([, percent]: [{ mountpoint: string; device: string }, number]) => {
        return percent;
      },
    ),
  );

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult:
      disks.length === 0
        ? view.queryConfigs.map((): AggregatedResult => {
            return { data: [] };
          })
        : grouped
          ? seriesBreakdown.flatMap((series: MetricSeriesResult) => {
              return series.aggregatedResults;
            })
          : diskResults(fullest),
    ...(grouped ? { seriesBreakdown: seriesBreakdown } : {}),
  };
}

function keptInRedis(): Array<string> | undefined {
  const key: string = `${SeriesBehindStatus.NAMESPACE}-${monitor.id!.toString().toLowerCase()}-${step.id.toString().toLowerCase()}`;
  const value: string | undefined = redis.get(key);
  return value === undefined ? undefined : (JSON.parse(value) as Array<string>);
}

function keepInRedis(fingerprints: Array<string>): void {
  const key: string = `${monitor.id!.toString().toLowerCase()}-${step.id.toString().toLowerCase()}`;
  redis.set(`${SeriesBehindStatus.NAMESPACE}-${key}`, JSON.stringify(fingerprints));
}

function eventsOf(response: ProbeApiIngestResponse): Array<MonitorEvaluationEvent> {
  return response.evaluationSummary?.events || [];
}

describe("MonitorResourceUtil: a grouped monitor keeps the recovery margin", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    redis = new Map<string, string>();

    monitor = new Monitor();
    monitor.id = new ObjectID("44444444-4444-4444-8444-444444444444");
    monitor.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
    monitor.name = "web-01 Filesystem";
    monitor.monitorType = MonitorType.Host;
    monitor.currentMonitorStatusId = OFFLINE;
    useStep(filesystemStep());

    jest
      .spyOn(GlobalCache, "getStringArray")
      .mockImplementation((namespace: string, key: string) => {
        const value: string | undefined = redis.get(`${namespace}-${key}`);
        return Promise.resolve(
          value === undefined ? null : (JSON.parse(value) as Array<string>),
        );
      });
    jest
      .spyOn(GlobalCache, "setStringArray")
      .mockImplementation(
        (namespace: string, key: string, value: Array<string>) => {
          redis.set(`${namespace}-${key}`, JSON.stringify(value));
          return Promise.resolve();
        },
      );
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation((namespace: string, key: string) => {
        redis.delete(`${namespace}-${key}`);
        return Promise.resolve();
      });

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockImplementation(() => {
        return Promise.resolve(monitor) as never;
      });
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
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    timelineCreate = jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockResolvedValue(new MonitorStatusTimeline() as never);
    jest
      .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
      .mockResolvedValue(undefined);
    saveMonitorLog = jest
      .spyOn(MonitorLogUtil, "saveMonitorLog")
      .mockReturnValue(undefined);
    updateTimeline = jest
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
    closeIncidents = jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    closeAlerts = jest
      .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([]);
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("the 96% disk takes the monitor down, and is kept as the series behind its status", async () => {
    monitor.currentMonitorStatusId = ONLINE;

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check([
          [ROOT, 70],
          [DATA, 96],
        ]),
      );

    expect(response.criteriaMetId).toBe(criteriaId("offline"));
    expect(updateTimeline).toHaveBeenCalledTimes(1);
    expect(keptInRedis()).toEqual([DATA_FINGERPRINT]);
  });

  test("at 89% the monitor keeps its status, its disk's records resolve on their own series, and the log says why", async () => {
    keepInRedis([DATA_FINGERPRINT]);

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check([
          [ROOT, 70],
          [DATA, 89],
        ]),
      );

    expect(response.criteriaMetId).toBeUndefined();

    // Neither a status change to the online criteria nor a revert to the default.
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(timelineCreate).not.toHaveBeenCalled();

    // What is open resolves series by series: nothing breaches any criteria.
    expect(closeIncidents).toHaveBeenCalledTimes(1);
    expect(closeAlerts).toHaveBeenCalledTimes(1);

    const resolve: {
      criteriaInstance: unknown;
      breachingSeriesFingerprints?: Set<string>;
      breachingSeriesFingerprintsByCriteriaId?: Record<string, Set<string>>;
    } = closeIncidents.mock.calls[0]![0] as never;

    expect(resolve.criteriaInstance).toBeNull();
    expect(Array.from(resolve.breachingSeriesFingerprints!)).toEqual([]);
    expect(
      Array.from(
        resolve.breachingSeriesFingerprintsByCriteriaId![criteriaId("offline")]!,
      ),
    ).toEqual([]);

    const kept: MonitorEvaluationEvent | undefined = eventsOf(response).find(
      (event: MonitorEvaluationEvent): boolean => {
        return event.type === "monitor-status-kept";
      },
    );

    expect(kept?.title).toBe("Monitor status kept");
    expect(kept?.message).toBe(
      "The monitor keeps its status until Mount: /data | Device: /dev/sdb1 meets a criteria that brings it back.",
    );
    expect(kept?.messageSentence?.count).toBe(1);

    // Still behind the status, for the next check.
    expect(keptInRedis()).toEqual([DATA_FINGERPRINT]);

    // The monitor log keeps the disk that holds the status first.
    const seriesActedOn: ReadonlySet<string> = (
      saveMonitorLog.mock.calls[0]![0] as { seriesActedOn: ReadonlySet<string> }
    ).seriesActedOn;
    expect(Array.from(seriesActedOn)).toEqual([DATA_FINGERPRINT]);
  });

  test("at 81% the online criteria brings it back, and nothing is kept any more", async () => {
    keepInRedis([DATA_FINGERPRINT]);

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check([
          [ROOT, 70],
          [DATA, 81],
        ]),
      );

    expect(response.criteriaMetId).toBe(criteriaId("online"));
    expect(updateTimeline).toHaveBeenCalledTimes(1);
    expect(
      (
        updateTimeline.mock.calls[0]![0] as {
          criteriaInstance: MonitorCriteriaInstance;
        }
      ).criteriaInstance.data!.id.toString(),
    ).toBe(criteriaId("online"));
    expect(keptInRedis()).toBeUndefined();
  });

  test("a Redis that cannot be reached brings the monitor back on any disk, as before", async () => {
    (GlobalCache.getStringArray as unknown as jest.SpyInstance).mockRejectedValue(
      new Error("Cache is not connected"),
    );

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check([
          [ROOT, 70],
          [DATA, 89],
        ]),
      );

    expect(response.criteriaMetId).toBe(criteriaId("online"));
  });

  test("a window with no data keeps the status, the open records and what is behind the status", async () => {
    keepInRedis([DATA_FINGERPRINT]);

    await MonitorResourceUtil.monitorResource(check([]));

    expect(timelineCreate).not.toHaveBeenCalled();
    expect(closeIncidents).not.toHaveBeenCalled();
    expect(keptInRedis()).toEqual([DATA_FINGERPRINT]);
  });

  test("an ungrouped monitor between 81% and 90% goes to its default status, as before, and keeps nothing", async () => {
    const ungrouped: MonitorStep = filesystemStep();

    for (const queryConfig of MonitorStep.getMetricsViewConfig(ungrouped)!
      .queryConfigs) {
      queryConfig.metricQueryData.groupByAttributeKeys = [];
    }

    useStep(ungrouped);

    await MonitorResourceUtil.monitorResource(
      check([
        [ROOT, 70],
        [DATA, 89],
      ]),
    );

    expect(timelineCreate).toHaveBeenCalledTimes(1);
    expect(
      (timelineCreate.mock.calls[0]![0] as { data: MonitorStatusTimeline })
        .data.monitorStatusId!.toString(),
    ).toBe(ONLINE.toString());
    expect(closeIncidents).toHaveBeenCalledTimes(1);
    expect(GlobalCache.getStringArray).not.toHaveBeenCalled();
    expect(GlobalCache.setStringArray).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
  });
});
