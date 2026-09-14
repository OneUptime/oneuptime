import runWorkerJob from "../../../../FeatureSet/Workers/Utils/RunWorkerJob";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import JobDictionary, {
  WorkerJobFunction,
} from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import { runSecurityEventConnection } from "../../../../FeatureSet/Workers/Jobs/SecurityEvents/RunSecurityEventConnection";
import SecurityEventConnectionRunExecutor, {
  SECURITY_EVENT_CONNECTION_RUN_JOB,
  SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS,
} from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * The Worker handler for SecurityEvents:RunSecurityEventConnection. Mirrors
 * RunGoogleSecOpsConnection.test.ts, plus what this handler adds: on the
 * job's LAST BullMQ attempt an exception that escaped executeRun (a lock
 * timeout, a database error while reading the run) is written onto the run
 * row through markRunFailed, so the row does not sit in "queued" until the
 * twenty-minute stale sweep blames worker health for a different cause.
 */

jest.mock(
  "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor",
  () => {
    return {
      __esModule: true,
      default: { executeRun: jest.fn(), markRunFailed: jest.fn() },
      SECURITY_EVENT_CONNECTION_RUN_JOB:
        "SecurityEvents:RunSecurityEventConnection",
      SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS: 600_000,
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

const RUN_ID: string = "33333333-3333-4333-8333-333333333333";
const SECRET_VALUE: string = "redis-password-0badf00d";

function job(data: {
  runId: string;
  attempts?: number | undefined;
  attemptsMade?: number | undefined;
}): QueueJob {
  return {
    name: SECURITY_EVENT_CONNECTION_RUN_JOB,
    data: { runId: data.runId },
    ...(data.attempts !== undefined
      ? { opts: { attempts: data.attempts } }
      : {}),
    ...(data.attemptsMade !== undefined
      ? { attemptsMade: data.attemptsMade }
      : {}),
  } as unknown as QueueJob;
}

beforeEach(() => {
  (
    SecurityEventConnectionRunExecutor.executeRun as jest.Mock
  ).mockResolvedValue(undefined);
  (
    SecurityEventConnectionRunExecutor.markRunFailed as jest.Mock
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllMocks();
});

test("registers a data-aware Worker handler with the bounded timeout", async () => {
  const handler: WorkerJobFunction = JobDictionary.getJobFunction(
    SECURITY_EVENT_CONNECTION_RUN_JOB,
  );
  expect(handler).toBe(runSecurityEventConnection);
  expect(JobDictionary.getTimeoutInMs(SECURITY_EVENT_CONNECTION_RUN_JOB)).toBe(
    SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS,
  );
  await handler({ data: { runId: RUN_ID } } as QueueJob);
  expect(SecurityEventConnectionRunExecutor.executeRun).toHaveBeenCalledWith(
    new ObjectID(RUN_ID),
  );
  expect(
    SecurityEventConnectionRunExecutor.markRunFailed,
  ).not.toHaveBeenCalled();
});

test.each([undefined, {}, { runId: "" }, { runId: "invalid" }, { runId: 12 }])(
  "rejects missing or malformed payload %j before execution",
  async (data: unknown) => {
    await expect(
      runSecurityEventConnection(data ? ({ data } as QueueJob) : undefined),
    ).rejects.toThrow("valid security event connection operation ID");
    expect(
      SecurityEventConnectionRunExecutor.executeRun,
    ).not.toHaveBeenCalled();
    expect(
      SecurityEventConnectionRunExecutor.markRunFailed,
    ).not.toHaveBeenCalled();
  },
);

test("passes execution failures back to the queue for retry on a non-final attempt", async () => {
  (
    SecurityEventConnectionRunExecutor.executeRun as jest.Mock
  ).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(
    runSecurityEventConnection(
      job({ runId: RUN_ID, attempts: 3, attemptsMade: 0 }),
    ),
  ).rejects.toThrow("database unavailable");
  // Attempt 1 of 3: BullMQ will retry, so the row is left for the retry.
  expect(
    SecurityEventConnectionRunExecutor.markRunFailed,
  ).not.toHaveBeenCalled();
});

test("an intermediate attempt is not final either", async () => {
  (
    SecurityEventConnectionRunExecutor.executeRun as jest.Mock
  ).mockRejectedValueOnce(new Error("lock timeout"));
  await expect(
    runSecurityEventConnection(
      job({ runId: RUN_ID, attempts: 3, attemptsMade: 1 }),
    ),
  ).rejects.toThrow("lock timeout");
  expect(
    SecurityEventConnectionRunExecutor.markRunFailed,
  ).not.toHaveBeenCalled();
});

test("on the final attempt the failure is recorded on the run row, redacted, and still rethrown", async () => {
  (
    SecurityEventConnectionRunExecutor.executeRun as jest.Mock
  ).mockRejectedValueOnce(
    new Error(`Redis refused: redis://default:${SECRET_VALUE}@redis:6379`),
  );
  await expect(
    runSecurityEventConnection(
      job({ runId: RUN_ID, attempts: 3, attemptsMade: 2 }),
    ),
  ).rejects.toThrow("Redis refused");
  expect(
    SecurityEventConnectionRunExecutor.markRunFailed,
  ).toHaveBeenCalledTimes(1);
  const [runId, message] = (
    SecurityEventConnectionRunExecutor.markRunFailed as jest.Mock
  ).mock.calls[0] as [ObjectID, string];
  expect(runId).toEqual(new ObjectID(RUN_ID));
  expect(message).toContain("Redis refused");
  expect(message).not.toContain(SECRET_VALUE);
});

test("a job without retry options is a single attempt, so its failure is final", async () => {
  (
    SecurityEventConnectionRunExecutor.executeRun as jest.Mock
  ).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(
    runSecurityEventConnection({ data: { runId: RUN_ID } } as QueueJob),
  ).rejects.toThrow("database unavailable");
  expect(SecurityEventConnectionRunExecutor.markRunFailed).toHaveBeenCalledWith(
    new ObjectID(RUN_ID),
    "database unavailable",
  );
});

test("a failure to record the final failure is logged and the original error still propagates", async () => {
  (
    SecurityEventConnectionRunExecutor.executeRun as jest.Mock
  ).mockRejectedValueOnce(new Error("original failure"));
  (
    SecurityEventConnectionRunExecutor.markRunFailed as jest.Mock
  ).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(
    runSecurityEventConnection(
      job({ runId: RUN_ID, attempts: 1, attemptsMade: 0 }),
    ),
  ).rejects.toThrow("original failure");
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining("could not record the job failure"),
  );
});

test("a successful run never touches markRunFailed", async () => {
  await runSecurityEventConnection(
    job({ runId: RUN_ID, attempts: 3, attemptsMade: 2 }),
  );
  expect(
    SecurityEventConnectionRunExecutor.markRunFailed,
  ).not.toHaveBeenCalled();
});

test("existing zero-argument cron functions remain callable with a queue job", async () => {
  const legacy: jest.Mock = jest.fn(async (): Promise<void> => {});
  JobDictionary.setJobFunction("legacy-cron", legacy);
  await JobDictionary.getJobFunction("legacy-cron")({ data: {} } as QueueJob);
  expect(legacy).toHaveBeenCalledTimes(1);
  expect(JobDictionary.getTimeoutInMs("legacy-cron")).toBe(300_000);
});

test("the production worker timeout wrapper delivers queue data to the registered handler", async () => {
  const queued: QueueJob = {
    name: SECURITY_EVENT_CONNECTION_RUN_JOB,
    data: { runId: RUN_ID },
  } as QueueJob;
  await runWorkerJob(queued);
  expect(QueueWorker.runJobWithTimeout).toHaveBeenCalledWith(
    SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS,
    expect.any(Function),
  );
  expect(SecurityEventConnectionRunExecutor.executeRun).toHaveBeenCalledWith(
    new ObjectID(RUN_ID),
  );
});
