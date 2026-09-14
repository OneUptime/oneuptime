import runWorkerJob from "../../../../FeatureSet/Workers/Utils/RunWorkerJob";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import JobDictionary, {
  WorkerJobFunction,
} from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import { runGoogleSecOpsConnection } from "../../../../FeatureSet/Workers/Jobs/SecurityEvents/RunGoogleSecOpsConnection";
import GoogleSecOpsRunExecutor, {
  GOOGLE_SECOPS_RUN_JOB,
  GOOGLE_SECOPS_RUN_TIMEOUT_MS,
} from "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import ObjectID from "Common/Types/ObjectID";

jest.mock(
  "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor",
  () => {
    return {
      __esModule: true,
      default: { executeRun: jest.fn() },
      GOOGLE_SECOPS_RUN_JOB: "SecurityEvents:RunGoogleSecOpsConnection",
      GOOGLE_SECOPS_RUN_TIMEOUT_MS: 600_000,
    };
  },
);

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      runJobWithTimeout: jest.fn(
        async (
          _timeout: number,
          operation: () => Promise<void>,
        ): Promise<void> => {
          await operation();
        },
      ),
    },
  };
});

const RUN_ID: string = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  jest.clearAllMocks();
});

test("registers a data-aware Worker handler with the bounded timeout", async () => {
  const handler: WorkerJobFunction = JobDictionary.getJobFunction(
    GOOGLE_SECOPS_RUN_JOB,
  );
  expect(handler).toBe(runGoogleSecOpsConnection);
  expect(JobDictionary.getTimeoutInMs(GOOGLE_SECOPS_RUN_JOB)).toBe(
    GOOGLE_SECOPS_RUN_TIMEOUT_MS,
  );
  await handler({ data: { runId: RUN_ID } } as QueueJob);
  expect(GoogleSecOpsRunExecutor.executeRun).toHaveBeenCalledWith(
    new ObjectID(RUN_ID),
  );
});

test.each([undefined, {}, { runId: "" }, { runId: "invalid" }, { runId: 12 }])(
  "rejects missing or malformed payload %j before execution",
  async (data: unknown) => {
    await expect(
      runGoogleSecOpsConnection(data ? ({ data } as QueueJob) : undefined),
    ).rejects.toThrow("valid Google SecOps operation ID");
    expect(GoogleSecOpsRunExecutor.executeRun).not.toHaveBeenCalled();
  },
);

test("passes execution failures back to the queue for retry", async () => {
  (GoogleSecOpsRunExecutor.executeRun as jest.Mock).mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  await expect(
    runGoogleSecOpsConnection({ data: { runId: RUN_ID } } as QueueJob),
  ).rejects.toThrow("database unavailable");
});

test("existing zero-argument cron functions remain callable with a queue job", async () => {
  const legacy: jest.Mock = jest.fn(async (): Promise<void> => {});
  JobDictionary.setJobFunction("legacy-cron", legacy);
  await JobDictionary.getJobFunction("legacy-cron")({ data: {} } as QueueJob);
  expect(legacy).toHaveBeenCalledTimes(1);
  expect(JobDictionary.getTimeoutInMs("legacy-cron")).toBe(300_000);
});

test("the production worker timeout wrapper delivers queue data to the registered handler", async () => {
  const job: QueueJob = {
    name: GOOGLE_SECOPS_RUN_JOB,
    data: { runId: RUN_ID },
  } as QueueJob;
  await runWorkerJob(job);
  expect(QueueWorker.runJobWithTimeout).toHaveBeenCalledWith(
    GOOGLE_SECOPS_RUN_TIMEOUT_MS,
    expect.any(Function),
  );
  expect(GoogleSecOpsRunExecutor.executeRun).toHaveBeenCalledWith(
    new ObjectID(RUN_ID),
  );
});

test("the production worker wrapper still invokes existing zero-argument cron jobs", async () => {
  const legacy: jest.Mock = jest.fn(async (): Promise<void> => {});
  JobDictionary.setJobFunction("legacy-wrapped-cron", legacy);
  await runWorkerJob({ name: "legacy-wrapped-cron", data: {} } as QueueJob);
  expect(QueueWorker.runJobWithTimeout).toHaveBeenCalledWith(
    300_000,
    expect.any(Function),
  );
  expect(legacy).toHaveBeenCalledTimes(1);
});
