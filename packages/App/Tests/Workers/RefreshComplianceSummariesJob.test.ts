import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals (the
 * PullLlmConnectionsJob pattern): the `jest.Mock` annotations must resolve
 * to the same global namespace as jest.fn()/jest.mock().
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Kubernetes:RefreshComplianceSummaries (#9876): every five minutes, the
 * clusters whose compliance summary is due are scored again, for
 * Kubernetes' Compliance page, which compares every cluster without scoring
 * any. The REAL RunCron and JobDictionary run here; the queue and the
 * summary store under them are replaced so what the job hands them is
 * visible.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});
const mockRefreshDue: jest.Mock = jest.fn();
const mockLoggerError: jest.Mock = jest.fn();

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
  "Common/Server/Utils/Kubernetes/KubernetesClusterComplianceSummary",
  () => {
    return {
      __esModule: true,
      default: { refreshDueClusters: mockRefreshDue },
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
      error: mockLoggerError,
    },
  };
});

import JobDeadline from "Common/Server/Utils/JobDeadline";
import JobDictionary, {
  WorkerJobFunction,
} from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/Kubernetes/RefreshComplianceSummaries";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const JOB: string = "Kubernetes:RefreshComplianceSummaries";
const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

beforeEach(() => {
  mockRefreshDue.mockReset();
  mockRefreshDue.mockResolvedValue({
    refreshed: 2,
    failed: 0,
    left: 0,
  } as never);
  mockLoggerError.mockReset();
});

describe("Kubernetes:RefreshComplianceSummaries", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      "utf-8",
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/Kubernetes/RefreshComplianceSummaries")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("runs every five minutes, the agent's default snapshot interval", () => {
    const cron: Array<unknown> | undefined = registrationAddJobCalls.find(
      (call: Array<unknown>) => {
        return call[2] === JOB;
      },
    );

    expect(cron).toBeDefined();
    expect(cron![0]).toBe("Worker");
    expect(cron![4]).toEqual({ scheduleAt: EVERY_FIVE_MINUTE });
    expect(JobDictionary.has(JOB)).toBe(true);
  });

  test("scores the clusters due now, within the run's deadline", async () => {
    const tick: WorkerJobFunction = JobDictionary.getJobFunction(JOB);
    const before: number = Date.now();

    await tick();

    expect(mockRefreshDue).toHaveBeenCalledTimes(1);

    const args: { now: Date; deadline: JobDeadline } = mockRefreshDue.mock
      .calls[0]![0] as { now: Date; deadline: JobDeadline };

    expect(args.now).toBeInstanceOf(Date);
    expect(args.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.deadline).toBeInstanceOf(JobDeadline);
  });

  test("a run that fails is logged, and the job goes on to its next run", async () => {
    mockRefreshDue.mockRejectedValue(new Error("database is down") as never);

    await expect(JobDictionary.getJobFunction(JOB)()).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      "RefreshComplianceSummaries cron failed: database is down",
    );
  });
});
