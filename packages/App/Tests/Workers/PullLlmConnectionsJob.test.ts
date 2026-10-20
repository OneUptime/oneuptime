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
 * AI connections are read by the worker: a cron every minute queues the
 * connections that are due, and each read runs as a job of its own whose
 * only data is the connection's id. A company AI tool's chats go through
 * the trace ingest exactly as an app's spans do. The REAL RunCron and
 * JobDictionary run here; the queue, the scheduler, the read loop and the
 * ingest under them are replaced so what the job hands them is visible.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});
const mockEnqueueDue: jest.Mock = jest.fn();
const mockRun: jest.Mock = jest.fn();
const mockProcessTraces: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/LlmObservability/LlmConnectionScheduler", () => {
  return {
    __esModule: true,
    LLM_CONNECTION_PULL_JOB: "LlmObservability:PullConnection",
    LLM_CONNECTION_PULL_JOB_TIMEOUT_MS: 9 * 60 * 1000,
    default: { enqueueDueConnections: mockEnqueueDue },
  };
});

jest.mock(
  "Common/Server/Utils/LlmObservability/LlmConnectionPullRunner",
  () => {
    return { __esModule: true, default: { run: mockRun } };
  },
);

jest.mock("../../FeatureSet/Telemetry/Services/OtelTracesIngestService", () => {
  return {
    __esModule: true,
    default: { processTracesFromQueue: mockProcessTraces },
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

import ObjectID from "Common/Types/ObjectID";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import JobDictionary, {
  WorkerJobFunction,
} from "../../FeatureSet/Workers/Utils/JobDictionary";
import {
  importLlmChatSpans,
  runLlmConnectionPull,
} from "../../FeatureSet/Workers/Jobs/LlmObservability/PullLlmConnections";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const PULL_JOB: string = "LlmObservability:PullConnection";
const CRON_JOB: string = "LlmObservability:PullDueConnections";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

function job(data: Record<string, unknown>): QueueJob {
  return { data } as unknown as QueueJob;
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue({ status: "success", result: {} } as never);
  mockEnqueueDue.mockReset();
  mockEnqueueDue.mockResolvedValue(2 as never);
  mockProcessTraces.mockReset();
  mockProcessTraces.mockResolvedValue(undefined as never);
});

describe("AI connection jobs - wired into the worker", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      "utf-8",
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/LlmObservability/PullLlmConnections")}["']\\s*;?\\s*$`,
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
    expect(JobDictionary.getTimeoutInMs(PULL_JOB)).toBe(9 * 60 * 1000);
    expect(JobDictionary.has(PULL_JOB)).toBe(true);
  });

  test("the cron queues the due connections", async () => {
    const tick: WorkerJobFunction = JobDictionary.getJobFunction(CRON_JOB);

    await tick();

    expect(mockEnqueueDue).toHaveBeenCalledTimes(1);
    expect(mockEnqueueDue.mock.calls[0]![0]).toBeInstanceOf(Date);
  });
});

describe("AI connection jobs - one read", () => {
  test("reads the connection the job names, importing chats through the trace ingest", async () => {
    await JobDictionary.getJobFunction(PULL_JOB)(
      job({ connectionId: CONNECTION }),
    );

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0]![0]).toEqual(new ObjectID(CONNECTION));
    expect(mockRun.mock.calls[0]![1]).toEqual({
      importSpans: importLlmChatSpans,
    });
  });

  test.each([
    [{}],
    [{ connectionId: "" }],
    [{ connectionId: "../etc" }],
    [{ connectionId: 42 }],
  ])(
    "a job without a valid connection id (%j) is refused",
    async (data: Record<string, unknown>) => {
      await expect(runLlmConnectionPull(job(data))).rejects.toThrow(
        "A valid AI connection ID is required.",
      );
      expect(mockRun).not.toHaveBeenCalled();
    },
  );

  test("a read that fails outright fails the job", async () => {
    mockRun.mockRejectedValue(new Error("database is down") as never);

    await expect(
      runLlmConnectionPull(job({ connectionId: CONNECTION })),
    ).rejects.toThrow("database is down");
  });

  test("chats are handed to the trace ingest as the project's own OTLP request", async () => {
    const payload: Record<string, unknown> = {
      resourceSpans: [{ scopeSpans: [] }],
    };

    await importLlmChatSpans({ projectId: PROJECT, payload: payload as never });

    expect(mockProcessTraces).toHaveBeenCalledWith({
      body: payload,
      projectId: PROJECT,
    });
  });

  test("an ingest failure reaches the read, which records it", async () => {
    mockProcessTraces.mockRejectedValue(new Error("ingest refused") as never);

    await expect(
      importLlmChatSpans({ projectId: PROJECT, payload: {} as never }),
    ).rejects.toThrow("ingest refused");
  });
});
