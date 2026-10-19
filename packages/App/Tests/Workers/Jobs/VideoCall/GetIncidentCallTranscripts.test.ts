import fs from "fs";
import path from "path";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The Worker job behind Record and transcribe incident calls: every five
 * minutes it asks Zoom and Google Meet for the transcripts of the incident
 * calls that are due (IncidentCallTranscriptFetch, whose claim makes it
 * safe on any number of Workers), then writes the postmortem drafts that
 * waited for their incident's calls and need wait no longer. The job itself
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
  "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptFetch",
  () => {
    return {
      __esModule: true,
      default: {
        fetchDue: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Utils/AI/SRE/IncidentPostmortemRunner", () => {
  return {
    __esModule: true,
    default: {
      draftWaitingPostmortems: jest.fn(),
    },
  };
});

// Imported AFTER the mocks above (jest hoists them) so the job registers into the recorder.
import "../../../../FeatureSet/Workers/Jobs/VideoCall/GetIncidentCallTranscripts";
import IncidentCallTranscriptFetch from "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptFetch";
import AIIncidentPostmortemRunner from "Common/Server/Utils/AI/SRE/IncidentPostmortemRunner";

const fetchDue: jest.Mock =
  IncidentCallTranscriptFetch.fetchDue as unknown as jest.Mock;
const draftWaitingPostmortems: jest.Mock =
  AIIncidentPostmortemRunner.draftWaitingPostmortems as unknown as jest.Mock;

const JOB_NAME: string = "VideoCall:GetIncidentCallTranscripts";

beforeEach(() => {
  fetchDue.mockReset();
  fetchDue.mockResolvedValue({ asked: 0, outcomes: {} });
  draftWaitingPostmortems.mockReset();
  draftWaitingPostmortems.mockResolvedValue(undefined);
});

describe("VideoCall:GetIncidentCallTranscripts", () => {
  test("runs every five minutes, not at once on start-up, with room for a slow provider", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedJobs[JOB_NAME]!.options.schedule).toBe(
      EVERY_FIVE_MINUTE,
    );
    expect(mockCapturedJobs[JOB_NAME]!.options.runOnStartup).toBe(false);
    expect(mockCapturedJobs[JOB_NAME]!.options.timeoutInMS).toBe(
      15 * 60 * 1000,
    );
  });

  test("asks for the transcripts that are due, then lets waiting postmortem drafts go on", async () => {
    const order: Array<string> = [];

    fetchDue.mockImplementation(async () => {
      order.push("transcripts");
      return { asked: 0, outcomes: {} };
    });
    draftWaitingPostmortems.mockImplementation(async () => {
      order.push("postmortems");
    });

    await mockCapturedJobs[JOB_NAME]!.run();

    expect(fetchDue).toHaveBeenCalledTimes(1);
    expect(draftWaitingPostmortems).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["transcripts", "postmortems"]);
  });

  test("lets a failing pass fail the job, so the queue records it", async () => {
    fetchDue.mockRejectedValue(new Error("Database not connected"));

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
      'import "./Jobs/VideoCall/GetIncidentCallTranscripts";',
    );
  });
});
