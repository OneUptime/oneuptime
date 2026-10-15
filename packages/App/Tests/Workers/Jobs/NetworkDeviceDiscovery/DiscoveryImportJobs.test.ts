import { QueueJob } from "Common/Server/Infrastructure/Queue";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls.
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The two worker jobs of a discovery import (issue #4812). One runs a
 * project's imports when the Dashboard asks for one, from the queue - so an
 * import goes on when the dialog is closed or the page is left. The other
 * is the backstop: every minute it picks up an import whose worker died
 * mid-way, where it stopped. Both register as module side effects, so the
 * imports in Workers/Index.ts are load-bearing. The REAL RunCron and
 * JobDictionary run here; the queue and the runner are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockRunProjectImports: jest.Mock = jest.fn();
const mockSweep: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: mockAddJob,
    },
  };
});

jest.mock("Common/Server/Utils/NetworkDiscovery/DiscoveryImportRunner", () => {
  return {
    __esModule: true,
    DISCOVERY_IMPORT_JOB: "NetworkDeviceDiscovery:RunDiscoveryImports",
    DISCOVERY_IMPORT_JOB_TIMEOUT_MS: 60 * 60 * 1000,
    default: {
      runProjectImports: mockRunProjectImports,
      sweep: mockSweep,
    },
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

// Imported AFTER the mocks: the jobs register themselves when imported.
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import { runDiscoveryImports } from "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/RunDiscoveryImports";
import "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/SweepDiscoveryImports";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const RUN_JOB: string = "NetworkDeviceDiscovery:RunDiscoveryImports";
const SWEEP_JOB: string = "NetworkDeviceDiscovery:SweepDiscoveryImports";
const PROJECT_ID: string = "5d8f2a6c-3b1e-4f7a-9c2d-8e6b4a1f0c3d";

const WORKERS_DIR: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers",
);

// The two import lines of Workers/Index.ts, each on a line of its own.
const RUN_JOB_IMPORT_LINE: RegExp =
  /^\s*import\s+["']\.\/Jobs\/NetworkDeviceDiscovery\/RunDiscoveryImports["']\s*;?\s*$/m;
const SWEEP_JOB_IMPORT_LINE: RegExp =
  /^\s*import\s+["']\.\/Jobs\/NetworkDeviceDiscovery\/SweepDiscoveryImports["']\s*;?\s*$/m;

beforeEach(() => {
  mockRunProjectImports.mockReset();
  mockSweep.mockReset();
  mockedLogger.error.mockClear();
});

describe("wired into the worker", () => {
  test.each([
    ["RunDiscoveryImports", RUN_JOB_IMPORT_LINE],
    ["SweepDiscoveryImports", SWEEP_JOB_IMPORT_LINE],
  ])(
    "Workers/Index.ts imports %s as a top-level side effect",
    (_name: string, importLine: RegExp) => {
      const indexSource: string = fs.readFileSync(
        path.join(WORKERS_DIR, "Index.ts"),
        { encoding: "utf-8" },
      );

      expect(indexSource).toMatch(importLine);
    },
  );

  test("the import job is a queue job with the import's own timeout, not a cron", () => {
    expect(JobDictionary.getJobFunction(RUN_JOB)).toBe(runDiscoveryImports);
    expect(JobDictionary.getTimeoutInMs(RUN_JOB)).toBe(60 * 60 * 1000);

    // Never scheduled: it runs when an import is asked for.
    expect(
      registrationAddJobCalls.some((call: Array<unknown>): boolean => {
        return call[2] === RUN_JOB;
      }),
    ).toBe(false);
  });

  test("the sweep runs every minute, and not on startup", () => {
    expect(JobDictionary.has(SWEEP_JOB)).toBe(true);

    // Queue.addJob(queueName, jobId, jobName, data, options)
    const registrations: Array<Array<unknown>> = registrationAddJobCalls.filter(
      (call: Array<unknown>): boolean => {
        return call[2] === SWEEP_JOB;
      },
    );

    expect(registrations).toHaveLength(1);
    expect(registrations[0]![0]).toBe("Worker");
    expect(registrations[0]![4]).toEqual({ scheduleAt: EVERY_MINUTE });
  });
});

describe("what the import job runs", () => {
  test("the project's imports, by the project id the job carries", async () => {
    mockRunProjectImports.mockResolvedValue(undefined as never);

    await JobDictionary.getJobFunction(RUN_JOB)({
      data: { projectId: PROJECT_ID },
    } as QueueJob);

    expect(mockRunProjectImports).toHaveBeenCalledTimes(1);
    expect(mockRunProjectImports).toHaveBeenCalledWith(
      new ObjectID(PROJECT_ID),
    );
  });

  test.each([
    [undefined],
    [{}],
    [{ projectId: "" }],
    [{ projectId: "not-a-project" }],
    [{ projectId: 12 }],
  ])(
    "a job without a project id (%j) is refused before anything runs",
    async (data: unknown) => {
      await expect(
        runDiscoveryImports(data ? ({ data } as QueueJob) : undefined),
      ).rejects.toThrow(BadDataException);

      expect(mockRunProjectImports).not.toHaveBeenCalled();
    },
  );

  test("a failure is the job's, so the queue records it", async () => {
    mockRunProjectImports.mockRejectedValue(new Error("db down") as never);

    await expect(
      runDiscoveryImports({ data: { projectId: PROJECT_ID } } as QueueJob),
    ).rejects.toThrow("db down");
  });
});

describe("what the sweep runs", () => {
  test("the runner's sweep of stalled imports", async () => {
    mockSweep.mockResolvedValue(undefined as never);

    await JobDictionary.getJobFunction(SWEEP_JOB)();

    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a sweep that fails is logged, and the job does not throw: the next minute tries again", async () => {
    mockSweep.mockRejectedValue(new Error("db down") as never);

    await expect(
      JobDictionary.getJobFunction(SWEEP_JOB)(),
    ).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      "Discovery import: the sweep of stalled imports failed.",
    );
  });
});
