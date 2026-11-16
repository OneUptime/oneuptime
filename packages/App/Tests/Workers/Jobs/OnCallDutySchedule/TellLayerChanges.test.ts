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
 * OnCallDutySchedule:TellLayerChanges - the Workers' half of telling a
 * change made to a schedule's layers through the API once (#7813). Each
 * write of such a change holds its schedule (rosterRefreshDueAt); this
 * cron tells the changes whose quiet period is over
 * (ScheduleLayerChanges.tellDueChanges). The REAL RunCron and JobDictionary
 * run here; the queue and ScheduleLayerChanges under them are replaced.
 *
 * Pinned:
 *   1. App/FeatureSet/Workers/Index.ts imports the job module (a cron
 *      nobody imports is a change that is never told);
 *   2. it runs every minute, and not on startup: what it tells waits in
 *      Postgres, and the first tick after a start tells it;
 *   3. each tick asks ScheduleLayerChanges to tell what is due, and a
 *      failure fails the tick, rather than being swallowed.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});
const mockTellDueChanges: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Utils/OnCall/ScheduleLayerChanges", () => {
  return {
    __esModule: true,
    default: { tellDueChanges: mockTellDueChanges },
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

import JobDictionary, {
  WorkerJobFunction,
} from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutySchedule/TellLayerChanges";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const JOB: string = "OnCallDutySchedule:TellLayerChanges";

const WORKERS_DIR: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers",
);

beforeEach(() => {
  mockTellDueChanges.mockReset();
  mockTellDueChanges.mockResolvedValue(2 as never);
});

describe("OnCallDutySchedule:TellLayerChanges", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      "utf-8",
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/OnCallDutySchedule/TellLayerChanges")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("it runs every minute on the Worker queue, and not on startup", () => {
    const cron: Array<unknown> | undefined = registrationAddJobCalls.find(
      (call: Array<unknown>) => {
        return call[2] === JOB;
      },
    );

    expect(cron).toBeDefined();
    expect(cron![0]).toBe("Worker");
    expect(cron![4]).toEqual({ scheduleAt: EVERY_MINUTE });
    expect(JobDictionary.has(JOB)).toBe(true);

    // Not run once at registration: nothing but the schedule was queued.
    expect(mockTellDueChanges).not.toHaveBeenCalled();
  });

  test("each tick tells the changes that are due", async () => {
    const tick: WorkerJobFunction = JobDictionary.getJobFunction(JOB);

    await tick();

    expect(mockTellDueChanges).toHaveBeenCalledTimes(1);
  });

  test("a tick that cannot read what is due fails, rather than saying nothing", async () => {
    mockTellDueChanges.mockRejectedValue(
      new Error("connection terminated") as never,
    );

    const tick: WorkerJobFunction = JobDictionary.getJobFunction(JOB);

    await expect(tick()).rejects.toThrow("connection terminated");
  });
});
