import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";

/*
 * ProbeStatusMonitor:CheckProbeStatus - the minute sweep that keeps every
 * Probe Status monitor right whatever happened between probe flips: a
 * monitor just created or edited, a probe deleted, an evaluation that
 * failed, a probe getting its first status. These tests pin that it runs
 * every minute, reads exactly the monitors it should (enabled, Probe Status,
 * of active projects), hands each to the evaluator, pages through all of
 * them, and that one monitor failing never stops the rest.
 *
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler, and each test
 * drives one tick. The evaluator is mocked whole: its own suite covers it,
 * and the real one loads the monitor pipeline.
 */

type CronHandler = () => Promise<void>;

interface CronRegistration {
  options: { schedule: string; runOnStartup: boolean };
  handler: CronHandler;
}

const mockRegistrations: Record<string, CronRegistration> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string; runOnStartup: boolean },
        handler: CronHandler,
      ): void => {
        mockRegistrations[jobName] = { options: options, handler: handler };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const mockLock: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    SemaphoreLockTimeoutError: class SemaphoreLockTimeoutError extends Error {},
    default: {
      lock: (...args: Array<unknown>) => {
        return mockLock(...args);
      },
      release: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getActiveProjectStatusQuery: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Monitor/ProbeStatusMonitorEvaluator", () => {
  return {
    __esModule: true,
    default: {
      MONITOR_SELECT: {
        _id: true,
        projectId: true,
        monitorType: true,
        monitorSteps: true,
      },
      evaluateMonitor: jest.fn(),
    },
  };
});

import { SemaphoreLockTimeoutError } from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import ProbeStatusMonitorEvaluator from "Common/Server/Utils/Monitor/ProbeStatusMonitorEvaluator";
import { MONITOR_SWEEP_BATCH_SIZE } from "../../../../FeatureSet/Workers/Utils/MonitorSweep";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/ProbeStatusMonitor/CheckProbeStatus";

const JOB_NAME: string = "ProbeStatusMonitor:CheckProbeStatus";

const monitorService: { findBy: jest.Mock; getEnabledMonitorQuery: jest.Mock } =
  MonitorService as unknown as {
    findBy: jest.Mock;
    getEnabledMonitorQuery: jest.Mock;
  };
const projectService: { getActiveProjectStatusQuery: jest.Mock } =
  ProjectService as unknown as { getActiveProjectStatusQuery: jest.Mock };
const evaluateMonitor: jest.Mock =
  ProbeStatusMonitorEvaluator.evaluateMonitor as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

// Sentinels for the gates the job spreads into its query.
const ENABLED_MONITOR_QUERY: Record<string, unknown> = {
  disableActiveMonitoring: false,
};
const ACTIVE_PROJECT_QUERY: Record<string, unknown> = {
  markedForDeletion: false,
};

function monitorNumber(index: number): Monitor {
  const monitor: Monitor = new Monitor(
    new ObjectID(`76000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
  );
  monitor.monitorType = MonitorType.ProbeStatus;
  return monitor;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  props: Record<string, unknown>;
}

function findByCall(index: number): FindByArgs {
  return monitorService.findBy.mock.calls[index]![0] as FindByArgs;
}

async function runTick(): Promise<void> {
  const registration: CronRegistration | undefined =
    mockRegistrations[JOB_NAME];

  if (!registration) {
    throw new Error(`${JOB_NAME} did not register a cron handler.`);
  }

  await registration.handler();
}

function evaluatedIds(): Array<string> {
  return evaluateMonitor.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as Monitor).id!.toString();
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  mockLock.mockResolvedValue({ isAcquired: true });
  monitorService.findBy.mockResolvedValue([]);
  monitorService.getEnabledMonitorQuery.mockReturnValue(ENABLED_MONITOR_QUERY);
  projectService.getActiveProjectStatusQuery.mockReturnValue(
    ACTIVE_PROJECT_QUERY,
  );
  evaluateMonitor.mockResolvedValue(undefined);
});

describe("ProbeStatusMonitor:CheckProbeStatus", () => {
  test("runs every minute, from the first minute after start, not at start", () => {
    expect(mockRegistrations[JOB_NAME]?.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("the worker loads it: Workers/Index.ts imports the job", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      { encoding: "utf-8" },
    );

    expect(
      index
        .split("\n")
        .map((line: string): string => {
          return line.trim();
        })
        .includes('import "./Jobs/ProbeStatusMonitor/CheckProbeStatus";'),
    ).toBe(true);
  });

  test("reads the enabled Probe Status monitors of active projects, as the evaluator needs them", async () => {
    await runTick();

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);

    const call: FindByArgs = findByCall(0);

    expect(call.query).toEqual({
      ...ENABLED_MONITOR_QUERY,
      monitorType: MonitorType.ProbeStatus,
      project: ACTIVE_PROJECT_QUERY,
    });
    expect(call.select).toEqual({
      ...ProbeStatusMonitorEvaluator.MONITOR_SELECT,
      _id: true,
    });
    expect(call.sort).toEqual({ _id: SortOrder.Ascending });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("hands every monitor it read to the evaluator, once", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      monitorNumber(1),
      monitorNumber(2),
      monitorNumber(3),
    ]);

    await runTick();

    expect(evaluatedIds().sort()).toEqual(
      [monitorNumber(1), monitorNumber(2), monitorNumber(3)]
        .map((monitor: Monitor): string => {
          return monitor.id!.toString();
        })
        .sort(),
    );
  });

  test("pages through every monitor by id, so none is skipped however many there are", async () => {
    const firstPage: Array<Monitor> = Array.from(
      { length: MONITOR_SWEEP_BATCH_SIZE },
      (_: unknown, index: number): Monitor => {
        return monitorNumber(index + 1);
      },
    );

    monitorService.findBy
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([monitorNumber(MONITOR_SWEEP_BATCH_SIZE + 1)]);

    await runTick();

    expect(monitorService.findBy).toHaveBeenCalledTimes(2);
    /*
     * The second page starts after the last monitor of the first: an
     * "id greater than" whose one parameter is that monitor's id.
     */
    const cursor: { objectLiteralParameters?: Record<string, unknown> } =
      findByCall(1).query["_id"] as {
        objectLiteralParameters?: Record<string, unknown>;
      };
    expect(Object.values(cursor.objectLiteralParameters || {})).toEqual([
      firstPage[firstPage.length - 1]!.id!.toString(),
    ]);
    expect(findByCall(0).query["_id"]).toBeUndefined();
    expect(evaluateMonitor).toHaveBeenCalledTimes(MONITOR_SWEEP_BATCH_SIZE + 1);
  });

  test("one monitor failing is logged, and the rest are still evaluated", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      monitorNumber(1),
      monitorNumber(2),
      monitorNumber(3),
    ]);
    evaluateMonitor.mockImplementation(async (monitor: Monitor) => {
      if (monitor.id!.toString() === monitorNumber(2).id!.toString()) {
        throw new Error("monitor is being evaluated by another worker");
      }
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(evaluateMonitor).toHaveBeenCalledTimes(3);
    expect(
      mockedLogger.error.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          typeof call[0] === "string" &&
          call[0].includes(JOB_NAME) &&
          call[0].includes(monitorNumber(2).id!.toString())
        );
      }),
    ).toBe(true);
  });

  test("a tick that finds another sweep still running leaves it alone", async () => {
    mockLock.mockRejectedValue(new SemaphoreLockTimeoutError("locked"));

    await runTick();

    expect(monitorService.findBy).not.toHaveBeenCalled();
    expect(evaluateMonitor).not.toHaveBeenCalled();
  });
});
