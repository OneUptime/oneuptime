import ExceptionAssignmentNotifications, {
  EXCEPTION_ASSIGNED_JOB_NAME,
} from "Common/Server/Utils/Telemetry/ExceptionAssignmentNotifications";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The Workers tell the people an exception was assigned to once a minute,
 * as every owner-added job does: the job runs ExceptionAssignmentNotifications'
 * pending assignments, which marks each before it sends
 * (ExceptionAssignmentNotifications.test.ts, and on Postgres
 * TelemetryExceptionActivityPostgres.test.ts).
 */

type CronHandler = () => Promise<void>;

interface CapturedJob {
  options: { schedule: string; runOnStartup: boolean };
  run: CronHandler;
}

// Declared before the hoisted jest.mock below, which may only close over "mock" names.
const mockCapturedJobs: Record<string, CapturedJob> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string; runOnStartup: boolean },
        run: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, run };
      },
    ),
  };
});

describe(EXCEPTION_ASSIGNED_JOB_NAME, () => {
  beforeAll(async () => {
    await import(
      "../../../FeatureSet/Workers/Jobs/TelemetryException/SendAssignedNotification"
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs every minute, not on startup", () => {
    expect(mockCapturedJobs[EXCEPTION_ASSIGNED_JOB_NAME]?.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("tells the pending assignments", async () => {
    const send: SpyInstance<
      typeof ExceptionAssignmentNotifications.sendPendingNotifications
    > = jest
      .spyOn(ExceptionAssignmentNotifications, "sendPendingNotifications")
      .mockResolvedValue(3);

    await mockCapturedJobs[EXCEPTION_ASSIGNED_JOB_NAME]!.run();

    expect(send).toHaveBeenCalledTimes(1);
  });

  test("is one of the Workers' jobs", async () => {
    const fs: typeof import("fs") = await import("fs");
    const path: typeof import("path") = await import("path");
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import "./Jobs/TelemetryException/SendAssignedNotification";',
    );
  });
});
