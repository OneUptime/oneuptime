import fs from "fs";
import path from "path";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * THE WORKER THAT PAGES AGAIN WHEN AN ACKNOWLEDGED RECORD IS NOT RESOLVED IN
 * TIME (OnCallAcknowledgementTimeout).
 *
 * It registers once, runs every minute, and hands each tick to the one
 * place that decides - which reads every running clock, and pages again for
 * each that ran out. It is registered with the other on-call workers, so
 * the workers' service runs it.
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
        mockCapturedJobs[jobName] = { options: options, run: runFunction };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout", () => {
  return {
    __esModule: true,
    default: {
      run: jest.fn(async () => {
        return [];
      }),
    },
  };
});

import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/PageAgainAfterAcknowledgementTimeout";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:PageAgainAfterAcknowledgementTimeout";

describe("the page-again worker", () => {
  test("registers under its name, every minute, not at startup", () => {
    expect(Object.keys(mockCapturedJobs)).toEqual([JOB_NAME]);
    expect(mockCapturedJobs[JOB_NAME]!.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("each tick hands every running clock to the one place that decides", async () => {
    await mockCapturedJobs[JOB_NAME]!.run();
    await mockCapturedJobs[JOB_NAME]!.run();

    expect(
      (OnCallAcknowledgementTimeout as unknown as { run: jest.Mock }).run,
    ).toHaveBeenCalledTimes(2);
  });

  test("is started with the other on-call workers", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import "./Jobs/OnCallDutyPolicyExecutionLog/PageAgainAfterAcknowledgementTimeout";',
    );
  });
});
