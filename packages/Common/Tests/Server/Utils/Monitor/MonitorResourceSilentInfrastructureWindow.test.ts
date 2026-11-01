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
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
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
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Silence is not recovery, on the path every telemetry check of an
 * infrastructure monitor takes: the worker's answer goes into
 * MonitorResourceUtil.monitorResource, through the real criteria evaluator.
 *
 * A template's criteria compare values, so a window in which the agent sent
 * nothing at all matches none of them - and "no criteria met" used to put
 * the monitor back on its default status and close its open incidents and
 * alerts. An OSD Down or Node Offline incident resolved itself the moment
 * the agent that reported it stopped, and the monitor turned green.
 *
 * Postgres, Redis and the incident and alert machinery are stood in for;
 * what is asserted is what they are asked to do.
 */

const NOW: Date = new Date(Date.UTC(2026, 9, 30, 12, 10, 30));
const START: number = Date.UTC(2026, 9, 30, 12, 0, 0);
const MINUTE: number = 60_000;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function hostCpuStep(): MonitorStep {
  return getHostAlertTemplateById("host-high-cpu")!.getMonitorStep({
    hostIdentifier: "web-01",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-01 CPU",
  });
}

let monitor: Monitor;
let step: MonitorStep;
let closeIncidents: jest.SpyInstance;
let closeAlerts: jest.SpyInstance;
let createIncidents: jest.SpyInstance;
let timelineCreate: jest.SpyInstance;

function useStep(monitorType: MonitorType, monitorStep: MonitorStep): void {
  step = monitorStep;
  monitor.monitorType = monitorType;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;
}

// Every query of the step answered with these per-minute values.
function check(values: Array<number>): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
  const result: AggregatedResult = {
    data: values.map((value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(START + index * MINUTE),
        value: value,
      } as AggregateModel;
    }),
  };

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: [
      ...view.queryConfigs.map((): AggregatedResult => {
        return result;
      }),
      ...view.formulaConfigs.map((): AggregatedResult => {
        return result;
      }),
    ],
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past5Minutes,
      NOW,
    ),
  };
}

function silentCheck(): MetricMonitorResponse {
  return check([]);
}

async function ingest(
  response: MetricMonitorResponse,
): Promise<ProbeApiIngestResponse> {
  return MonitorResourceUtil.monitorResource(response);
}

describe("MonitorResourceUtil: an infrastructure monitor's silence is not recovery", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    monitor = new Monitor();
    monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
    monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
    monitor.name = "web-01 CPU";
    // An incident is open: the monitor is offline.
    monitor.currentMonitorStatusId = OFFLINE;
    useStep(MonitorType.Host, hostCpuStep());

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
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    timelineCreate = jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockResolvedValue(new MonitorStatusTimeline() as never);
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
    closeIncidents = jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    closeAlerts = jest
      .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    createIncidents = jest
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

  test("a window with no data keeps the offline status and the open incident and alert", async () => {
    const response: ProbeApiIngestResponse = await ingest(silentCheck());

    expect(response.criteriaMetId).toBeFalsy();
    expect(closeIncidents).not.toHaveBeenCalled();
    expect(closeAlerts).not.toHaveBeenCalled();
    expect(timelineCreate).not.toHaveBeenCalled();
  });

  test("a grouped check whose every series is empty is silence too", async () => {
    const response: MetricMonitorResponse = silentCheck();
    const emptySeries: MetricSeriesResult = {
      fingerprint: "mount-root",
      labels: { mountpoint: "/" },
      aggregatedResults: response.metricResult,
    };
    response.seriesBreakdown = [emptySeries];

    await ingest(response);

    expect(closeIncidents).not.toHaveBeenCalled();
    expect(timelineCreate).not.toHaveBeenCalled();
  });

  test("data that matches no criteria still goes back to the default status, as before", async () => {
    // 75% sits between the template's fire (above 80) and recover (72 or below) lines.
    await ingest(check([75, 75, 75, 75, 75, 75]));

    expect(closeIncidents).toHaveBeenCalled();
    expect(timelineCreate).toHaveBeenCalled();
  });

  test("a Metrics monitor's silence keeps its old meaning: no criteria met is the default status", async () => {
    useStep(MonitorType.Metrics, hostCpuStep());

    await ingest(silentCheck());

    expect(closeIncidents).toHaveBeenCalled();
    expect(timelineCreate).toHaveBeenCalled();
  });

  test("the out-of-the-box criteria call silence offline, so it opens their incident", async () => {
    const monitorStep: MonitorStep = hostCpuStep();
    monitorStep.setMonitorCriteria(
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: MonitorType.Host,
        monitorName: "web-01",
        onlineMonitorStatusId: ONLINE,
        offlineMonitorStatusId: OFFLINE,
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
      }),
    );
    monitor.currentMonitorStatusId = ONLINE;
    useStep(MonitorType.Host, monitorStep);

    const response: ProbeApiIngestResponse = await ingest(silentCheck());

    const offlineCriteriaId: string | undefined =
      monitorStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!
        .data!.id;
    expect(response.criteriaMetId).toBe(offlineCriteriaId);
    expect(createIncidents).toHaveBeenCalled();
  });

  test("the out-of-the-box criteria call a value of 0 online, not offline", async () => {
    const monitorStep: MonitorStep = hostCpuStep();
    monitorStep.setMonitorCriteria(
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: MonitorType.Host,
        monitorName: "web-01",
        onlineMonitorStatusId: ONLINE,
        offlineMonitorStatusId: OFFLINE,
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
      }),
    );
    useStep(MonitorType.Host, monitorStep);

    const response: ProbeApiIngestResponse = await ingest(check([0, 0, 0]));

    const onlineCriteriaId: string | undefined =
      monitorStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!
        .data!.id;
    expect(response.criteriaMetId).toBe(onlineCriteriaId);

    // Only the online criteria went on to its actions, and it opens nothing.
    for (const call of createIncidents.mock.calls) {
      const criteria: { data?: { id?: string; createIncidents?: boolean } } = (
        call[0] as {
          criteriaInstance: {
            data?: { id?: string; createIncidents?: boolean };
          };
        }
      ).criteriaInstance;
      expect(criteria.data?.id).toBe(onlineCriteriaId);
      expect(criteria.data?.createIncidents).toBe(false);
    }
  });
});

describe("MonitorResourceUtil.isSilentInfrastructureWindow", () => {
  const host: Monitor = new Monitor();
  host.monitorType = MonitorType.Host;

  function response(
    metricResult: Array<AggregatedResult>,
    seriesBreakdown?: Array<MetricSeriesResult>,
  ): DataToProcess {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      metricResult: metricResult,
      seriesBreakdown: seriesBreakdown,
    } as MetricMonitorResponse;
  }

  const point: AggregateModel = {
    timestamp: new Date(START),
    value: 0,
  } as AggregateModel;

  test("every query empty is silent; one value of 0 is not", () => {
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: host,
        dataToProcess: response([{ data: [] }, { data: [] }]),
      }),
    ).toBe(true);
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: host,
        dataToProcess: response([{ data: [] }, { data: [point] }]),
      }),
    ).toBe(false);
  });

  test("a series with data is not silent, whatever the whole-monitor result holds", () => {
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: host,
        dataToProcess: response(
          [{ data: [] }],
          [
            {
              fingerprint: "a",
              labels: {},
              aggregatedResults: [{ data: [point] }],
            },
          ],
        ),
      }),
    ).toBe(false);
  });

  test("only the infrastructure types, and only a telemetry check's answer", () => {
    for (const monitorType of [
      MonitorType.Metrics,
      MonitorType.Logs,
      MonitorType.Website,
    ]) {
      const other: Monitor = new Monitor();
      other.monitorType = monitorType;

      expect(
        MonitorResourceUtil.isSilentInfrastructureWindow({
          monitor: other,
          dataToProcess: response([{ data: [] }]),
        }),
      ).toBe(false);
    }

    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: host,
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
        } as unknown as DataToProcess,
      }),
    ).toBe(false);
  });

  test("every infrastructure type is covered", () => {
    for (const monitorType of [
      MonitorType.Host,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Proxmox,
      MonitorType.VMware,
      MonitorType.Ceph,
      MonitorType.StorageArray,
      MonitorType.IoTDevice,
    ]) {
      const infrastructure: Monitor = new Monitor();
      infrastructure.monitorType = monitorType;

      expect(
        MonitorResourceUtil.isSilentInfrastructureWindow({
          monitor: infrastructure,
          dataToProcess: response([{ data: [] }]),
        }),
      ).toBe(true);
    }
  });
});
