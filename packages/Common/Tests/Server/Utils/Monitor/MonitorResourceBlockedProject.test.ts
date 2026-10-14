/*
 * A result for a monitor of a project a master admin blocked opens nothing
 * and changes nothing: monitorResource answers it as evaluated-to-nothing,
 * before the per-monitor lock is taken or any criteria are read. Its
 * monitors are no longer handed to probes or swept
 * (getActiveProjectStatusQuery); this is for the results that still arrive
 * - a probe that claimed just before the block, a heartbeat or an email its
 * sender keeps sending, a trap. Returned, not thrown: an outside sender
 * keeps sending, and each would otherwise be a failed job.
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
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
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
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import ProjectService from "../../../../Server/Services/ProjectService";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const MONITOR_ID: ObjectID = new ObjectID(
  "b4000000-0000-4000-8000-000000000001",
);
const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b4000000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b4000000-0000-4000-8000-0000000000a1",
);

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

function monitorIn(
  projectId: ObjectID,
  values: Partial<Monitor> = {},
): Monitor {
  const row: Monitor = new Monitor();
  row.id = MONITOR_ID;
  row._id = MONITOR_ID.toString();
  row.projectId = projectId;
  row.monitorType = MonitorType.Website;
  Object.assign(row, values);
  return row;
}

function probeResult(): ProbeMonitorResponse {
  return {
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: false,
    monitoredAt: new Date(),
  } as unknown as ProbeMonitorResponse;
}

let isProjectBlocked: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();

  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a result for a monitor of a blocked project", () => {
  test("opens nothing and changes nothing: no lock, no criteria", async () => {
    findOneById.mockResolvedValue(monitorIn(BLOCKED_PROJECT_ID) as never);

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(probeResult());

    expect(response.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(response.criteriaMetId).toBeUndefined();
    expect(response.rootCause).toBeNull();
    expect(lock).not.toHaveBeenCalled();
    expect(processMonitorStep).not.toHaveBeenCalled();
    expect(isProjectBlocked).toHaveBeenCalledWith(BLOCKED_PROJECT_ID);
  });

  test("a paused monitor keeps its own answer, asked first", async () => {
    findOneById.mockResolvedValue(
      monitorIn(BLOCKED_PROJECT_ID, { isArchived: true }) as never,
    );

    await expect(
      MonitorResourceUtil.monitorResource(probeResult()),
    ).rejects.toThrow(ExceptionMessages.MonitorArchived);

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("a lookup that fails fails the job, to be tried again, before the lock", async () => {
    isProjectBlocked.mockRejectedValue(new Error("database unavailable"));
    findOneById.mockResolvedValue(monitorIn(LIVE_PROJECT_ID) as never);

    await expect(
      MonitorResourceUtil.monitorResource(probeResult()),
    ).rejects.toThrow("database unavailable");

    expect(lock).not.toHaveBeenCalled();
  });
});

describe("a result for a monitor of a project that is not blocked", () => {
  test("goes on to the per-monitor lock as before", async () => {
    findOneById.mockResolvedValue(monitorIn(LIVE_PROJECT_ID) as never);
    // Stops the evaluation at the lock: past the gate is all this asks.
    lock.mockRejectedValue(new Error("reached the lock") as never);

    await expect(
      MonitorResourceUtil.monitorResource(probeResult()),
    ).rejects.toThrow("reached the lock");

    expect(isProjectBlocked).toHaveBeenCalledWith(LIVE_PROJECT_ID);
  });
});
