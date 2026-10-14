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
import LogGroupCriteriaFanOut, {
  LOG_GROUP_ALERT_RESOLVED_MESSAGE,
  LOG_GROUP_INCIDENT_RESOLVED_MESSAGE,
  LOG_GROUP_RESOLVED_ROOT_CAUSE,
} from "../../../../Server/Utils/Monitor/LogGroupCriteriaFanOut";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import LogMonitorGroupResult from "../../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Resolved By, from the worker's answer to the alert: a Logs monitor that
 * counts "interface.down" per interface and names "interface.up" as the
 * log that resolves one.
 *
 * What must hold, on the path every Logs monitor evaluation takes
 * (MonitorResourceUtil.monitorResource, with the real criteria evaluator):
 *
 *   - an interface that is down opens its own alert;
 *   - an interface the device has said nothing more about stays open:
 *     silence is not recovery;
 *   - an interface an "up" has arrived for is resolved, by fingerprint,
 *     whether or not anything else is still down;
 *   - a monitor that names no resolving log resolves a quiet group as it
 *     always has.
 *
 * Postgres, Redis and the alert and incident machinery are stood in for;
 * what is asserted is what they are asked to do.
 */

const OPERATIONAL: ObjectID = ObjectID.generate();
const DEGRADED: ObjectID = ObjectID.generate();

const GROUP_BY: Array<string> = [
  "networkDevice.name",
  "network.interface.name",
];

function group(
  device: string,
  networkInterface: string,
  logCount: number,
): LogMonitorGroupResult {
  const labels: JSONObject = {
    "networkDevice.name": device,
    "network.interface.name": networkInterface,
  };

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    logCount: logCount,
  };
}

function logCount(filterType: FilterType, value: number): CriteriaFilter {
  return { checkOn: CheckOn.LogCount, filterType: filterType, value: value };
}

function criteria(input: {
  id: string;
  statusId: ObjectID;
  filters: Array<CriteriaFilter>;
  createAlerts: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: input.id,
    monitorStatusId: input.statusId,
    filterCondition: FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: input.createAlerts
      ? [
          {
            id: "alert-template",
            title: "Interface down",
            description: "An interface went down.",
            alertSeverityId: ObjectID.generate(),
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    name: input.id,
    description: "",
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: input.createAlerts,
    isEnabled: true,
  };

  return instance;
}

// "interface.down" per interface, resolved by "interface.up" - or by nothing.
function interfaceMonitor(resolvedBy: boolean): Monitor {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      criteria({
        id: "down",
        statusId: DEGRADED,
        filters: [logCount(FilterType.GreaterThan, 0)],
        createAlerts: true,
      }),
      criteria({
        id: "healthy",
        statusId: OPERATIONAL,
        filters: [logCount(FilterType.EqualTo, 0)],
        createAlerts: false,
      }),
    ],
  };

  step.data!.monitorCriteria = monitorCriteria;
  step.data!.logMonitor = {
    ...MonitorStepLogMonitorUtil.getDefault(),
    attributes: { "event.name": "interface.down" },
    lastXSecondsOfLogs: 300,
    groupByAttributes: GROUP_BY,
    resolvedByAttributes: resolvedBy ? { "event.name": "interface.up" } : {},
  };

  const monitorSteps: MonitorSteps = new MonitorSteps();

  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: OPERATIONAL,
  };

  const monitor: Monitor = new Monitor();

  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.name = "Interfaces";
  monitor.monitorType = MonitorType.Logs;
  monitor.monitoringInterval = "* * * * *";
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

function workerAnswer(input: {
  monitor: Monitor;
  open: Array<LogMonitorGroupResult>;
  // Undefined: a monitor that names no resolving log.
  resolved?: Array<LogMonitorGroupResult> | undefined;
}): LogMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    logCount: input.open.reduce(
      (total: number, item: LogMonitorGroupResult) => {
        return total + item.logCount;
      },
      0,
    ),
    logQuery: {},
    groupByAttributes: GROUP_BY,
    groupBreakdown: input.open,
    totalGroupCount: input.open.length,
    ...(input.resolved ? { resolvedGroups: input.resolved } : {}),
  };
}

describe("LogGroupCriteriaFanOut - what the worker's answer says", () => {
  const monitor: Monitor = interfaceMonitor(true);

  test("a monitor is resolved by a log when its answer lists resolved groups, even none", () => {
    expect(
      LogGroupCriteriaFanOut.isResolvedByLog(
        workerAnswer({ monitor, open: [], resolved: [] }) as DataToProcess,
      ),
    ).toBe(true);
    expect(
      LogGroupCriteriaFanOut.isResolvedByLog(
        workerAnswer({
          monitor,
          open: [group("sw1", "Gi0/1", 1)],
          resolved: [group("sw1", "Gi0/2", 0)],
        }) as DataToProcess,
      ),
    ).toBe(true);
  });

  test("a monitor whose answer does not list them resolves when its logs stop", () => {
    expect(
      LogGroupCriteriaFanOut.isResolvedByLog(
        workerAnswer({ monitor, open: [] }) as DataToProcess,
      ),
    ).toBe(false);
    expect(LogGroupCriteriaFanOut.isResolvedByLog(undefined)).toBe(false);
    expect(
      LogGroupCriteriaFanOut.isResolvedByLog({
        resolvedGroups: "all of them",
      } as unknown as DataToProcess),
    ).toBe(false);
  });

  test("the resolved fingerprints are the groups', each once", () => {
    const first: LogMonitorGroupResult = group("sw1", "Gi0/1", 0);
    const second: LogMonitorGroupResult = group("sw2", "Gi0/9", 0);

    expect(
      LogGroupCriteriaFanOut.getResolvedFingerprints(
        workerAnswer({
          monitor,
          open: [group("sw1", "Gi0/2", 3)],
          resolved: [first, second, first],
        }) as DataToProcess,
      ),
    ).toEqual([first.fingerprint, second.fingerprint]);
  });

  test("an open group's fingerprint is never among them", () => {
    const open: LogMonitorGroupResult = group("sw1", "Gi0/2", 3);

    expect(
      LogGroupCriteriaFanOut.getResolvedFingerprints(
        workerAnswer({
          monitor,
          open: [open],
          resolved: [group("sw1", "Gi0/1", 0)],
        }) as DataToProcess,
      ),
    ).not.toContain(open.fingerprint);
  });

  test("an answer with nothing resolved, or none at all, has no fingerprints", () => {
    for (const dataToProcess of [
      workerAnswer({ monitor, open: [], resolved: [] }),
      workerAnswer({ monitor, open: [group("sw1", "Gi0/1", 1)] }),
      undefined,
      { resolvedGroups: [null, {}, { fingerprint: "" }, { fingerprint: 5 }] },
    ]) {
      expect(
        LogGroupCriteriaFanOut.getResolvedFingerprints(
          dataToProcess as unknown as DataToProcess,
        ),
      ).toEqual([]);
    }
  });

  test("the answer one group is judged on does not carry the others' resolutions", () => {
    const open: LogMonitorGroupResult = group("sw1", "Gi0/2", 3);
    const narrowed: LogMonitorResponse = LogGroupCriteriaFanOut.narrowToGroup({
      response: workerAnswer({
        monitor,
        open: [open],
        resolved: [group("sw1", "Gi0/1", 0)],
      }),
      group: open,
    });

    expect(narrowed.resolvedGroups).toBeUndefined();
    expect(narrowed.logCount).toBe(3);
    expect(narrowed.evaluatedGroup).toBe(open);
  });

  test("only open groups are judged: a resolved group is not an entity", () => {
    const open: LogMonitorGroupResult = group("sw1", "Gi0/2", 3);

    expect(
      LogGroupCriteriaFanOut.getGroupEntities({
        dataToProcess: workerAnswer({
          monitor,
          open: [open],
          resolved: [group("sw1", "Gi0/1", 0), group("sw2", "Gi0/9", 0)],
        }) as DataToProcess,
      }).map((entity: { labels: JSONObject }) => {
        return entity.labels;
      }),
    ).toEqual([open.labels]);
  });
});

describe("MonitorResourceUtil.isSeriesResolvedExplicitly", () => {
  function monitorOfType(monitorType: MonitorType): Monitor {
    const monitor: Monitor = interfaceMonitor(true);

    monitor.monitorType = monitorType;

    return monitor;
  }

  test("a Logs monitor resolved by a log, and every Incoming Request monitor", () => {
    const logs: Monitor = monitorOfType(MonitorType.Logs);

    expect(
      MonitorResourceUtil.isSeriesResolvedExplicitly({
        monitor: logs,
        dataToProcess: workerAnswer({
          monitor: logs,
          open: [],
          resolved: [],
        }) as DataToProcess,
      }),
    ).toBe(true);

    expect(
      MonitorResourceUtil.isSeriesResolvedExplicitly({
        monitor: monitorOfType(MonitorType.IncomingRequest),
        dataToProcess: {} as DataToProcess,
      }),
    ).toBe(true);
  });

  test("not a Logs monitor that names no resolving log, and not another type that happens to carry the field", () => {
    const logs: Monitor = monitorOfType(MonitorType.Logs);

    expect(
      MonitorResourceUtil.isSeriesResolvedExplicitly({
        monitor: logs,
        dataToProcess: workerAnswer({
          monitor: logs,
          open: [],
        }) as DataToProcess,
      }),
    ).toBe(false);

    for (const monitorType of [
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Website,
    ]) {
      const other: Monitor = monitorOfType(monitorType);

      expect(
        MonitorResourceUtil.isSeriesResolvedExplicitly({
          monitor: other,
          dataToProcess: workerAnswer({
            monitor: other,
            open: [],
            resolved: [],
          }) as DataToProcess,
        }),
      ).toBe(false);
    }
  });
});

describe("MonitorResourceUtil.monitorResource: a Logs monitor's groups, resolved by a log", () => {
  let resolveAlerts: jest.SpyInstance;
  let resolveIncidents: jest.SpyInstance;
  let checkOpenAlerts: jest.SpyInstance;
  let checkOpenIncidents: jest.SpyInstance;
  let createAlerts: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest.spyOn(MonitorService, "findOneById");
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

        timeline.monitorStatusId = OPERATIONAL;

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
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MetricService, "findBy").mockResolvedValue([] as never);

    checkOpenIncidents = jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    checkOpenAlerts = jest
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
    resolveIncidents = jest
      .spyOn(MonitorIncident, "resolveSeriesIncidentsByFingerprint")
      .mockResolvedValue(undefined as never);
    resolveAlerts = jest
      .spyOn(MonitorAlert, "resolveSeriesAlertsByFingerprint")
      .mockResolvedValue(undefined as never);

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function evaluate(
    monitor: Monitor,
    answer: LogMonitorResponse,
  ): Promise<ProbeApiIngestResponse> {
    (MonitorService.findOneById as unknown as jest.Mock).mockResolvedValue(
      monitor as never,
    );

    return MonitorResourceUtil.monitorResource(answer);
  }

  // The series the alert creator was asked to open an alert for.
  function alertedFingerprints(): Array<string> {
    const fingerprints: Array<string> = [];

    for (const call of createAlerts.mock.calls) {
      const input: {
        criteriaInstance: MonitorCriteriaInstance;
        matchesPerSeries?: Array<{ fingerprint: string }> | undefined;
      } = call[0];

      if (input.criteriaInstance.data?.id !== "down") {
        continue;
      }

      for (const match of input.matchesPerSeries || []) {
        fingerprints.push(match.fingerprint);
      }
    }

    return fingerprints.sort();
  }

  // Whether an open alert of a quiet group would be closed by this evaluation.
  function absenceResolutionIsOff(): boolean {
    const flags: Array<unknown> = [
      ...checkOpenAlerts.mock.calls,
      ...checkOpenIncidents.mock.calls,
    ].map((call: Array<unknown>) => {
      return (call[0] as { disableSeriesAbsenceResolution?: boolean })
        .disableSeriesAbsenceResolution;
    });

    expect(flags.length).toBeGreaterThanOrEqual(2);
    expect(new Set(flags).size).toBe(1);

    return flags[0] === true;
  }

  test("an interface that is down opens its own alert", async () => {
    const monitor: Monitor = interfaceMonitor(true);
    const first: LogMonitorGroupResult = group("sw1", "Gi0/2", 2);
    const second: LogMonitorGroupResult = group("sw2", "Gi0/1", 1);

    const response: ProbeApiIngestResponse = await evaluate(
      monitor,
      workerAnswer({ monitor, open: [first, second], resolved: [] }),
    );

    expect(response.criteriaMetId).toBe("down");
    expect(alertedFingerprints()).toEqual(
      [first.fingerprint, second.fingerprint].sort(),
    );
    // Nothing was resolved: no log said anything had recovered.
    expect(resolveAlerts).not.toHaveBeenCalled();
    expect(resolveIncidents).not.toHaveBeenCalled();
  });

  test("an interface the device has said nothing more about stays open: silence is not recovery", async () => {
    const monitor: Monitor = interfaceMonitor(true);

    /*
     * The down has left the window, and no up has come. A grouped monitor
     * with no group has nothing to judge, so no criteria is met and the
     * monitor goes back to its default status - the path that used to
     * close every open alert.
     */
    const response: ProbeApiIngestResponse = await evaluate(
      monitor,
      workerAnswer({ monitor, open: [], resolved: [] }),
    );

    expect(response.criteriaMetId).toBeUndefined();
    expect(absenceResolutionIsOff()).toBe(true);

    // And the breaching set is withheld, so nothing reads as "no longer breaching".
    for (const call of [
      ...checkOpenAlerts.mock.calls,
      ...checkOpenIncidents.mock.calls,
    ]) {
      expect(
        (call[0] as { breachingSeriesFingerprints?: unknown })
          .breachingSeriesFingerprints,
      ).toBeUndefined();
    }

    expect(resolveAlerts).not.toHaveBeenCalled();
    expect(resolveIncidents).not.toHaveBeenCalled();
  });

  test("an interface an 'up' has arrived for is resolved, by fingerprint, with the reason", async () => {
    const monitor: Monitor = interfaceMonitor(true);
    const recovered: LogMonitorGroupResult = group("sw1", "Gi0/1", 0);

    await evaluate(
      monitor,
      workerAnswer({ monitor, open: [], resolved: [recovered] }),
    );

    expect(resolveAlerts).toHaveBeenCalledTimes(1);
    expect(resolveAlerts.mock.calls[0]![0]).toMatchObject({
      monitor: monitor,
      fingerprints: [recovered.fingerprint],
      rootCause: LOG_GROUP_RESOLVED_ROOT_CAUSE,
      resolvedMessage: LOG_GROUP_ALERT_RESOLVED_MESSAGE,
    });

    expect(resolveIncidents).toHaveBeenCalledTimes(1);
    expect(resolveIncidents.mock.calls[0]![0]).toMatchObject({
      monitor: monitor,
      fingerprints: [recovered.fingerprint],
      rootCause: LOG_GROUP_RESOLVED_ROOT_CAUSE,
      resolvedMessage: LOG_GROUP_INCIDENT_RESOLVED_MESSAGE,
    });

    // Only alerts whose criteria asks to be resolved are: the dictionaries go along.
    expect(
      (
        resolveAlerts.mock.calls[0]![0] as {
          autoResolveCriteriaInstanceIdAlertIdsDictionary: JSONObject;
        }
      ).autoResolveCriteriaInstanceIdAlertIdsDictionary,
    ).toEqual({ down: ["alert-template"] });
  });

  test("one interface comes back while another is still down: the first is resolved, the second keeps its alert", async () => {
    const monitor: Monitor = interfaceMonitor(true);
    const stillDown: LogMonitorGroupResult = group("sw1", "Gi0/2", 2);
    const recovered: LogMonitorGroupResult = group("sw1", "Gi0/1", 0);

    const response: ProbeApiIngestResponse = await evaluate(
      monitor,
      workerAnswer({ monitor, open: [stillDown], resolved: [recovered] }),
    );

    expect(response.criteriaMetId).toBe("down");
    expect(alertedFingerprints()).toEqual([stillDown.fingerprint]);
    expect(
      (resolveAlerts.mock.calls[0]![0] as { fingerprints: Array<string> })
        .fingerprints,
    ).toEqual([recovered.fingerprint]);
    expect(absenceResolutionIsOff()).toBe(true);
  });

  test("a switch coming back resolves every one of its ports in one evaluation", async () => {
    const monitor: Monitor = interfaceMonitor(true);
    const ports: Array<LogMonitorGroupResult> = [];

    for (let port: number = 1; port <= 480; port++) {
      ports.push(group("core-sw1", `Gi1/0/${port}`, 0));
    }

    await evaluate(
      monitor,
      workerAnswer({ monitor, open: [], resolved: ports }),
    );

    expect(
      (resolveAlerts.mock.calls[0]![0] as { fingerprints: Array<string> })
        .fingerprints,
    ).toHaveLength(480);
  });

  test("a monitor that names no resolving log resolves a quiet group as it always has", async () => {
    const monitor: Monitor = interfaceMonitor(false);

    await evaluate(monitor, workerAnswer({ monitor, open: [] }));

    expect(absenceResolutionIsOff()).toBe(false);
    expect(resolveAlerts).not.toHaveBeenCalled();
    expect(resolveIncidents).not.toHaveBeenCalled();
  });

  test("...and while a group of it is breaching, the others are resolved by not being among the breaching", async () => {
    const monitor: Monitor = interfaceMonitor(false);
    const down: LogMonitorGroupResult = group("sw1", "Gi0/2", 2);

    await evaluate(monitor, workerAnswer({ monitor, open: [down] }));

    expect(absenceResolutionIsOff()).toBe(false);

    const breaching: Set<string> | undefined = (
      checkOpenAlerts.mock.calls[0]![0] as {
        breachingSeriesFingerprints?: Set<string>;
      }
    ).breachingSeriesFingerprints;

    expect(Array.from(breaching || [])).toEqual([down.fingerprint]);
  });
});
