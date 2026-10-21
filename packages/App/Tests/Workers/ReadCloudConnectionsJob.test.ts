import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * Cloud connections are READ AT ALL, and read the way the worker needs.
 *
 * RunCron and JobDictionary register by module side effect, so the single
 * line `import "./Jobs/Cloud/ReadCloudConnections"` in
 * App/FeatureSet/Workers/Index.ts is what makes every cloud connection read:
 * without it each one sits "Waiting for the first read" forever while every
 * connector test stays green. So the index is read as text, the real RunCron
 * and the real JobDictionary run, and only what lies under them is replaced:
 * the queue, the scheduler, the read itself and the metrics ingest.
 *
 * And what a read imports goes through the same metrics ingest a collector
 * sends to, with the connection's project - never one of its own.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined);
const mockEnqueueDueConnections: jest.Mock = jest.fn();
const mockRun: jest.Mock = jest.fn();
const mockProcessMetrics: jest.Mock = jest.fn();

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

jest.mock(
  "Common/Server/Utils/CloudConnection/CloudConnectionScheduler",
  () => {
    return {
      __esModule: true,
      // The real values, which the test below holds to the scheduler's source.
      CLOUD_CONNECTION_PULL_JOB: "CloudConnection:Read",
      CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS: 9 * 60 * 1000,
      default: {
        enqueueDueConnections: mockEnqueueDueConnections,
      },
    };
  },
);

jest.mock(
  "Common/Server/Utils/CloudConnection/CloudConnectionPullRunner",
  () => {
    return {
      __esModule: true,
      default: {
        run: mockRun,
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService",
  () => {
    return {
      __esModule: true,
      default: {
        processMetricsFromQueue: mockProcessMetrics,
      },
    };
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

import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import {
  importCloudMetrics,
  runCloudConnectionRead,
} from "../../FeatureSet/Workers/Jobs/Cloud/ReadCloudConnections";

// Frozen once the module graph settled: registration happens at import.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const CRON_NAME: string = "CloudConnection:ReadDueConnections";
const READ_JOB: string = "CloudConnection:Read";
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");
const SCHEDULER_SOURCE: string = path.resolve(
  __dirname,
  "../../../Common/Server/Utils/CloudConnection/CloudConnectionScheduler.ts",
);

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, { encoding: "utf-8" });
}

beforeEach(() => {
  mockEnqueueDueConnections.mockReset();
  mockEnqueueDueConnections.mockResolvedValue(2);
  mockRun.mockReset();
  mockRun.mockResolvedValue({ status: "success" });
  mockProcessMetrics.mockReset();
  mockProcessMetrics.mockResolvedValue(undefined);
});

describe("ReadCloudConnections - wired into the worker", () => {
  test("Workers/Index.ts imports the job module, above the queue-workers gate", () => {
    const index: string = readSource(path.join(WORKERS_DIR, "Index.ts"));
    const specifier: string = "./Jobs/Cloud/ReadCloudConnections";

    expect(
      fs.existsSync(
        path.join(WORKERS_DIR, "Jobs/Cloud/ReadCloudConnections.ts"),
      ),
    ).toBe(true);
    expect(index).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp(specifier)}["']\\s*;?\\s*$`,
        "m",
      ),
    );

    const gate: RegExpMatchArray | null = index.match(
      /if\s*\(\s*DisableQueueWorkers\s*\)/,
    );

    expect(gate).not.toBeNull();
    expect(index.indexOf(`import "${specifier}"`)).toBeLessThan(
      gate!.index as number,
    );
  });

  test("the job names and the read's timeout are the scheduler's", () => {
    const source: string = readSource(SCHEDULER_SOURCE);

    expect(source).toContain(
      `export const CLOUD_CONNECTION_PULL_JOB: string = "${READ_JOB}";`,
    );
    expect(source).toContain(
      "export const CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS: number = 9 * 60 * 1000;",
    );
  });
});

describe("ReadCloudConnections - registration", () => {
  test("registering logged no error", () => {
    expect(
      (logger as unknown as { error: jest.Mock }).error,
    ).not.toHaveBeenCalled();
  });

  test("schedules the sweep once, every minute, and never on startup", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    expect(call[0]).toBe("Worker");
    expect(call[2]).toBe(CRON_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_MINUTE });
  });

  test("each read is a job of its own, with the read's timeout", () => {
    expect(typeof JobDictionary.getJobFunction(READ_JOB)).toBe("function");
    expect(JobDictionary.getTimeoutInMs(READ_JOB)).toBe(9 * 60 * 1000);
    // A sweep may not outlast the minute after the next one.
    expect(JobDictionary.getTimeoutInMs(CRON_NAME)).toBe(2 * 60 * 1000);
  });

  test("the sweep queues the due connections, and a failed sweep is a failed job", async () => {
    await JobDictionary.getJobFunction(CRON_NAME)();

    expect(mockEnqueueDueConnections).toHaveBeenCalledTimes(1);
    expect(mockEnqueueDueConnections.mock.calls[0]![0]).toBeInstanceOf(Date);

    mockEnqueueDueConnections.mockRejectedValue(new Error("database down"));

    await expect(JobDictionary.getJobFunction(CRON_NAME)()).rejects.toThrow(
      "database down",
    );
  });
});

describe("ReadCloudConnections - a read", () => {
  test("reads the connection the job names, importing through the metrics ingest", async () => {
    await runCloudConnectionRead({
      name: READ_JOB,
      data: { connectionId: CONNECTION_ID },
    } as never);

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect((mockRun.mock.calls[0]![0] as ObjectID).toString()).toBe(
      CONNECTION_ID,
    );
    expect(mockRun.mock.calls[0]![1]).toEqual({
      importMetrics: importCloudMetrics,
    });
  });

  test.each([
    [undefined],
    [{}],
    [{ connectionId: "not-an-id" }],
    [{ connectionId: 7 }],
  ])("refuses a job that names no connection: %j", async (data: unknown) => {
    await expect(
      runCloudConnectionRead({ name: READ_JOB, data } as never),
    ).rejects.toThrow("A valid cloud connection ID is required.");
    expect(mockRun).not.toHaveBeenCalled();
  });

  test("a read that fails is a failed job", async () => {
    mockRun.mockRejectedValue(new Error("the read broke"));

    await expect(
      runCloudConnectionRead({
        name: READ_JOB,
        data: { connectionId: CONNECTION_ID },
      } as never),
    ).rejects.toThrow("the read broke");
  });

  test("what a read imports reaches the ingest as the body of its own project's request", async () => {
    const payload: { resourceMetrics: Array<unknown> } = {
      resourceMetrics: [],
    };
    const projectId: ObjectID = new ObjectID(PROJECT_ID);

    await importCloudMetrics({ projectId, payload: payload as never });

    expect(mockProcessMetrics).toHaveBeenCalledTimes(1);
    expect(mockProcessMetrics.mock.calls[0]![0]).toEqual({
      body: payload,
      projectId,
    });
  });

  test("an import the ingest refuses fails the read", async () => {
    mockProcessMetrics.mockRejectedValue(new Error("ingest refused"));

    await expect(
      importCloudMetrics({
        projectId: new ObjectID(PROJECT_ID),
        payload: { resourceMetrics: [] },
      }),
    ).rejects.toThrow("ingest refused");
  });
});
