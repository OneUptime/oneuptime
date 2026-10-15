import fs from "fs";
import path from "path";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The Worker job that starts the runs runbooks' schedules are due for: it
 * registers once a minute - as often as a schedule can run - and hands each
 * tick to the scheduler, whose claim makes it safe on any number of
 * Workers (RunbookScheduler, in Common's suites). The job itself exports
 * nothing, so the Cron util is mocked to capture what it registers.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<
  string,
  { options: { schedule: string; runOnStartup: boolean }; run: CronHandler }
> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string; runOnStartup: boolean },
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, run: runFunction };
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

jest.mock("Common/Server/Utils/Runbook/RunbookScheduler", () => {
  return {
    __esModule: true,
    default: {
      runDueSchedules: jest.fn(),
    },
  };
});

// Imported AFTER the mocks above (jest hoists them) so the job registers into the recorder.
import "../../../../FeatureSet/Workers/Jobs/Runbook/StartScheduledRuns";
import RunbookScheduler from "Common/Server/Utils/Runbook/RunbookScheduler";

const runDueSchedules: jest.Mock =
  RunbookScheduler.runDueSchedules as unknown as jest.Mock;

const JOB_NAME: string = "Runbook:StartScheduledRuns";

beforeEach(() => {
  runDueSchedules.mockReset();
  runDueSchedules.mockResolvedValue({
    planned: 0,
    outcomes: [],
    startedFromQueue: 0,
  });
});

describe("Runbook:StartScheduledRuns", () => {
  test("runs once a minute, and not at once on start-up", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedJobs[JOB_NAME]!.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("hands each tick to the scheduler, once", async () => {
    await mockCapturedJobs[JOB_NAME]!.run();

    expect(runDueSchedules).toHaveBeenCalledTimes(1);
  });

  test("lets a failing pass fail the job, so the queue records it", async () => {
    runDueSchedules.mockRejectedValue(new Error("Database not connected"));

    await expect(mockCapturedJobs[JOB_NAME]!.run()).rejects.toThrow(
      "Database not connected",
    );
  });

  test("is one of the jobs the Workers feature set loads", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain('import "./Jobs/Runbook/StartScheduledRuns";');
  });
});
