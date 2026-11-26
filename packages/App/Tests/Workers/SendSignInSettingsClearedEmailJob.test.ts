import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE EMAILS TO PEOPLE WHOSE SIGN-IN SETTINGS WERE CLEARED ARE SENT AT ALL
 * (#9991).
 *
 * A clear queues each person's email as a job on the Worker queue
 * (Common/Server/Utils/SignInSettingsClearedEmail, whose suite pins the job
 * itself), and a worker runs it by its name - which only works while this
 * job's module puts its function in JobDictionary. That happens as a side
 * effect of an import in App/FeatureSet/Workers/Index.ts: delete the line
 * and every other suite stays green while nobody whose settings were
 * cleared is ever told. The real JobDictionary and the Worker queue's own
 * dispatcher (runWorkerJob) run here; only the sender under them is stood
 * in.
 */

const mockRunJob: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/SignInSettingsClearedEmail", () => {
  return {
    __esModule: true,
    SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB: "SignInSettingsCleared:SendEmail",
    EMAIL_JOB_TIMEOUT_IN_MS: 120000,
    default: {
      runJob: mockRunJob,
    },
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

// Imported after the mocks; the job's import last - its side effect is the point.
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import runWorkerJob from "../../FeatureSet/Workers/Utils/RunWorkerJob";
import { sendSignInSettingsClearedEmail } from "../../FeatureSet/Workers/Jobs/SignInSettings/SendClearedEmail";

// A contract with the jobs already in Redis: a rename strands them.
const JOB_NAME: string = "SignInSettingsCleared:SendEmail";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

const jobOf: (data: {
  data: Record<string, unknown>;
  attemptsMade?: number;
  attempts?: number;
}) => QueueJob = (data: {
  data: Record<string, unknown>;
  attemptsMade?: number;
  attempts?: number;
}): QueueJob => {
  return {
    name: JOB_NAME,
    data: data.data,
    attemptsMade: data.attemptsMade || 0,
    opts: { attempts: data.attempts || 6 },
  } as unknown as QueueJob;
};

beforeEach(() => {
  mockRunJob.mockReset();
  mockRunJob.mockResolvedValue(undefined as never);
});

describe("the email job is wired into the worker at all", () => {
  test("Workers/Index.ts imports its module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp(
          "./Jobs/SignInSettings/SendClearedEmail",
        )}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("puts a runnable function in JobDictionary under the name a clear queues it by, with its time limit", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(true);
    expect(JobDictionary.getJobFunction(JOB_NAME)).toBe(
      sendSignInSettingsClearedEmail,
    );
    expect(JobDictionary.getTimeoutInMs(JOB_NAME)).toBe(120000);
  });
});

describe("what a worker does with one", () => {
  test("hands the sender the job's data and the attempt BullMQ is on", async () => {
    const data: Record<string, unknown> = { userId: "someone" };

    await runWorkerJob(jobOf({ data: data, attemptsMade: 2, attempts: 6 }));

    expect(mockRunJob).toHaveBeenCalledTimes(1);
    expect(mockRunJob).toHaveBeenCalledWith(data, {
      attempt: 3,
      maxAttempts: 6,
    });
  });

  test("a first attempt is attempt one", async () => {
    await sendSignInSettingsClearedEmail(jobOf({ data: {} }));

    expect(mockRunJob).toHaveBeenCalledWith({}, { attempt: 1, maxAttempts: 6 });
  });

  test("a send that failed throws out of the job, so the queue tries it again", async () => {
    mockRunJob.mockRejectedValue(new Error("not sent") as never);

    await expect(
      runWorkerJob(jobOf({ data: { userId: "someone" } })),
    ).rejects.toThrow("not sent");
  });
});
