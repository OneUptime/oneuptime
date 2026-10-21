import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls.
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The two clocks of a packet capture, which no probe is there to run: every
 * minute, captures nobody will finish are failed with the reason (each
 * holds one of its probe's two slots until then); every hour, captures and
 * their files are deleted after the retention period. RunCron registers as
 * a module side effect, so the import in Workers/Index.ts is load-bearing.
 * The REAL RunCron and JobDictionary run here; the queue and the service
 * are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockFailStaleCaptures: jest.Mock = jest.fn();
const mockDeleteExpiredCaptures: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Services/PacketCaptureService", () => {
  return {
    __esModule: true,
    default: {
      failStaleCaptures: mockFailStaleCaptures,
      deleteExpiredCaptures: mockDeleteExpiredCaptures,
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
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/PacketCapture/SweepPacketCaptures";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

const STALE_JOB: string = "PacketCapture:FailStaleCaptures";
const RETENTION_JOB: string = "PacketCapture:DeleteExpiredCaptures";

const WORKERS_DIR: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers",
);

function registrationOf(jobName: string): Array<unknown> {
  const call: Array<unknown> | undefined = registrationAddJobCalls.find(
    (args: Array<unknown>): boolean => {
      return args[2] === jobName;
    },
  );

  expect(call).toBeDefined();

  return call as Array<unknown>;
}

beforeEach(() => {
  mockFailStaleCaptures.mockReset();
  mockDeleteExpiredCaptures.mockReset();
  mockedLogger.info.mockClear();
  mockedLogger.error.mockClear();
});

describe("wired into the worker", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toMatch(
      /^\s*import\s+["']\.\/Jobs\/PacketCapture\/SweepPacketCaptures["']\s*;?\s*$/m,
    );
  });

  test("the stale capture sweep runs every minute, the retention sweep every hour, neither on startup", () => {
    expect(JobDictionary.has(STALE_JOB)).toBe(true);
    expect(JobDictionary.has(RETENTION_JOB)).toBe(true);

    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(registrationOf(STALE_JOB)[0]).toBe("Worker");
    expect(registrationOf(STALE_JOB)[4]).toEqual({ scheduleAt: EVERY_MINUTE });
    expect(registrationOf(RETENTION_JOB)[0]).toBe("Worker");
    expect(registrationOf(RETENTION_JOB)[4]).toEqual({
      scheduleAt: EVERY_HOUR,
    });

    // One registration each: no extra run-on-startup job.
    expect(registrationAddJobCalls).toHaveLength(2);
  });
});

describe("what the jobs run", () => {
  test("the stale capture sweep fails what nobody will finish, and says how many", async () => {
    mockFailStaleCaptures.mockResolvedValue(3 as never);

    const job: PromiseVoidFunction = JobDictionary.getJobFunction(STALE_JOB);
    await job();

    expect(mockFailStaleCaptures).toHaveBeenCalledTimes(1);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      "PacketCapture: failed 3 stale capture(s).",
    );
  });

  test("a sweep with nothing to do says nothing", async () => {
    mockFailStaleCaptures.mockResolvedValue(0 as never);
    mockDeleteExpiredCaptures.mockResolvedValue(0 as never);

    await JobDictionary.getJobFunction(STALE_JOB)();
    await JobDictionary.getJobFunction(RETENTION_JOB)();

    expect(mockedLogger.info).not.toHaveBeenCalled();
  });

  test("the retention sweep deletes expired captures with their files, and says how many", async () => {
    mockDeleteExpiredCaptures.mockResolvedValue(12 as never);

    await JobDictionary.getJobFunction(RETENTION_JOB)();

    expect(mockDeleteExpiredCaptures).toHaveBeenCalledTimes(1);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      "PacketCapture: deleted 12 expired capture(s) and their files.",
    );
  });

  test("a sweep that fails is logged, and the job does not throw: the next run tries again", async () => {
    mockFailStaleCaptures.mockRejectedValue(new Error("db down") as never);
    mockDeleteExpiredCaptures.mockRejectedValue(new Error("db down") as never);

    await expect(
      JobDictionary.getJobFunction(STALE_JOB)(),
    ).resolves.toBeUndefined();
    await expect(
      JobDictionary.getJobFunction(RETENTION_JOB)(),
    ).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      "PacketCapture: the stale capture sweep failed.",
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      "PacketCapture: the retention sweep failed.",
    );
  });
});
