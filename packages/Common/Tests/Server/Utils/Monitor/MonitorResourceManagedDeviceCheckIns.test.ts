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
import ManagedDeviceCheckInSilence from "../../../../Server/Utils/Monitor/ManagedDeviceCheckInSilence";
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
import { getManagedDeviceAlertTemplateById } from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Esper Device Stopped Checking In, on the path every check of it takes
 * (#9835): the worker's answer - each device's latest reading, one series
 * per device - goes into MonitorResourceUtil.monitorResource, through the
 * real criteria evaluator. One alert per device quiet for more than an
 * hour, none for the others; a device back, or gone from the fleet,
 * resolves; and a window with no reading of any device - the connection
 * stopped reading - resolves nothing.
 *
 * Postgres, Redis and the incident and alert machinery are stood in for;
 * what is asserted is what they are asked to do.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 10, 30));
const READ_AT: number = Date.UTC(2026, 10, 19, 12, 0, 0);

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: string = "55555555-5555-4555-8555-555555555555";
const DEVICE_KEY: string = "oneuptime.managed_device.name";

function checkInStep(): MonitorStep {
  return getManagedDeviceAlertTemplateById(
    "esper-device-stopped-checking-in",
  )!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION,
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Device Stopped Checking In",
  });
}

let monitor: Monitor;
let step: MonitorStep;
let closeIncidents: jest.SpyInstance;
let closeAlerts: jest.SpyInstance;
let createAlerts: jest.SpyInstance;
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

function fingerprintOf(device: string): string {
  return MetricSeriesFingerprint.computeFingerprint({ [DEVICE_KEY]: device });
}

/*
 * The worker's answer at a read: each device's latest reading (judged on
 * it alone, as the step asks), one series per device.
 */
function check(
  minutesQuietByDevice: Record<string, number>,
): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
  const readings: Array<[string, number]> =
    Object.entries(minutesQuietByDevice);

  const sample: (device: string, minutes: number) => AggregateModel = (
    device: string,
    minutes: number,
  ): AggregateModel => {
    return {
      timestamp: new Date(READ_AT),
      value: minutes,
      attributes: { [DEVICE_KEY]: device },
    } as unknown as AggregateModel;
  };

  const seriesBreakdown: Array<MetricSeriesResult> = readings.map(
    ([device, minutes]: [string, number]): MetricSeriesResult => {
      return {
        fingerprint: fingerprintOf(device),
        labels: { [DEVICE_KEY]: device },
        aggregatedResults: [{ data: [sample(device, minutes)] }],
      };
    },
  );

  const metricResult: Array<AggregatedResult> = [
    {
      data: readings.map(([device, minutes]: [string, number]) => {
        return sample(device, minutes);
      }),
    },
  ];

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: metricResult,
    seriesBreakdown: seriesBreakdown,
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past2Hours,
      NOW,
    ),
  };
}

/*
 * The devices handed to a criteria that opens alerts: the alert creator is
 * handed every criteria that matched, the recovery one too, whose matches -
 * the devices that are fine - it opens nothing for.
 */
function alertedDevices(): Array<string> {
  return createAlerts.mock.calls.flatMap((call: Array<unknown>) => {
    const input: {
      criteriaInstance?: { data?: { createAlerts?: boolean } };
      matchesPerSeries?: Array<PerSeriesCriteriaMatch>;
    } = call[0] as {
      criteriaInstance?: { data?: { createAlerts?: boolean } };
      matchesPerSeries?: Array<PerSeriesCriteriaMatch>;
    };

    if (input.criteriaInstance?.data?.createAlerts !== true) {
      return [];
    }

    return (input.matchesPerSeries || []).map(
      (match: PerSeriesCriteriaMatch): string => {
        return String((match.labels || {})[DEVICE_KEY]);
      },
    );
  });
}

describe("Esper Device Stopped Checking In, through monitorResource", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    monitor = new Monitor();
    monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
    monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
    monitor.name = "Esper acme - Esper Device Stopped Checking In";
    // A device is alerting: the monitor is offline.
    monitor.currentMonitorStatusId = OFFLINE;
    useStep(MonitorType.Metrics, checkInStep());

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
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockResolvedValue(undefined as never);
    createAlerts = jest
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

  test("one alert for the device quiet for more than an hour, none for the others", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check({
          "ESP-ID-AAAAW": 75,
          "ESP-ID-AAAAX": 4,
          "ESP-ID-AAAAY": 60,
        }),
      );

    const unhealthyId: string | undefined =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
        .id;

    expect(response.criteriaMetId).toBe(unhealthyId);
    expect(alertedDevices()).toEqual(["ESP-ID-AAAAW"]);
  });

  test("every device quiet for more than an hour gets an alert of its own", async () => {
    await MonitorResourceUtil.monitorResource(
      check({
        "ESP-ID-AAAAW": 75,
        "ESP-ID-AAAAX": 61,
        "ESP-ID-AAAAY": 3,
      }),
    );

    expect(alertedDevices().sort()).toEqual(["ESP-ID-AAAAW", "ESP-ID-AAAAX"]);
  });

  test("every device back within the hour resolves the open alerts", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check({ "ESP-ID-AAAAW": 2, "ESP-ID-AAAAX": 9 }),
      );

    const healthyId: string | undefined =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
        .id;

    expect(response.criteriaMetId).toBe(healthyId);
    expect(alertedDevices()).toEqual([]);
    expect(closeAlerts).toHaveBeenCalled();
  });

  test("a device that left the fleet, or now runs the agent, no longer breaches: its alert resolves while the others read on", async () => {
    // ESP-ID-AAAAW was alerting; it has no reading now, ESP-ID-AAAAX is fine.
    await MonitorResourceUtil.monitorResource(check({ "ESP-ID-AAAAX": 6 }));

    const unhealthyId: string =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
        .id!;

    expect(closeAlerts).toHaveBeenCalled();

    const breaching: Record<string, Set<string>> | undefined = (
      closeAlerts.mock.calls[0]![0] as {
        breachingSeriesFingerprintsByCriteriaId?: Record<string, Set<string>>;
      }
    ).breachingSeriesFingerprintsByCriteriaId;

    // Evaluated, and breached by no device: the gone device's alert closes.
    expect(breaching?.[unhealthyId]).toBeDefined();
    expect(breaching![unhealthyId]!.has(fingerprintOf("ESP-ID-AAAAW"))).toBe(
      false,
    );
  });

  test("a window with no reading of any device - the connection stopped reading - resolves nothing", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check({}));

    expect(response.criteriaMetId).toBeFalsy();
    expect(closeAlerts).not.toHaveBeenCalled();
    expect(closeIncidents).not.toHaveBeenCalled();
    expect(timelineCreate).not.toHaveBeenCalled();
    expect(alertedDevices()).toEqual([]);
  });

  test("another Metrics monitor's silence keeps its old meaning: no criteria met is the default status", async () => {
    useStep(
      MonitorType.Metrics,
      getHostAlertTemplateById("host-high-cpu")!.getMonitorStep({
        hostIdentifier: "web-01",
        onlineMonitorStatusId: ONLINE,
        offlineMonitorStatusId: OFFLINE,
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "web-01 CPU",
      }),
    );

    await MonitorResourceUtil.monitorResource(check({}));

    expect(closeAlerts).toHaveBeenCalled();
    expect(timelineCreate).toHaveBeenCalled();
  });
});

describe("ManagedDeviceCheckInSilence", () => {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(
    getManagedDeviceAlertTemplateById(
      "esper-device-stopped-checking-in",
    )!.getMonitorStep({
      deviceManagementConnectionId: CONNECTION,
      onlineMonitorStatusId: ONLINE,
      offlineMonitorStatusId: OFFLINE,
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Esper",
    }),
  )!;

  const point: AggregateModel = {
    timestamp: new Date(READ_AT),
    value: 75,
  } as AggregateModel;

  function response(input: {
    metricViewConfig?: MetricsViewConfig;
    metricResult?: Array<AggregatedResult> | undefined;
    seriesBreakdown?: Array<MetricSeriesResult> | undefined;
  }): DataToProcess {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: input.metricViewConfig || view,
      metricResult: input.metricResult,
      seriesBreakdown: input.seriesBreakdown,
    } as MetricMonitorResponse;
  }

  test("a check of the check-ins with no reading at all is quiet", () => {
    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({ metricResult: [{ data: [] }], seriesBreakdown: [] }),
      ),
    ).toBe(true);
    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({
          metricResult: [{ data: [] }],
          seriesBreakdown: [
            {
              fingerprint: "a",
              labels: { [DEVICE_KEY]: "ESP-ID-AAAAW" },
              aggregatedResults: [{ data: [] }],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("one reading of one device is not", () => {
    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({ metricResult: [{ data: [point] }] }),
      ),
    ).toBe(false);
    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({
          metricResult: [{ data: [] }],
          seriesBreakdown: [
            {
              fingerprint: "a",
              labels: { [DEVICE_KEY]: "ESP-ID-AAAAW" },
              aggregatedResults: [{ data: [point] }],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  test("only a monitor whose every query reads the check-ins, and only a telemetry check's answer", () => {
    const otherView: MetricsViewConfig = {
      queryConfigs: [
        ...view.queryConfigs,
        {
          ...view.queryConfigs[0]!,
          metricQueryData: {
            ...view.queryConfigs[0]!.metricQueryData,
            filterData: {
              ...view.queryConfigs[0]!.metricQueryData.filterData,
              metricName: "system.memory.usage",
            },
          },
        },
      ],
      formulaConfigs: [],
    };

    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({ metricViewConfig: otherView, metricResult: [] }),
      ),
    ).toBe(false);
    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({
          metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
          metricResult: [],
        }),
      ),
    ).toBe(false);
    expect(
      ManagedDeviceCheckInSilence.isQuietWindow(
        response({ metricResult: undefined }),
      ),
    ).toBe(false);
    expect(ManagedDeviceCheckInSilence.isQuietWindow(undefined)).toBe(false);
  });

  test("MonitorResourceUtil reads it for a Metrics monitor only", () => {
    const metrics: Monitor = new Monitor();
    metrics.monitorType = MonitorType.Metrics;
    const logs: Monitor = new Monitor();
    logs.monitorType = MonitorType.Logs;
    const silent: DataToProcess = response({ metricResult: [{ data: [] }] });

    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: metrics,
        dataToProcess: silent,
      }),
    ).toBe(true);
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: logs,
        dataToProcess: silent,
      }),
    ).toBe(false);
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: metrics,
        dataToProcess: response({ metricResult: [{ data: [point] }] }),
      }),
    ).toBe(false);
  });
});
