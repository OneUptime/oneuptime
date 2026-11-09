import { EVERY_HOUR } from "Common/Utils/CronTime";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";

/*
 * NetworkDeviceDiscovery:AgeOutDiscoveredDevices removes the discovered
 * devices nothing has seen for as long as their project keeps them (issue
 * #6389); what it removes, and how, is DiscoveredDeviceAgeOut's (its unit
 * and Postgres suites). Pinned here: the job is wired into the worker at
 * all, hourly, never on startup, with room past the runner's own budget for
 * the last statement to finish; it runs the age-out once a tick, says what
 * it did only when it did something, and a failure is logged rather than
 * thrown at the queue.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to capture the handler and its options - the
 * recorder the other App/Tests/Workers/Jobs suites use.
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

jest.mock("Common/Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut", () => {
  return {
    __esModule: true,
    AGE_OUT_TIME_BUDGET_MS: 8 * 60 * 1000,
    default: {
      run: (...args: Array<unknown>) => {
        return mockRun(...args);
      },
    },
  };
});

import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/AgeOutDiscoveredDevices";

const JOB_NAME: string = "NetworkDeviceDiscovery:AgeOutDiscoveredDevices";
const WORKERS_DIR: string = path.join(
  __dirname,
  "../../../../FeatureSet/Workers",
);

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

function summaryOf(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projects: 0,
    failedProjects: 0,
    removed: 0,
    unhidden: 0,
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

    expect(
      fs.existsSync(
        path.join(
          WORKERS_DIR,
          "Jobs",
          "NetworkDeviceDiscovery",
          "AgeOutDiscoveredDevices.ts",
        ),
      ),
    ).toBe(true);
    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/NetworkDeviceDiscovery/AgeOutDiscoveredDevices")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("runs hourly, never at startup, with two minutes past the runner's eight for the last statement", () => {
    expect(mockCapturedJobs[JOB_NAME]?.options).toEqual({
      schedule: EVERY_HOUR,
      runOnStartup: false,
      timeoutInMS: 10 * 60 * 1000,
    });
  });
});

describe("a tick", () => {
  test("runs the age-out once, with its own budget", async () => {
    mockRun.mockResolvedValue(summaryOf());

    await tick();

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith();
  });

  test("with nothing removed and nothing failed, says nothing", async () => {
    mockRun.mockResolvedValue(summaryOf({ projects: 3 }));

    await tick();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("says how many devices it removed, with their map preferences, across how many projects", async () => {
    mockRun.mockResolvedValue(
      summaryOf({ projects: 2, removed: 140, unhidden: 3 }),
    );

    await tick();

    expect(mockedLogger.info).toHaveBeenCalledWith(
      "Discovered devices: removed 140 not seen for their project's retention (3 Hide from map preferences with them) across 2 projects.",
    );
  });

  test("says which projects failed and that the rest wait, when they did", async () => {
    mockRun.mockResolvedValue(
      summaryOf({
        projects: 5,
        failedProjects: 1,
        removed: 20000,
        isCutShort: true,
      }),
    );

    await tick();

    expect(mockedLogger.info).toHaveBeenCalledWith(
      "Discovered devices: removed 20000 not seen for their project's retention (0 Hide from map preferences with them) across 5 projects; 1 failed and are tried again next run; the rest wait for the next run.",
    );
  });

  test("a failure is logged, not thrown at the queue: the next hour tries again", async () => {
    const failure: Error = new Error("connection terminated");

    mockRun.mockRejectedValue(failure);

    await expect(tick()).resolves.toBeUndefined();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      "Discovered devices: removing the devices no longer seen failed.",
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(failure);
  });
});
