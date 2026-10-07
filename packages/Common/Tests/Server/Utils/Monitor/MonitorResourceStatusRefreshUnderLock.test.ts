/*
 * monitorResource decides status changes against the monitor's status as it
 * stands once the per-monitor lock is held - not as it stood when the
 * monitor was loaded, just before waiting for that lock.
 *
 * The 2026-10-04 incident, second half: the heartbeat cron flipped a monitor
 * Offline while a heartbeat for it was already being processed. The
 * heartbeat's evaluation had loaded the monitor (status: Online) BEFORE the
 * cron's change and then waited on the lock the cron held. It matched the
 * "heartbeat received" criteria (target: Online); the status timeline's
 * fast path compared that with the stale Online, concluded nothing had
 * changed and wrote nothing - so the monitor stayed Offline for another 27
 * seconds, until the next cron tick. A sibling monitor whose heartbeat
 * loaded after the cron's change recovered in half a second.
 *
 * The evaluator, the per-monitor lock, the monitor reads and the timeline
 * writes are stubbed at their edges; monitorResource and the status
 * timeline decision (MonitorStatusTimelineUtil) run for real, and what they
 * decide is read off MonitorStatusTimelineService.create.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorStatusTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
    },
    MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE:
      "Monitor status is same as previous status.",
    MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE:
      "Could not acquire the monitor status timeline lock.",
  };
});

jest.mock("../../../../Server/Services/MonitorStatusService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import OneUptimeDate from "../../../../Types/Date";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const ONLINE: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-000000000001");
const OFFLINE: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-000000000002");

const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const lastTimelineRow: jest.Mock =
  MonitorStatusTimelineService.findOneBy as unknown as jest.Mock;
const createTimelineRow: jest.Mock =
  MonitorStatusTimelineService.create as unknown as jest.Mock;
const statusName: jest.Mock =
  MonitorStatusService.findOneBy as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

function criteria(name: string, statusId: ObjectID): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = name;
  instance.data!.changeMonitorStatus = true;
  instance.data!.monitorStatusId = statusId;
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [];
  instance.data!.alerts = [];
  return instance;
}

const RECEIVED: MonitorCriteriaInstance = criteria(
  "Component heartbeat received",
  ONLINE,
);
const MISSING: MonitorCriteriaInstance = criteria(
  "Component heartbeat missing",
  OFFLINE,
);

function heartbeatMonitor(data: {
  loadedStatus: ObjectID;
  defaultStatus?: ObjectID | undefined;
}): Monitor {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [RECEIVED, MISSING],
  };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: data.defaultStatus,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
  monitor.projectId = new ObjectID("cccccccc-0000-4000-8000-000000000001");
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.name = "Connector sync scheduler";
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = data.loadedStatus;
  return monitor;
}

function heartbeat(monitor: Monitor): IncomingMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    requestHeaders: {},
    requestBody: {},
    incomingRequestReceivedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
    checkedAt: now,
  };
}

/*
 * Two reads of the monitor: the full load before the lock, and the status
 * re-read under it. statusUnderLock is what the second one finds - the
 * status the evaluation that held the lock left behind.
 */
function serveMonitorReads(data: {
  monitor: Monitor;
  statusUnderLock: ObjectID | null;
}): void {
  findOneById.mockImplementation(((args: {
    select: Record<string, unknown>;
  }) => {
    const selectedColumns: Array<string> = Object.keys(args.select);

    if (
      selectedColumns.length === 1 &&
      selectedColumns[0] === "currentMonitorStatusId"
    ) {
      if (!data.statusUnderLock) {
        return Promise.resolve(null);
      }

      const fresh: Monitor = new Monitor();
      fresh.currentMonitorStatusId = data.statusUnderLock;
      return Promise.resolve(fresh);
    }

    return Promise.resolve(data.monitor);
  }) as any);
}

function evaluationMatches(matched: MonitorCriteriaInstance | null): void {
  processMonitorStep.mockImplementation(((input: {
    probeApiIngestResponse: ProbeApiIngestResponse;
  }) => {
    return Promise.resolve({
      ...input.probeApiIngestResponse,
      criteriaMetId: matched ? matched.data!.id : undefined,
      rootCause: matched
        ? "Incoming request / heartbeat received in 5 minutes."
        : null,
    });
  }) as any);
}

function timelineRowWithStatus(statusId: ObjectID): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row.id = ObjectID.generate();
  row.monitorStatusId = statusId;
  return row;
}

function writtenStatuses(): Array<string> {
  return createTimelineRow.mock.calls.map((call: Array<unknown>) => {
    return (
      (
        call[0] as { data: MonitorStatusTimeline }
      ).data.monitorStatusId?.toString() || ""
    );
  });
}

describe("MonitorResourceUtil.monitorResource decides status under the per-monitor lock", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    lock.mockResolvedValue({ isAcquired: true } as never);

    statusName.mockResolvedValue({ name: "Operational" } as never);

    createTimelineRow.mockImplementation(((args: {
      data: MonitorStatusTimeline;
    }) => {
      return Promise.resolve(args.data);
    }) as any);

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true as never);
    jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    jest
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a heartbeat evaluated right after the cron flipped the monitor Offline writes it back to Online", async () => {
    // Loaded while still Online; by the time the lock is free it is Offline.
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: ONLINE });
    serveMonitorReads({ monitor, statusUnderLock: OFFLINE });
    lastTimelineRow.mockResolvedValue(timelineRowWithStatus(OFFLINE) as never);
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(writtenStatuses()).toEqual([ONLINE.toString()]);
  });

  test("the status is re-read only once the lock is held, and only that one column", async () => {
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: ONLINE });
    serveMonitorReads({ monitor, statusUnderLock: OFFLINE });
    lastTimelineRow.mockResolvedValue(timelineRowWithStatus(OFFLINE) as never);
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(findOneById).toHaveBeenCalledTimes(2);

    const loadOrder: number = findOneById.mock.invocationCallOrder[0]!;
    const lockOrder: number = lock.mock.invocationCallOrder[0]!;
    const refreshOrder: number = findOneById.mock.invocationCallOrder[1]!;

    expect(loadOrder).toBeLessThan(lockOrder);
    expect(lockOrder).toBeLessThan(refreshOrder);

    const refresh: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findOneById.mock.calls[1]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(refresh.id.toString()).toBe(monitor.id!.toString());
    expect(refresh.select).toEqual({ currentMonitorStatusId: true });
    expect(refresh.props).toEqual({ isRoot: true });
  });

  /*
   * The steady state must stay as cheap as it was: a healthy heartbeat on a
   * monitor that is already Online still takes the status timeline's fast
   * path and reads no timeline row at all.
   */
  test("with no concurrent change, a healthy heartbeat still writes nothing and reads no timeline", async () => {
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: ONLINE });
    serveMonitorReads({ monitor, statusUnderLock: ONLINE });
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(createTimelineRow).not.toHaveBeenCalled();
    expect(lastTimelineRow).not.toHaveBeenCalled();
  });

  test("the opposite race: a check that saw a stale Offline still records Offline once another evaluation brought it back Online", async () => {
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: OFFLINE });
    serveMonitorReads({ monitor, statusUnderLock: ONLINE });
    lastTimelineRow.mockResolvedValue(timelineRowWithStatus(ONLINE) as never);
    evaluationMatches(MISSING);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(writtenStatuses()).toEqual([OFFLINE.toString()]);
  });

  /*
   * The revert-to-default branch keys on the same column: a stale "already
   * at default" skipped the revert entirely.
   */
  test("no criteria met: reverts to the default status when the status under the lock is not the default", async () => {
    const monitor: Monitor = heartbeatMonitor({
      loadedStatus: ONLINE,
      defaultStatus: ONLINE,
    });
    serveMonitorReads({ monitor, statusUnderLock: OFFLINE });
    lastTimelineRow.mockResolvedValue(timelineRowWithStatus(OFFLINE) as never);
    evaluationMatches(null);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(writtenStatuses()).toEqual([ONLINE.toString()]);
  });

  test("a status re-read that finds nothing keeps the status the monitor was loaded with", async () => {
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: ONLINE });
    serveMonitorReads({ monitor, statusUnderLock: null });
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(monitor.currentMonitorStatusId?.toString()).toBe(ONLINE.toString());
    expect(createTimelineRow).not.toHaveBeenCalled();
  });

  test("when the lock cannot be taken nothing is re-read or evaluated", async () => {
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: ONLINE });
    serveMonitorReads({ monitor, statusUnderLock: OFFLINE });
    lock.mockRejectedValue(new Error("lock timeout") as never);
    evaluationMatches(RECEIVED);

    await expect(
      MonitorResourceUtil.monitorResource(heartbeat(monitor)),
    ).rejects.toThrow("lock timeout");

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(processMonitorStep).not.toHaveBeenCalled();
    expect(createTimelineRow).not.toHaveBeenCalled();
  });

  test("the lock is released even when the status re-read fails", async () => {
    const monitor: Monitor = heartbeatMonitor({ loadedStatus: ONLINE });
    let reads: number = 0;
    findOneById.mockImplementation((() => {
      reads++;
      return reads === 1
        ? Promise.resolve(monitor)
        : Promise.reject(new Error("connection reset"));
    }) as any);
    evaluationMatches(RECEIVED);

    await expect(
      MonitorResourceUtil.monitorResource(heartbeat(monitor)),
    ).rejects.toThrow("connection reset");

    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    expect(processMonitorStep).not.toHaveBeenCalled();
  });
});
