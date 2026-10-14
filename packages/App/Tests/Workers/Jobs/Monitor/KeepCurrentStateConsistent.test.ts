import { EVERY_DAY } from "Common/Utils/CronTime";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Monitor:KeepCurrentStateConsistent, the daily job that keeps every
 * monitor's status timeline whole:
 *
 *   - it closes the open rows two racing writers left behind, then reads the
 *     current status of each monitor it repaired again;
 *   - and it gives every monitor with no status timeline left its current
 *     status back as one row (MonitorStatusTimelineReconciler
 *     .restoreMissingStatusTimelines): the monitors OneUptime Cloud's old 120
 *     day purge emptied, whose status pages show them gray, and any whose
 *     first row was never written. It runs on startup too, so a deploy
 *     restores them at once.
 *
 * The two halves fail apart: one throwing never stops the other. A run that
 * restores anything warns, naming the monitors - at most 100 by id.
 */

type CronHandler = () => Promise<void>;

type CapturedJob = {
  options: { schedule: string; runOnStartup: boolean };
  run: CronHandler;
};

const mockCapturedJobs: Record<string, CapturedJob> = {};

const mockRepair: jest.Mock = jest.fn();
const mockRestore: jest.Mock = jest.fn();
const mockRefresh: jest.Mock = jest.fn();
const mockCalls: Array<string> = [];

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string; runOnStartup: boolean },
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options: options, run: runFunction };
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

jest.mock("Common/Server/Utils/Monitor/MonitorStatusTimelineReconciler", () => {
  return {
    __esModule: true,
    default: {
      repairStaleOpenRows: (...args: Array<unknown>): unknown => {
        mockCalls.push("repairStaleOpenRows");
        return mockRepair(...args);
      },
      restoreMissingStatusTimelines: (...args: Array<unknown>): unknown => {
        mockCalls.push("restoreMissingStatusTimelines");
        return mockRestore(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      refreshMonitorCurrentStatus: (...args: Array<unknown>): unknown => {
        mockCalls.push("refreshMonitorCurrentStatus");
        return mockRefresh(...args);
      },
    },
  };
});

/*
 * Imported AFTER the mocks above, and after the `mock*` bindings they close
 * over: TypeScript emits requires where the import sits.
 */
import "../../../../FeatureSet/Workers/Jobs/Monitor/KeepCurrentStateConsistent";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

const JOB_NAME: string = "Monitor:KeepCurrentStateConsistent";

function monitorIds(count: number): Array<ObjectID> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return new ObjectID(
      `4d000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
  });
}

function nothingToRepair(): unknown {
  return {
    scanned: 0,
    repaired: 0,
    monitorsWithStaleRows: 0,
    repairedMonitorIds: [],
    failedMonitorIds: [],
  };
}

async function runJob(): Promise<void> {
  const job: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

  expect(job).toBeDefined();

  await job!.run();
}

function warnings(): Array<string> {
  return (logger.warn as jest.Mock).mock.calls.map(
    (call: Array<unknown>): string => {
      return String(call[0]);
    },
  );
}

beforeEach(() => {
  mockRepair.mockReset();
  mockRestore.mockReset();
  mockRefresh.mockReset();
  mockCalls.length = 0;
  (logger.warn as jest.Mock).mockClear();
  (logger.error as jest.Mock).mockClear();

  mockRepair.mockResolvedValue(nothingToRepair());
  mockRestore.mockResolvedValue({ restored: 0, restoredMonitorIds: [] });
});

describe("Monitor:KeepCurrentStateConsistent", () => {
  test("runs every day, and on startup so a deploy restores emptied monitors at once", () => {
    expect(mockCapturedJobs[JOB_NAME]?.options).toEqual({
      schedule: EVERY_DAY,
      runOnStartup: true,
    });
  });

  test("repairs the open rows first, then restores the monitors with no status timeline", async () => {
    await runJob();

    expect(mockCalls).toEqual([
      "repairStaleOpenRows",
      "restoreMissingStatusTimelines",
    ]);
  });

  test("warns once it restored any monitor, naming them", async () => {
    mockRestore.mockResolvedValue({
      restored: 2,
      restoredMonitorIds: monitorIds(2),
    });

    await runJob();

    expect(warnings()).toEqual([
      `Monitor:KeepCurrentStateConsistent - restored the current status of 2 monitor(s) that had no status timeline left: ${monitorIds(
        2,
      )
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .join(", ")}.`,
    ]);
  });

  test("names at most 100 monitors by id, and counts the rest", async () => {
    mockRestore.mockResolvedValue({
      restored: 130,
      restoredMonitorIds: monitorIds(130),
    });

    await runJob();

    const warning: string = warnings()[0]!;

    expect(warning).toContain(monitorIds(100)[99]!.toString());
    expect(warning).not.toContain(monitorIds(101)[100]!.toString());
    expect(warning.endsWith(" and 30 more.")).toBe(true);
  });

  test("says nothing when no monitor needed restoring", async () => {
    await runJob();

    expect(warnings()).toEqual([]);
  });

  test("still restores when the repair of open rows fails", async () => {
    mockRepair.mockRejectedValue(new Error("repair failed"));

    await runJob();

    expect(mockCalls).toContain("restoreMissingStatusTimelines");
    expect(logger.error).toHaveBeenCalled();
  });

  test("a restore that fails is logged and ends the run quietly", async () => {
    mockRestore.mockRejectedValue(new Error("restore failed"));

    await expect(runJob()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Error in Monitor:KeepCurrentStateConsistent job while restoring the status of monitors with no status timeline",
    );
  });
});
