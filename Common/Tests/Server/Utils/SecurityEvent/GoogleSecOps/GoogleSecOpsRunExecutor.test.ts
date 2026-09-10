import GoogleSecOpsRunExecutor, {
  GOOGLE_SECOPS_RUN_JOB,
} from "../../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor";
import GoogleSecOpsPoller from "../../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import GoogleSecOpsConnectionRunService from "../../../../../Server/Services/GoogleSecOpsConnectionRunService";
import GoogleSecOpsConnectionService from "../../../../../Server/Services/GoogleSecOpsConnectionService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ResellerService from "../../../../../Server/Services/ResellerService";
import Queue, { QueueName } from "../../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import GoogleSecOpsConnection from "../../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "../../../../../Models/DatabaseModels/GoogleSecOpsConnectionRun";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import {
  GoogleSecOpsRunResult,
  GoogleSecOpsRunStatus,
  GoogleSecOpsRunType,
} from "../../../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";

jest.mock(
  "../../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller",
  () => {
    return { __esModule: true, default: { executeConnection: jest.fn() } };
  },
);
jest.mock(
  "../../../../../Server/Services/GoogleSecOpsConnectionRunService",
  () => {
    return {
      __esModule: true,
      default: {
        findOneBy: jest.fn(),
        findOneById: jest.fn(),
        findBy: jest.fn(),
        create: jest.fn(),
        updateOneById: jest.fn(),
        updateOneBy: jest.fn(),
      },
    };
  },
);
jest.mock(
  "../../../../../Server/Services/GoogleSecOpsConnectionService",
  () => {
    return {
      __esModule: true,
      default: { findOneBy: jest.fn(), findBy: jest.fn() },
    };
  },
);
jest.mock("../../../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../../../Server/Services/ResellerService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../../../Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Worker: "Worker" },
  };
});
jest.mock("../../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
    SemaphoreLockTimeoutError: class extends Error {},
  };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const lock: SemaphoreMutex = {} as SemaphoreMutex;
let run: GoogleSecOpsConnectionRun;
let connection: GoogleSecOpsConnection;
let result: GoogleSecOpsRunResult;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-10T12:00:00Z"));
  run = new GoogleSecOpsConnectionRun();
  run.id = RUN;
  run.projectId = PROJECT;
  run.googleSecOpsConnectionId = CONNECTION;
  run.type = "poll";
  run.status = "queued";
  run.request = { type: "poll" };
  run.createdAt = new Date(Date.now());
  run.updatedAt = new Date(Date.now());
  connection = new GoogleSecOpsConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.isEnabled = true;
  connection.serviceAccountJson = "private credential";
  result = {
    type: "poll",
    status: "success",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T12:00:00Z",
    durationMs: 60_000,
    windowStart: "2026-09-10T11:45:00Z",
    windowEnd: "2026-09-10T12:00:00Z",
    includeNonAlertingDetections: false,
    fetchedCount: 1,
    ingestedCount: 1,
    duplicateCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 1,
    warnings: [],
    samples: [],
    checks: [],
  };
  (Semaphore.lock as jest.Mock).mockResolvedValue(lock);
  (Semaphore.release as jest.Mock).mockResolvedValue(undefined);
  (ProjectService.findOneById as jest.Mock).mockResolvedValue({ id: PROJECT });
  (ResellerService.findOneById as jest.Mock).mockResolvedValue({
    enableTelemetryFeatures: true,
  });
  (GoogleSecOpsConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    null,
  );
  (
    GoogleSecOpsConnectionRunService.findOneById as jest.Mock
  ).mockImplementation(async () => {
    return run;
  });
  (GoogleSecOpsConnectionRunService.findBy as jest.Mock).mockResolvedValue([]);
  (GoogleSecOpsConnectionRunService.create as jest.Mock).mockImplementation(
    async (data: { data: GoogleSecOpsConnectionRun }) => {
      data.data.id = RUN;
      return data.data;
    },
  );
  (
    GoogleSecOpsConnectionRunService.updateOneById as jest.Mock
  ).mockResolvedValue(run);
  (GoogleSecOpsConnectionRunService.updateOneBy as jest.Mock).mockResolvedValue(
    1,
  );
  (GoogleSecOpsConnectionService.findOneBy as jest.Mock).mockResolvedValue(
    connection,
  );
  (GoogleSecOpsConnectionService.findBy as jest.Mock).mockResolvedValue([]);
  (GoogleSecOpsPoller.executeConnection as jest.Mock).mockImplementation(
    async () => {
      return result;
    },
  );
  (Queue.addJob as jest.Mock).mockResolvedValue({});
});
afterEach(() => {
  jest.restoreAllMocks();
});

const START: string = "2026-09-09T00:00:00Z";
const END: string = "2026-09-10T00:00:00Z";
test.each(["test", "poll"])(
  "validates %s without historical fields and strips unrelated body data",
  (type: string) => {
    expect(
      GoogleSecOpsRunExecutor.validateOptions({
        type,
        serviceAccountJson: "secret",
        runId: USER.toString(),
        projectId: "foreign",
      }),
    ).toEqual({ type });
  },
);
test.each(["preview", "backfill"])(
  "normalizes explicit %s timestamps",
  (type: string) => {
    expect(
      GoogleSecOpsRunExecutor.validateOptions({
        type,
        startTime: "2026-09-09T01:00:00+01:00",
        endTime: END,
      }),
    ).toEqual({
      type,
      startTime: "2026-09-09T00:00:00.000Z",
      endTime: "2026-09-10T00:00:00.000Z",
    });
  },
);
test.each([
  null,
  [],
  {},
  { type: "delete" },
  { type: "poll", startTime: START },
  { type: "test", endTime: END },
  { type: "preview" },
  { type: "backfill", startTime: START, endTime: "invalid" },
  { type: "preview", startTime: START, endTime: START },
  { type: "preview", startTime: END, endTime: START },
  { type: "preview", startTime: "2026-09-01T00:00:00Z", endTime: END },
  { type: "preview", startTime: START, endTime: "2026-09-11T00:00:00Z" },
  { type: "preview", startTime: "2026-09-09", endTime: END },
  { type: "preview", startTime: 0, endTime: END },
])("rejects invalid requests %j", (input: unknown) => {
  expect(() => {
    GoogleSecOpsRunExecutor.validateOptions(input);
  }).toThrow();
});
test("accepts exactly seven days and an end equal to now", () => {
  expect(
    GoogleSecOpsRunExecutor.validateOptions({
      type: "backfill",
      startTime: "2026-09-03T12:00:00Z",
      endTime: "2026-09-10T12:00:00Z",
    }).type,
  ).toBe("backfill");
});

async function enqueue(): Promise<ObjectID> {
  return GoogleSecOpsRunExecutor.enqueue({
    projectId: PROJECT,
    connectionId: CONNECTION,
    options: { type: "test" },
    requestedByUserId: USER,
  });
}

test("records a queued operation before routing only its ID to the Worker queue", async () => {
  expect(await enqueue()).toEqual(RUN);
  expect(GoogleSecOpsConnectionRunService.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      projectId: PROJECT,
      googleSecOpsConnectionId: CONNECTION,
      type: "test",
      status: "queued",
      requestedByUserId: USER,
      request: { type: "test", scheduled: false },
    }),
    props: { isRoot: true },
  });
  expect(Queue.addJob).toHaveBeenCalledWith(
    QueueName.Worker,
    RUN.toString(),
    GOOGLE_SECOPS_RUN_JOB,
    { runId: RUN.toString() },
    { attempts: 3, backoffDelayInMs: 5000 },
  );
  expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("holds admission lock through check, record creation and enqueue", async () => {
  await enqueue();
  expect(
    (Semaphore.lock as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan(
    (GoogleSecOpsConnectionRunService.findOneBy as jest.Mock).mock
      .invocationCallOrder[0]!,
  );
  expect(
    (GoogleSecOpsConnectionRunService.create as jest.Mock).mock
      .invocationCallOrder[0],
  ).toBeLessThan((Queue.addJob as jest.Mock).mock.invocationCallOrder[0]!);
  expect((Queue.addJob as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (Semaphore.release as jest.Mock).mock.invocationCallOrder[0]!,
  );
});
test("bounds outstanding runs before creating another job", async () => {
  (GoogleSecOpsConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    run,
  );
  await expect(enqueue()).rejects.toThrow("already has");
  expect(Queue.addJob).not.toHaveBeenCalled();
  expect(GoogleSecOpsConnectionRunService.create).not.toHaveBeenCalled();
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("records a queue failure without echoing queue credentials", async () => {
  (Queue.addJob as jest.Mock).mockRejectedValue(
    new Error("redis://password@internal"),
  );
  await expect(enqueue()).rejects.toThrow("could not be queued");
  expect(GoogleSecOpsConnectionRunService.updateOneById).toHaveBeenCalledWith({
    id: RUN,
    data: expect.objectContaining({
      status: "failed",
      error: "The operation could not be queued. Please try again.",
    }),
    props: { isRoot: true },
  });
});
test.each([null, { enableTelemetryFeatures: false }])(
  "denies disabled or missing reseller %j before queue admission",
  async (reseller: unknown) => {
    (ProjectService.findOneById as jest.Mock).mockResolvedValue({
      resellerId: USER,
    });
    (ResellerService.findOneById as jest.Mock).mockResolvedValue(reseller);
    await expect(enqueue()).rejects.toThrow("reseller plan");
    expect(Semaphore.lock).not.toHaveBeenCalled();
    expect(Queue.addJob).not.toHaveBeenCalled();
  },
);
test("allows enabled reseller telemetry", async () => {
  (ProjectService.findOneById as jest.Mock).mockResolvedValue({
    resellerId: USER,
  });
  await enqueue();
  expect(Queue.addJob).toHaveBeenCalledTimes(1);
});
test("denies a deleted project", async () => {
  (ProjectService.findOneById as jest.Mock).mockResolvedValue(null);
  await expect(enqueue()).rejects.toThrow("no longer exists");
  expect(Queue.addJob).not.toHaveBeenCalled();
});

test.each(["success", "empty", "partial", "failed"])(
  "persists %s outcomes and exact results",
  async (status: string) => {
    result.status = status as GoogleSecOpsRunStatus;
    result.error = status === "failed" ? "Read permission denied" : undefined;
    await GoogleSecOpsRunExecutor.executeRun(RUN);
    expect(
      GoogleSecOpsConnectionRunService.updateOneById,
    ).toHaveBeenNthCalledWith(1, {
      id: RUN,
      data: expect.objectContaining({
        status: "running",
        startedAt: expect.any(Date),
      }),
      props: { isRoot: true },
    });
    expect(
      GoogleSecOpsConnectionRunService.updateOneById,
    ).toHaveBeenLastCalledWith({
      id: RUN,
      data: {
        status,
        completedAt: new Date(result.completedAt),
        result,
        error: result.error || "",
      },
      props: { isRoot: true },
    });
    expect(GoogleSecOpsPoller.executeConnection).toHaveBeenCalledWith(
      connection,
      { type: "poll", runId: RUN.toString() },
    );
    expect(Semaphore.release).toHaveBeenCalledWith(lock);
  },
);
test("reads run status after locking and scopes credential read to recorded project", async () => {
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(
    (Semaphore.lock as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan(
    (GoogleSecOpsConnectionRunService.findOneById as jest.Mock).mock
      .invocationCallOrder[0]!,
  );
  expect(GoogleSecOpsConnectionService.findOneBy).toHaveBeenCalledWith(
    expect.objectContaining({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      props: { isRoot: true },
    }),
  );
});
test.each(["success", "empty", "partial", "failed"])(
  "does not repeat a terminal %s run",
  async (status: string) => {
    run.status = status as GoogleSecOpsRunStatus;
    await GoogleSecOpsRunExecutor.executeRun(RUN);
    expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
    expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
  },
);
test("ignores a run deleted before delivery", async () => {
  (GoogleSecOpsConnectionRunService.findOneById as jest.Mock).mockResolvedValue(
    null,
  );
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
});
test("retries an interrupted running operation after obtaining its exclusive lock", async () => {
  run.status = "running";
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).toHaveBeenCalledTimes(1);
});
test("reports a connection deleted while queued", async () => {
  (GoogleSecOpsConnectionService.findOneBy as jest.Mock).mockResolvedValue(
    null,
  );
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
  expect(GoogleSecOpsConnectionRunService.updateOneById).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("deleted"),
      }),
    }),
  );
});
test.each(["test", "poll", "preview", "backfill"])(
  "allows explicit %s on a disabled schedule",
  async (type: string) => {
    connection.isEnabled = false;
    run.type = type as GoogleSecOpsRunType;
    run.request = {
      type,
      ...(type === "preview" || type === "backfill"
        ? { startTime: START, endTime: END }
        : {}),
    };
    await GoogleSecOpsRunExecutor.executeRun(RUN);
    expect(GoogleSecOpsPoller.executeConnection).toHaveBeenCalledTimes(1);
  },
);
test("does not execute a queued scheduled poll after the schedule is disabled", async () => {
  connection.isEnabled = false;
  run.request = { type: "poll", scheduled: true };
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
});
test("rechecks reseller access in the worker before reading credentials", async () => {
  (ProjectService.findOneById as jest.Mock).mockResolvedValue({
    resellerId: USER,
  });
  (ResellerService.findOneById as jest.Mock).mockResolvedValue(null);
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
  expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
});
test("leaves result persistence failure retryable and releases the lock", async () => {
  (GoogleSecOpsConnectionRunService.updateOneById as jest.Mock)
    .mockResolvedValueOnce(run)
    .mockRejectedValueOnce(new Error("database unavailable"));
  await expect(GoogleSecOpsRunExecutor.executeRun(RUN)).rejects.toThrow(
    "database unavailable",
  );
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("records unexpected engine failure", async () => {
  (GoogleSecOpsPoller.executeConnection as jest.Mock).mockRejectedValue(
    new Error("A processing failure"),
  );
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(
    GoogleSecOpsConnectionRunService.updateOneById,
  ).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        error: "A processing failure",
      }),
    }),
  );
});
test("a failed lock does not touch credentials or execute work", async () => {
  (Semaphore.lock as jest.Mock).mockRejectedValue(
    new Error("Redis unavailable"),
  );
  await expect(GoogleSecOpsRunExecutor.executeRun(RUN)).rejects.toThrow(
    "Redis unavailable",
  );
  expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
  expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
});

test("expires a lost queued operation after twenty minutes", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  expect(await GoogleSecOpsRunExecutor.expireStaleRun(run)).toBe(true);
  expect(GoogleSecOpsConnectionRunService.updateOneBy).toHaveBeenCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({
        _id: RUN.toString(),
        status: expect.anything(),
        updatedAt: expect.anything(),
      }),
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("worker"),
      }),
    }),
  );
});
test("does not expire an active worker that still holds its refreshed mutex", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (Semaphore.lock as jest.Mock).mockRejectedValue(
    new SemaphoreLockTimeoutError("locked"),
  );
  expect(await GoogleSecOpsRunExecutor.expireStaleRun(run)).toBe(false);
  expect(GoogleSecOpsConnectionRunService.updateOneBy).not.toHaveBeenCalled();
});
test("does not expire a recent operation", async () => {
  expect(await GoogleSecOpsRunExecutor.expireStaleRun(run)).toBe(false);
  expect(Semaphore.lock).not.toHaveBeenCalled();
});
test("releases admission for a replacement after expiring a lost queued run", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (GoogleSecOpsConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    run,
  );
  await enqueue();
  expect(Queue.addJob).toHaveBeenCalledTimes(1);
});
test("scheduler queues only due connections and does not read credentials", async () => {
  connection.pollIntervalInMinutes = 5;
  connection.lastPolledAt = new Date(Date.now() - 6 * 60_000);
  const recent: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  recent.id = USER;
  recent.projectId = PROJECT;
  recent.lastPolledAt = new Date(Date.now() - 60_000);
  (GoogleSecOpsConnectionService.findBy as jest.Mock).mockResolvedValue([
    connection,
    recent,
  ]);
  const spy: jest.SpyInstance = jest
    .spyOn(GoogleSecOpsRunExecutor, "enqueue")
    .mockResolvedValue(RUN);
  await GoogleSecOpsRunExecutor.enqueueDueConnections();
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith({
    projectId: PROJECT,
    connectionId: CONNECTION,
    options: { type: "poll" },
    scheduled: true,
  });
  expect(GoogleSecOpsConnectionService.findBy).toHaveBeenCalledWith(
    expect.objectContaining({
      query: { isEnabled: true },
      select: {
        _id: true,
        projectId: true,
        pollIntervalInMinutes: true,
        lastPolledAt: true,
      },
    }),
  );
});
test("scheduler continues after a single connection fails admission", async () => {
  const nextConnection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  nextConnection.id = USER;
  nextConnection.projectId = PROJECT;
  (GoogleSecOpsConnectionService.findBy as jest.Mock).mockResolvedValue([
    connection,
    nextConnection,
  ]);
  const spy: jest.SpyInstance = jest
    .spyOn(GoogleSecOpsRunExecutor, "enqueue")
    .mockRejectedValueOnce(new Error("busy"))
    .mockResolvedValueOnce(RUN);
  await GoogleSecOpsRunExecutor.enqueueDueConnections();
  expect(spy).toHaveBeenCalledTimes(2);
});

function useCoordinatedLocks(): void {
  const pending: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  (Semaphore.lock as jest.Mock).mockImplementation(
    async (options: {
      namespace: string;
      key: string;
    }): Promise<SemaphoreMutex> => {
      const key: string = `${options.namespace}-${options.key}`;
      const previous: Promise<void> = pending.get(key) || Promise.resolve();
      let release: () => void = (): void => {};
      const held: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          release = resolve;
        },
      );
      pending.set(key, held);
      await previous;
      return { release } as unknown as SemaphoreMutex;
    },
  );
  (Semaphore.release as jest.Mock).mockImplementation(
    async (mutex: SemaphoreMutex): Promise<void> => {
      await mutex.release();
    },
  );
}

test("simultaneous button clicks admit exactly one operation", async () => {
  useCoordinatedLocks();
  let stored: GoogleSecOpsConnectionRun | null = null;
  (GoogleSecOpsConnectionRunService.findOneBy as jest.Mock).mockImplementation(
    async () => {
      return stored;
    },
  );
  (GoogleSecOpsConnectionRunService.create as jest.Mock).mockImplementation(
    async (data: { data: GoogleSecOpsConnectionRun }) => {
      data.data.id = RUN;
      data.data.createdAt = new Date(Date.now());
      stored = data.data;
      return stored;
    },
  );
  const outcomes: Array<PromiseSettledResult<ObjectID>> =
    await Promise.allSettled([enqueue(), enqueue()]);
  expect(
    outcomes
      .map((outcome: PromiseSettledResult<ObjectID>) => {
        return outcome.status;
      })
      .sort(),
  ).toEqual(["fulfilled", "rejected"]);
  expect(Queue.addJob).toHaveBeenCalledTimes(1);
  expect(GoogleSecOpsConnectionRunService.create).toHaveBeenCalledTimes(1);
});

test("concurrent duplicate deliveries recheck status under the lock and execute once", async () => {
  useCoordinatedLocks();
  (
    GoogleSecOpsConnectionRunService.updateOneById as jest.Mock
  ).mockImplementation(
    async (data: { data: Partial<GoogleSecOpsConnectionRun> }) => {
      Object.assign(run, data.data);
      return run;
    },
  );
  await Promise.all([
    GoogleSecOpsRunExecutor.executeRun(RUN),
    GoogleSecOpsRunExecutor.executeRun(RUN),
  ]);
  expect(GoogleSecOpsPoller.executeConnection).toHaveBeenCalledTimes(1);
  expect(run.status).toBe("success");
});

test("stale recovery cannot overwrite an operation completed before its lock was acquired", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (
    GoogleSecOpsConnectionRunService.updateOneBy as jest.Mock
  ).mockImplementation(
    async (data: { query: { status: { values: Array<string> } } }) => {
      /*
       * Model the conditional database write against a row completed after the
       * sweeper took its snapshot, while it was waiting for the run mutex.
       */
      expect(data.query.status.values).not.toContain("success");
      return 0;
    },
  );
  await GoogleSecOpsRunExecutor.expireStaleRun(run);
  expect(GoogleSecOpsConnectionRunService.updateOneById).not.toHaveBeenCalled();
});

test("reuses committed poll diagnostics after a run-history persistence failure", async () => {
  run.status = "running";
  connection.lastPollResult = {
    ...result,
    runId: RUN.toString(),
  } as unknown as JSONObject;
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).not.toHaveBeenCalled();
  expect(GoogleSecOpsConnectionRunService.updateOneById).toHaveBeenCalledTimes(
    1,
  );
  expect(GoogleSecOpsConnectionRunService.updateOneById).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "success",
        result: expect.objectContaining({
          ingestedCount: 1,
          windowStart: "2026-09-10T11:45:00Z",
        }),
      }),
    }),
  );
});

test("never reuses a poll result belonging to an older operation", async () => {
  run.status = "running";
  connection.lastPollResult = {
    ...result,
    runId: USER.toString(),
  } as unknown as JSONObject;
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).toHaveBeenCalledTimes(1);
});

test("the worker owns the checkpoint ID even if a stored request contains another run ID", async () => {
  run.request = { type: "poll", runId: USER.toString() };
  await GoogleSecOpsRunExecutor.executeRun(RUN);
  expect(GoogleSecOpsPoller.executeConnection).toHaveBeenCalledWith(
    connection,
    { type: "poll", runId: RUN.toString() },
  );
});

test("a refreshed running operation still blocks admission when stale expiry matched nothing", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (GoogleSecOpsConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    run,
  );
  (GoogleSecOpsConnectionRunService.updateOneBy as jest.Mock).mockResolvedValue(
    0,
  );
  (GoogleSecOpsConnectionRunService.findOneById as jest.Mock).mockResolvedValue(
    { status: "running" },
  );
  await expect(enqueue()).rejects.toThrow("already has");
  expect(Queue.addJob).not.toHaveBeenCalled();
  expect(GoogleSecOpsConnectionRunService.create).not.toHaveBeenCalled();
});
