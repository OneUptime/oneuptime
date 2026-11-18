import { EVERY_HOUR } from "Common/Utils/CronTime";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";

/*
 * NetworkDeviceDiscovery:SyncDiscoveredDeviceInventory copies what the
 * Discovered Devices list knows about a device onto the monitored device it
 * is matched to (issue #9305) - its first run is the backfill of devices
 * imported before it. What it writes is DiscoveredDeviceInventorySync's (its
 * own suite). Pinned here: the job is wired into the worker, hourly, never on
 * startup, with room past the run's own budget for the last statement; it
 * runs the sync once a tick, says what it did only when it did something,
 * and a failure is logged rather than thrown at the queue.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number;
}

const mockCapturedJobs: Record<
  string,
  { options: CronOptions; run: CronHandler }
> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: CronOptions, runFunction: CronHandler) => {
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

const mockRun: jest.Mock = jest.fn();

jest.mock(
  "Common/Server/Utils/NetworkDevice/DiscoveredDeviceInventorySync",
  () => {
    return {
      __esModule: true,
      INVENTORY_SYNC_TIME_BUDGET_MS: 8 * 60 * 1000,
      default: {
        run: (...args: Array<unknown>) => {
          return mockRun(...args);
        },
      },
    };
  },
);

import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/SyncDiscoveredDeviceInventory";

const JOB_NAME: string = "NetworkDeviceDiscovery:SyncDiscoveredDeviceInventory";
const WORKERS_DIR: string = path.join(
  __dirname,
  "../../../../FeatureSet/Workers",
);

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

function summaryOf(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projects: 0,
    failedProjects: 0,
    updatedDevices: 0,
    isCutShort: false,
    ...fields,
  };
}

async function tick(): Promise<void> {
  const job: { run: CronHandler } | undefined = mockCapturedJobs[JOB_NAME];

  expect(job).toBeDefined();
  await job!.run();
}

beforeEach(() => {
  mockRun.mockReset();
  mockedLogger.info.mockReset();
  mockedLogger.error.mockReset();
});

describe("wired into the worker", () => {
  test("Workers/Index.ts imports the job file as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/NetworkDeviceDiscovery/SyncDiscoveredDeviceInventory")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("runs hourly, never at startup, with two minutes past the run's eight for the last statement", () => {
    expect(mockCapturedJobs[JOB_NAME]?.options).toEqual({
      schedule: EVERY_HOUR,
      runOnStartup: false,
      timeoutInMS: 10 * 60 * 1000,
    });
  });
});

describe("a tick", () => {
  test("runs the sync once, with its own budget", async () => {
    mockRun.mockResolvedValue(summaryOf());

    await tick();

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith();
  });

  test("with nothing updated and nothing failed, says nothing", async () => {
    mockRun.mockResolvedValue(summaryOf({ projects: 3 }));

    await tick();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("says how many devices it updated, across how many projects, and that the rest wait", async () => {
    mockRun.mockResolvedValue(
      summaryOf({
        projects: 4,
        failedProjects: 1,
        updatedDevices: 514,
        isCutShort: true,
      }),
    );

    await tick();

    expect(mockedLogger.info).toHaveBeenCalledWith(
      "Discovered devices: updated what 514 monitored devices know from the Discovered Devices list across 4 projects; 1 failed and are tried again next run; the rest wait for the next run.",
    );
  });

  test("a failure is logged, not thrown at the queue: the next hour tries again", async () => {
    const failure: Error = new Error("connection terminated");

    mockRun.mockRejectedValue(failure);

    await expect(tick()).resolves.toBeUndefined();
    expect(mockedLogger.error).toHaveBeenCalledWith(failure);
  });
});
