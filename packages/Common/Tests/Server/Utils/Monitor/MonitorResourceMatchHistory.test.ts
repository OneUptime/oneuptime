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
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import FindBy from "../../../../Server/Types/AnalyticsDatabase/FindBy";
import logger from "../../../../Server/Utils/Logger";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe, {
  ProbeConnectionStatus,
} from "../../../../Models/DatabaseModels/Probe";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ProjectService from "../../../../Server/Services/ProjectService";

/*
 * Issue #4686 on the probe-response path: a probe result for a Website
 * monitor goes into MonitorResourceUtil.monitorResource - the function every
 * probe ingest job calls - and through the real criteria evaluator, the real
 * match history and the real probe agreement. Postgres, Redis and the
 * incident and alert machinery are stood in for; the metric store is an
 * in-memory table the history is written to and read back from.
 */

const START: Date = new Date("2026-10-13T09:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

const PLACEHOLDER_PAGE: string = "Application starting...";
const HEALTHY_PAGE: string = "<title>App Title</title>";

const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();

interface StoredRow {
  filterKey: string;
  value: number;
  time: Date;
  probeId: string | undefined;
}

let store: Array<StoredRow> = [];
let probes: Array<MonitorProbe> = [];

function atMinute(minute: number): void {
  jest.setSystemTime(new Date(START.getTime() + minute * MINUTE_IN_MS));
}

function criteria(input: {
  id: string;
  statusId: ObjectID;
  createIncidents: boolean;
  filterCondition: FilterCondition;
  filters: MonitorCriteriaInstance["data"] extends infer D
    ? D extends { filters: infer F }
      ? F
      : never
    : never;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    monitorStatusId: input.statusId,
    filterCondition: input.filterCondition,
    filters: input.filters,
    incidents: [],
    alerts: [],
    name: input.id,
    description: "",
    changeMonitorStatus: true,
    createIncidents: input.createIncidents,
    createAlerts: false,
    isEnabled: true,
  };
  return instance;
}

// Offline when down, or when the page has not had its title for 5 minutes.
function websiteMonitor(): { monitor: Monitor; step: MonitorStep } {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      criteria({
        id: "offline",
        statusId: OFFLINE_STATUS_ID,
        createIncidents: true,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.ResponseBody,
            filterType: FilterType.NotContains,
            value: "App Title",
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            },
          },
        ],
      }),
      criteria({
        id: "online",
        statusId: ONLINE_STATUS_ID,
        createIncidents: false,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
      }),
    ],
  };
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.name = "Acme";
  monitor.monitorType = MonitorType.Website;
  monitor.monitoringInterval = "* * * * *";
  monitor.monitorSteps = monitorSteps;

  return { monitor: monitor, step: step };
}

function addProbe(): ObjectID {
  const probeId: ObjectID = ObjectID.generate();
  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.probeId = probeId;
  monitorProbe.isEnabled = true;
  monitorProbe.lastMonitoringLog = {};
  const probe: Probe = new Probe();
  probe.name = `Probe ${probes.length + 1}`;
  probe.connectionStatus = ProbeConnectionStatus.Connected;
  monitorProbe.probe = probe;
  probes.push(monitorProbe);
  return probeId;
}

function probeResult(input: {
  monitor: Monitor;
  step: MonitorStep;
  probeId: ObjectID;
  body: string;
}): ProbeMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.step.id,
    probeId: input.probeId,
    failureCause: "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    isOnline: true,
    responseCode: 200,
    responseTimeInMs: 150,
    responseBody: input.body,
    responseHeaders: {},
  };
}

describe("MonitorResourceUtil.monitorResource: a Response Body check that waits (#4686)", () => {
  let createIncidents: jest.SpyInstance;

  beforeEach(() => {
    // Not a blocked project: that refusal has suites of its own (BlockedProject*).
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.useFakeTimers();
    atMinute(0);

    store = [];
    probes = [];

    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest.spyOn(MonitorService, "findOneById");
    jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MonitorProbeService, "findBy").mockImplementation(() => {
      return Promise.resolve(probes) as never;
    });
    jest
      .spyOn(MonitorProbeService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockImplementation(() => {
        // Already at the default status: the no-match path writes nothing.
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline.monitorStatusId = ONLINE_STATUS_ID;
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
    jest
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

    // The metric store: written by the real MonitorMetricUtil, read back.
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        for (const row of rows) {
          const attributes: JSONObject = row["attributes"] as JSONObject;

          store.push({
            filterKey: attributes[CRITERIA_FILTER_KEY_ATTRIBUTE] as string,
            value: row["value"] as number,
            time: OneUptimeDate.fromString(row["time"] as string),
            probeId: attributes["probeId"] as string | undefined,
          });
        }
      });
    jest
      .spyOn(MetricService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Metric>): Promise<Array<Metric>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;

          if (query["name"] !== CRITERIA_FILTER_MATCH_METRIC_NAME) {
            return [];
          }

          const time: InBetween<Date> = query[
            "time"
          ] as unknown as InBetween<Date>;
          const filterKey: string = (query["attributes"] as JSONObject)[
            CRITERIA_FILTER_KEY_ATTRIBUTE
          ] as string;

          return store
            .filter((row: StoredRow) => {
              return (
                row.filterKey === filterKey &&
                row.time.getTime() >= time.startValue.getTime() &&
                row.time.getTime() <= time.endValue.getTime()
              );
            })
            .map((row: StoredRow) => {
              const metric: Metric = new Metric();
              metric.value = row.value;
              metric.time = row.time;
              metric.attributes = {
                [CRITERIA_FILTER_KEY_ATTRIBUTE]: row.filterKey,
                ...(row.probeId ? { probeId: row.probeId } : {}),
              };
              return metric;
            });
        },
      );

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /*
   * How often the incident creator was handed the offline criteria - the
   * one that declares the incident. (It is handed every matched criteria
   * and decides from the criteria's own switch.)
   */
  function offlineIncidentRequests(): number {
    return createIncidents.mock.calls.filter((call: Array<unknown>) => {
      return (
        (call[0] as { criteriaInstance: MonitorCriteriaInstance })
          .criteriaInstance.data?.id === "offline"
      );
    }).length;
  }

  async function ingest(input: {
    monitor: Monitor;
    step: MonitorStep;
    probeId: ObjectID;
    body: string;
  }): Promise<ProbeApiIngestResponse> {
    (MonitorService.findOneById as unknown as jest.Mock).mockResolvedValue(
      input.monitor as never,
    );

    return MonitorResourceUtil.monitorResource(
      probeResult({
        monitor: input.monitor,
        step: input.step,
        probeId: input.probeId,
        body: input.body,
      }),
    );
  }

  test("the restarting app opens no incident until its placeholder has lasted the window", async () => {
    const { monitor, step } = websiteMonitor();
    const probeId: ObjectID = addProbe();

    // Five checks a minute apart: four minutes of the placeholder.
    for (let minute: number = 0; minute < 5; minute++) {
      atMinute(minute);

      const response: ProbeApiIngestResponse = await ingest({
        monitor,
        step,
        probeId,
        body: PLACEHOLDER_PAGE,
      });

      expect({ minute, criteriaMet: response.criteriaMetId }).toEqual({
        minute,
        criteriaMet: "online",
      });
    }

    expect(offlineIncidentRequests()).toBe(0);

    atMinute(5);

    const response: ProbeApiIngestResponse = await ingest({
      monitor,
      step,
      probeId,
      body: PLACEHOLDER_PAGE,
    });

    expect(response.criteriaMetId).toBe("offline");
    expect(response.rootCause).toContain(
      'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
    );

    // The offline criteria's incident is asked for now, and only now.
    expect(offlineIncidentRequests()).toBe(1);

    const offlineCall: { rootCause: string } = createIncidents.mock.calls.find(
      (call: Array<unknown>) => {
        return (
          (call[0] as { criteriaInstance: MonitorCriteriaInstance })
            .criteriaInstance.data?.id === "offline"
        );
      },
    )![0] as { rootCause: string };

    expect(offlineCall.rootCause).toBe(response.rootCause);
  });

  test("a site that is down still opens its incident on the first check", async () => {
    const { monitor, step } = websiteMonitor();
    const probeId: ObjectID = addProbe();

    (MonitorService.findOneById as unknown as jest.Mock).mockResolvedValue(
      monitor as never,
    );

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource({
        ...probeResult({ monitor, step, probeId, body: "" }),
        isOnline: false,
        responseCode: 0,
      } as ProbeMonitorResponse);

    expect(response.criteriaMetId).toBe("offline");
    expect(offlineIncidentRequests()).toBe(1);
  });

  test("every probe result writes the body check's result, and only once", async () => {
    const { monitor, step } = websiteMonitor();
    const probeId: ObjectID = addProbe();

    atMinute(0);
    await ingest({ monitor, step, probeId, body: HEALTHY_PAGE });
    atMinute(1);
    await ingest({ monitor, step, probeId, body: PLACEHOLDER_PAGE });

    expect(
      store.map((row: StoredRow) => {
        return row.value;
      }),
    ).toEqual([0, 1]);
  });

  test("with two probes, each is judged by its own checks, and the incident waits for both", async () => {
    const { monitor, step } = websiteMonitor();
    const firstProbe: ObjectID = addProbe();
    const secondProbe: ObjectID = addProbe();

    for (let minute: number = 0; minute < 5; minute++) {
      atMinute(minute);

      for (const probeId of [firstProbe, secondProbe]) {
        expect({
          minute,
          criteriaMet: (
            await ingest({ monitor, step, probeId, body: PLACEHOLDER_PAGE })
          ).criteriaMetId,
        }).toEqual({ minute, criteriaMet: "online" });
      }
    }

    // One row per probe result: the agreement passes added none.
    expect(store).toHaveLength(10);
    expect(
      store.filter((row: StoredRow) => {
        return row.probeId === firstProbe.toString();
      }),
    ).toHaveLength(5);

    /*
     * Minute 5: the first probe has seen the placeholder for five minutes.
     * The second probe's last result, from minute 4, is judged by the
     * second probe's own checks: four minutes so far. The probes do not
     * agree yet, so nothing is opened.
     */
    atMinute(5);

    const first: ProbeApiIngestResponse = await ingest({
      monitor,
      step,
      probeId: firstProbe,
      body: PLACEHOLDER_PAGE,
    });

    expect(first.criteriaMetId).toBe("offline");
    expect(first.evaluationSummary?.events).toContainEqual(
      expect.objectContaining({
        type: "probe-agreement",
        message: expect.stringContaining("Probe agreement not reached: 1/2"),
      }),
    );
    expect(offlineIncidentRequests()).toBe(0);

    // The second probe's own check completes its window too: both agree.
    const second: ProbeApiIngestResponse = await ingest({
      monitor,
      step,
      probeId: secondProbe,
      body: PLACEHOLDER_PAGE,
    });

    expect(second.criteriaMetId).toBe("offline");
    expect(second.rootCause).toContain("Probes in Agreement");
    expect(second.rootCause).toContain("Probe 1");
    expect(second.rootCause).toContain("Probe 2");
    expect(offlineIncidentRequests()).toBe(1);
    expect(store).toHaveLength(12);
  });

  test("one probe result reads each history once, for its own probe and the agreement pass", async () => {
    const { monitor, step } = websiteMonitor();
    const probeIds: Array<ObjectID> = [addProbe(), addProbe(), addProbe()];

    for (let minute: number = 0; minute < 5; minute++) {
      atMinute(minute);

      for (const probeId of probeIds) {
        await ingest({ monitor, step, probeId, body: PLACEHOLDER_PAGE });
      }
    }

    atMinute(5);

    const findBy: jest.SpyInstance =
      MetricService.findBy as unknown as jest.SpyInstance;
    findBy.mockClear();

    // Its own window, and the two other probes' windows in the agreement pass.
    await ingest({
      monitor,
      step,
      probeId: probeIds[0]!,
      body: PLACEHOLDER_PAGE,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
  });
});
