import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals (the
 * PollSecurityEventConnectionsJob pattern): the `jest.Mock` annotations
 * must resolve to the same global namespace as jest.fn()/jest.mock().
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Meraki connections (issue #5140) are read by the worker: a cron every
 * minute queues the connections that are due, and each read runs as a job
 * of its own whose only data is the connection's id - never its key. The
 * REAL RunCron and JobDictionary run here; the queue, the scheduler and
 * the read runner under them are replaced so what the job hands them is
 * visible.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});
const mockEnqueueDue: jest.Mock = jest.fn();
const mockRun: jest.Mock = jest.fn();

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
    default: { addJob: mockAddJob },
  };
});

jest.mock(
  "Common/Server/Utils/NetworkController/NetworkControllerScheduler",
  () => {
    return {
      __esModule: true,
      NETWORK_CONTROLLER_READ_JOB: "NetworkControllerConnection:Read",
      NETWORK_CONTROLLER_READ_JOB_TIMEOUT_MS: 9 * 60 * 1000,
      default: { enqueueDueConnections: mockEnqueueDue },
    };
  },
);

jest.mock(
  "Common/Server/Utils/NetworkController/NetworkControllerReadRunner",
  () => {
    return { __esModule: true, default: { run: mockRun } };
  },
);

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

import ObjectID from "Common/Types/ObjectID";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import JobDictionary, {
  WorkerJobFunction,
} from "../../FeatureSet/Workers/Utils/JobDictionary";
import { runNetworkControllerRead } from "../../FeatureSet/Workers/Jobs/Network/ReadNetworkControllerConnections";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const READ_JOB: string = "NetworkControllerConnection:Read";
const CRON_JOB: string = "NetworkControllerConnection:ReadDueConnections";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

function job(data: Record<string, unknown>): QueueJob {
  return { data } as unknown as QueueJob;
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue({ status: "success" } as never);
  mockEnqueueDue.mockReset();
  mockEnqueueDue.mockResolvedValue(2 as never);
});

describe("Meraki connection jobs - wired into the worker", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      "utf-8",
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/Network/ReadNetworkControllerConnections")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("the cron is scheduled every minute, and the read job has its own timeout", () => {
    const cron: Array<unknown> | undefined = registrationAddJobCalls.find(
      (call: Array<unknown>) => {
        return call[2] === CRON_JOB;
      },
    );

    expect(cron).toBeDefined();
    expect(cron![0]).toBe("Worker");
    expect(cron![4]).toEqual({ scheduleAt: EVERY_MINUTE });
    expect(JobDictionary.getTimeoutInMs(READ_JOB)).toBe(9 * 60 * 1000);
    expect(JobDictionary.has(READ_JOB)).toBe(true);
  });

  test("the cron queues the due connections", async () => {
    const tick: WorkerJobFunction = JobDictionary.getJobFunction(CRON_JOB);

    await tick();

    expect(mockEnqueueDue).toHaveBeenCalledTimes(1);
    expect(mockEnqueueDue.mock.calls[0]![0]).toBeInstanceOf(Date);
  });
});

describe("Meraki connection jobs - one read", () => {
  test("reads the connection the job names", async () => {
    await JobDictionary.getJobFunction(READ_JOB)(
      job({ connectionId: CONNECTION }),
    );

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0]![0]).toEqual(new ObjectID(CONNECTION));
  });

  test.each([
    [{}],
    [{ connectionId: "" }],
    [{ connectionId: "../etc" }],
    [{ connectionId: 42 }],
    [{ apiKey: "0123456789abcdef0123456789abcdef01234567" }],
  ])(
    "a job without a valid connection id (%j) is refused",
    async (data: Record<string, unknown>) => {
      await expect(runNetworkControllerRead(job(data))).rejects.toThrow(
        "A valid network controller connection ID is required.",
      );
      expect(mockRun).not.toHaveBeenCalled();
    },
  );

  test("a read that fails outright fails the job", async () => {
    mockRun.mockRejectedValue(new Error("database is down") as never);

    await expect(
      runNetworkControllerRead(job({ connectionId: CONNECTION })),
    ).rejects.toThrow("database is down");
  });
});
