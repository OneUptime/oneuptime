import fs from "fs";
import path from "path";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The Worker job behind Zoom's deauthorization (issue #9289): someone
 * removed OneUptime from their Zoom account, and Zoom asks apps to delete a
 * removed user's data. The event marks every incident call whose
 * transcript OneUptime read through that sign-in; every minute this
 * deletes what was read through it, call by call
 * (IncidentCallTranscriptRemoval.removeForRemovedSignIns). The job itself
 * exports nothing, so the Cron util is mocked to capture what it registers.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<
  string,
  {
    options: { schedule: string; runOnStartup: boolean; timeoutInMS?: number };
    run: CronHandler;
  }
> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: {
          schedule: string;
          runOnStartup: boolean;
          timeoutInMS?: number;
        },
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, run: runFunction };
      },
    ),
  };
});

jest.mock(
  "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval",
  () => {
    return {
      __esModule: true,
      default: {
        removeForRemovedSignIns: jest.fn(),
      },
    };
  },
);

// Imported AFTER the mocks above (jest hoists them) so the job registers into the recorder.
import "../../../../FeatureSet/Workers/Jobs/VideoCall/DeleteTranscriptsOfRemovedSignIns";
import IncidentCallTranscriptRemoval from "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval";

const removeForRemovedSignIns: jest.Mock =
  IncidentCallTranscriptRemoval.removeForRemovedSignIns as unknown as jest.Mock;

const JOB_NAME: string = "VideoCall:DeleteTranscriptsOfRemovedSignIns";

beforeEach(() => {
  removeForRemovedSignIns.mockReset();
  removeForRemovedSignIns.mockResolvedValue(0);
});

describe("VideoCall:DeleteTranscriptsOfRemovedSignIns", () => {
  test("runs every minute - Zoom's data deletion is not left waiting - and not at once on start-up", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedJobs[JOB_NAME]!.options.schedule).toBe(EVERY_MINUTE);
    expect(mockCapturedJobs[JOB_NAME]!.options.runOnStartup).toBe(false);
    expect(mockCapturedJobs[JOB_NAME]!.options.timeoutInMS).toBe(
      10 * 60 * 1000,
    );
  });

  test("deletes what was read through the removed sign-ins", async () => {
    removeForRemovedSignIns.mockResolvedValue(3);

    await mockCapturedJobs[JOB_NAME]!.run();

    expect(removeForRemovedSignIns).toHaveBeenCalledTimes(1);
  });

  test("lets a failing pass fail the job, so the queue records it; the calls stay marked", async () => {
    removeForRemovedSignIns.mockRejectedValue(
      new Error("Database not connected"),
    );

    await expect(mockCapturedJobs[JOB_NAME]!.run()).rejects.toThrow(
      "Database not connected",
    );
  });

  test("is one of the jobs the Workers feature set loads", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import "./Jobs/VideoCall/DeleteTranscriptsOfRemovedSignIns";',
    );
  });
});
