import SecurityEventConnectionRunExecutor, {
  SECURITY_EVENT_CONNECTION_RUN_JOB,
  SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import SecurityEventConnectionPoller from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectionRunService from "../../../../../Server/Services/SecurityEventConnectionRunService";
import SecurityEventConnectionService from "../../../../../Server/Services/SecurityEventConnectionService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ResellerService from "../../../../../Server/Services/ResellerService";
import Queue, { QueueName } from "../../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../../Server/Utils/Logger";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import {
  SecurityEventConnectionRunResult,
  SecurityEventConnectionRunStatus,
  SecurityEventConnectionRunType,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * The run executor is the admission control and bookkeeping around every
 * operation on a Security Event Connection, Google SecOps included (its
 * own executor and that executor's suite were retired when it moved into
 * the framework). Pinned here as well: a scheduler that stamps its own
 * failures on the connection row, and markRunFailed for the queue job's
 * last attempt.
 */

jest.mock(
  "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller",
  () => {
    return { __esModule: true, default: { executeConnection: jest.fn() } };
  },
);
jest.mock(
  "../../../../../Server/Services/SecurityEventConnectionRunService",
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
  "../../../../../Server/Services/SecurityEventConnectionService",
  () => {
    return {
      __esModule: true,
      default: {
        findOneBy: jest.fn(),
        findBy: jest.fn(),
        updateOneById: jest.fn(),
      },
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
jest.mock("../../../../../Server/Utils/Logger", () => {
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

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SECRET_VALUE: string = "client-secret-0badf00d";
const lock: SemaphoreMutex = {} as SemaphoreMutex;
let run: SecurityEventConnectionRun;
let connection: SecurityEventConnection;
let result: SecurityEventConnectionRunResult;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-10T12:00:00Z"));
  run = new SecurityEventConnectionRun();
  run.id = RUN;
  run.projectId = PROJECT;
  run.securityEventConnectionId = CONNECTION;
  run.type = "poll";
  run.status = "queued";
  run.request = { type: "poll" };
  run.createdAt = new Date(Date.now());
  run.updatedAt = new Date(Date.now());
  connection = new SecurityEventConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.provider = SecurityEventConnectorProvider.OktaSystemLog;
  connection.isEnabled = true;
  connection.secrets = JSON.stringify({ apiToken: SECRET_VALUE });
  result = {
    type: "poll",
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    status: "success",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T12:00:00Z",
    durationMs: 60_000,
    windowStart: "2026-09-10T11:45:00Z",
    windowEnd: "2026-09-10T12:00:00Z",
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
  (SecurityEventConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    null,
  );
  (
    SecurityEventConnectionRunService.findOneById as jest.Mock
  ).mockImplementation(async () => {
    return run;
  });
  (SecurityEventConnectionRunService.findBy as jest.Mock).mockResolvedValue([]);
  (SecurityEventConnectionRunService.create as jest.Mock).mockImplementation(
    async (data: { data: SecurityEventConnectionRun }) => {
      data.data.id = RUN;
      return data.data;
    },
  );
  (
    SecurityEventConnectionRunService.updateOneById as jest.Mock
  ).mockResolvedValue(run);
  (
    SecurityEventConnectionRunService.updateOneBy as jest.Mock
  ).mockResolvedValue(1);
  (SecurityEventConnectionService.findOneBy as jest.Mock).mockResolvedValue(
    connection,
  );
  (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([]);
  (SecurityEventConnectionService.updateOneById as jest.Mock).mockResolvedValue(
    undefined,
  );
  (
    SecurityEventConnectionPoller.executeConnection as jest.Mock
  ).mockImplementation(async () => {
    return result;
  });
  (Queue.addJob as jest.Mock).mockResolvedValue({});
});
afterEach(() => {
  jest.restoreAllMocks();
});

test("the job name and timeout are what the worker registers", () => {
  expect(SECURITY_EVENT_CONNECTION_RUN_JOB).toBe(
    "SecurityEvents:RunSecurityEventConnection",
  );
  expect(SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS).toBe(10 * 60 * 1000);
});

const START: string = "2026-09-09T00:00:00Z";
const END: string = "2026-09-10T00:00:00Z";
test.each(["test", "poll"])(
  "validates %s without historical fields and strips unrelated body data",
  (type: string) => {
    expect(
      SecurityEventConnectionRunExecutor.validateOptions({
        type,
        secrets: "secret",
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
      SecurityEventConnectionRunExecutor.validateOptions({
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
  undefined,
  "poll",
  [],
  {},
  { type: "delete" },
  { type: "POLL" },
  { type: "poll", startTime: START },
  { type: "test", endTime: END },
  { type: "preview" },
  { type: "backfill", startTime: START },
  { type: "backfill", startTime: START, endTime: "invalid" },
  { type: "preview", startTime: START, endTime: START },
  { type: "preview", startTime: END, endTime: START },
  { type: "preview", startTime: "2026-09-01T00:00:00Z", endTime: END },
  { type: "preview", startTime: START, endTime: "2026-09-11T00:00:00Z" },
  { type: "preview", startTime: "2026-09-09", endTime: END },
  { type: "preview", startTime: "2026-09-09T00:00:00", endTime: END },
  { type: "preview", startTime: 0, endTime: END },
])("rejects invalid requests %j", (input: unknown) => {
  expect(() => {
    SecurityEventConnectionRunExecutor.validateOptions(input);
  }).toThrow();
});
test("accepts exactly seven days and an end equal to now", () => {
  expect(
    SecurityEventConnectionRunExecutor.validateOptions({
      type: "backfill",
      startTime: "2026-09-03T12:00:00Z",
      endTime: "2026-09-10T12:00:00Z",
    }).type,
  ).toBe("backfill");
});

async function enqueue(): Promise<ObjectID> {
  return SecurityEventConnectionRunExecutor.enqueue({
    projectId: PROJECT,
    connectionId: CONNECTION,
    options: { type: "test" },
    requestedByUserId: USER,
  });
}

test("records a queued operation before routing only its ID to the Worker queue", async () => {
  expect(await enqueue()).toEqual(RUN);
  expect(SecurityEventConnectionRunService.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      projectId: PROJECT,
      securityEventConnectionId: CONNECTION,
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
    SECURITY_EVENT_CONNECTION_RUN_JOB,
    { runId: RUN.toString() },
    { attempts: 3, backoffDelayInMs: 5000 },
  );
  // The payload is the run ID and nothing else: no settings, no secrets.
  const payload: JSONObject = (Queue.addJob as jest.Mock).mock
    .calls[0]![3] as JSONObject;
  expect(Object.keys(payload)).toEqual(["runId"]);
  expect(JSON.stringify(payload)).not.toContain(SECRET_VALUE);
  expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("holds admission lock through check, record creation and enqueue", async () => {
  await enqueue();
  expect(Semaphore.lock).toHaveBeenCalledWith(
    expect.objectContaining({
      namespace: "SecurityEventConnectionRunAdmission",
      key: CONNECTION.toString(),
    }),
  );
  expect(
    (Semaphore.lock as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan(
    (SecurityEventConnectionRunService.findOneBy as jest.Mock).mock
      .invocationCallOrder[0]!,
  );
  expect(
    (SecurityEventConnectionRunService.create as jest.Mock).mock
      .invocationCallOrder[0],
  ).toBeLessThan((Queue.addJob as jest.Mock).mock.invocationCallOrder[0]!);
  expect((Queue.addJob as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (Semaphore.release as jest.Mock).mock.invocationCallOrder[0]!,
  );
});
test("bounds outstanding runs before creating another job", async () => {
  (SecurityEventConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    run,
  );
  await expect(enqueue()).rejects.toThrow(
    "already has a queued or running operation",
  );
  expect(SecurityEventConnectionRunService.findOneBy).toHaveBeenCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({
        projectId: PROJECT,
        securityEventConnectionId: CONNECTION,
      }),
      props: { isRoot: true },
    }),
  );
  expect(Queue.addJob).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.create).not.toHaveBeenCalled();
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("records a queue failure without echoing queue credentials", async () => {
  (Queue.addJob as jest.Mock).mockRejectedValue(
    new Error("redis://password@internal"),
  );
  await expect(enqueue()).rejects.toThrow("could not be queued");
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith({
    id: RUN,
    data: expect.objectContaining({
      status: "failed",
      error: "The operation could not be queued. Please try again.",
    }),
    props: { isRoot: true },
  });
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
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
test("invalid options are rejected before any project or lock access", async () => {
  await expect(
    SecurityEventConnectionRunExecutor.enqueue({
      projectId: PROJECT,
      connectionId: CONNECTION,
      options: { type: "preview" },
    }),
  ).rejects.toThrow("startTime and endTime");
  expect(ProjectService.findOneById).not.toHaveBeenCalled();
  expect(Semaphore.lock).not.toHaveBeenCalled();
});

test.each(["success", "empty", "partial", "failed"])(
  "persists %s outcomes and exact results",
  async (status: string) => {
    result.status = status as SecurityEventConnectionRunStatus;
    if (status === "failed") {
      result.error = "Read permission denied";
    } else {
      delete result.error;
    }
    await SecurityEventConnectionRunExecutor.executeRun(RUN);
    expect(
      SecurityEventConnectionRunService.updateOneById,
    ).toHaveBeenNthCalledWith(1, {
      id: RUN,
      data: expect.objectContaining({
        status: "running",
        startedAt: expect.any(Date),
        error: "",
      }),
      props: { isRoot: true },
    });
    expect(
      SecurityEventConnectionRunService.updateOneById,
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
    expect(
      SecurityEventConnectionPoller.executeConnection,
    ).toHaveBeenCalledWith(connection, { type: "poll", runId: RUN.toString() });
    expect(Semaphore.release).toHaveBeenCalledWith(lock);
  },
);
test("reads run status after locking and scopes the credential read to the recorded project", async () => {
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(Semaphore.lock).toHaveBeenCalledWith(
    expect.objectContaining({
      namespace: "SecurityEventConnectionRun",
      key: RUN.toString(),
    }),
  );
  expect(
    (Semaphore.lock as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan(
    (SecurityEventConnectionRunService.findOneById as jest.Mock).mock
      .invocationCallOrder[0]!,
  );
  expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledWith(
    expect.objectContaining({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: expect.objectContaining({
        provider: true,
        config: true,
        secrets: true,
        alertingOnly: true,
        cursor: true,
        isEnabled: true,
        /*
         * The previous poll's result carries the next catch-up chunk
         * (nextChunkMinutes) and the forced-advance overlapFloor; without it
         * every poll restarts at a full day and an overflowing window never
         * narrows. The interval reaches an unlocked preview, where the
         * poller does not reload the row, for creation-lag statistics.
         */
        lastPollResult: true,
        pollIntervalInMinutes: true,
      }),
      props: { isRoot: true },
    }),
  );
});
test.each(["success", "empty", "partial", "failed"])(
  "does not repeat a terminal %s run",
  async (status: string) => {
    run.status = status as SecurityEventConnectionRunStatus;
    await SecurityEventConnectionRunExecutor.executeRun(RUN);
    expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
    expect(
      SecurityEventConnectionPoller.executeConnection,
    ).not.toHaveBeenCalled();
    expect(
      SecurityEventConnectionRunService.updateOneById,
    ).not.toHaveBeenCalled();
  },
);
test("ignores a run deleted before delivery", async () => {
  (
    SecurityEventConnectionRunService.findOneById as jest.Mock
  ).mockResolvedValue(null);
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("a run row missing its project or connection is failed without executing", async () => {
  delete run.securityEventConnectionId;
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith({
    id: RUN,
    data: expect.objectContaining({
      status: "failed",
      error: "The connection is no longer available.",
    }),
    props: { isRoot: true },
  });
});
test("retries an interrupted running operation after obtaining its exclusive lock", async () => {
  run.status = "running";
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(SecurityEventConnectionPoller.executeConnection).toHaveBeenCalledTimes(
    1,
  );
});
test("reports a connection deleted while queued", async () => {
  (SecurityEventConnectionService.findOneBy as jest.Mock).mockResolvedValue(
    null,
  );
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith(
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
    run.type = type as SecurityEventConnectionRunType;
    run.request = {
      type,
      ...(type === "preview" || type === "backfill"
        ? { startTime: START, endTime: END }
        : {}),
    };
    await SecurityEventConnectionRunExecutor.executeRun(RUN);
    expect(
      SecurityEventConnectionPoller.executeConnection,
    ).toHaveBeenCalledTimes(1);
  },
);
test("a queued scheduled poll on a disabled connection fails cleanly instead of executing", async () => {
  connection.isEnabled = false;
  run.request = { type: "poll", scheduled: true };
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledTimes(
    1,
  );
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith({
    id: RUN,
    data: expect.objectContaining({
      status: "failed",
      completedAt: expect.any(Date),
      error: expect.stringContaining("scheduled polling was disabled"),
    }),
    props: { isRoot: true },
  });
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("rechecks reseller access in the worker before reading credentials", async () => {
  (ProjectService.findOneById as jest.Mock).mockResolvedValue({
    resellerId: USER,
  });
  (ResellerService.findOneById as jest.Mock).mockResolvedValue(null);
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("reseller plan"),
      }),
    }),
  );
});
test("a stored request that no longer validates fails the run instead of throwing", async () => {
  run.request = { type: "preview" };
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("startTime and endTime"),
      }),
    }),
  );
});
test("leaves result persistence failure retryable and releases the lock", async () => {
  (SecurityEventConnectionRunService.updateOneById as jest.Mock)
    .mockResolvedValueOnce(run)
    .mockRejectedValueOnce(new Error("database unavailable"));
  await expect(
    SecurityEventConnectionRunExecutor.executeRun(RUN),
  ).rejects.toThrow("database unavailable");
  expect(Semaphore.release).toHaveBeenCalledWith(lock);
});
test("records an unexpected engine failure, redacted", async () => {
  (
    SecurityEventConnectionPoller.executeConnection as jest.Mock
  ).mockRejectedValue(
    new Error(`A processing failure: client_secret=${SECRET_VALUE}`),
  );
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  const written: { data: JSONObject } = (
    SecurityEventConnectionRunService.updateOneById as jest.Mock
  ).mock.calls.slice(-1)[0]![0] as { data: JSONObject };
  expect(written.data["status"]).toBe("failed");
  expect(written.data["error"]).toContain("A processing failure");
  expect(written.data["error"]).not.toContain(SECRET_VALUE);
});
test("the poller's own 'still running' contention message is what the run row gets", async () => {
  (
    SecurityEventConnectionPoller.executeConnection as jest.Mock
  ).mockRejectedValue(
    new Error(
      "Another poll or import for this source is still running in this project. This run was skipped; polling continues on the next scheduled tick.",
    ),
  );
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionRunService.updateOneById,
  ).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringMatching(
          /^Another poll or import for this source is still running/,
        ),
      }),
    }),
  );
});
test("a failed lock does not touch credentials or execute work", async () => {
  (Semaphore.lock as jest.Mock).mockRejectedValue(
    new Error("Redis unavailable"),
  );
  await expect(
    SecurityEventConnectionRunExecutor.executeRun(RUN),
  ).rejects.toThrow("Redis unavailable");
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
  expect(
    SecurityEventConnectionRunService.updateOneById,
  ).not.toHaveBeenCalled();
});
test("a release failure is logged, never thrown", async () => {
  (Semaphore.release as jest.Mock).mockRejectedValue(new Error("expired"));
  await expect(
    SecurityEventConnectionRunExecutor.executeRun(RUN),
  ).resolves.toBeUndefined();
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining("run lock could not be released"),
  );
});

test("markRunFailed records the queue job's final failure on the run row", async () => {
  await SecurityEventConnectionRunExecutor.markRunFailed(
    RUN,
    "Run lock could not be acquired.",
  );
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledTimes(
    1,
  );
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith({
    id: RUN,
    data: {
      status: "failed",
      completedAt: expect.any(Date),
      error: "Run lock could not be acquired.",
    },
    props: { isRoot: true },
  });
  expect(Semaphore.lock).not.toHaveBeenCalled();
});
test("markRunFailed propagates a database failure to the caller", async () => {
  (
    SecurityEventConnectionRunService.updateOneById as jest.Mock
  ).mockRejectedValue(new Error("database unavailable"));
  await expect(
    SecurityEventConnectionRunExecutor.markRunFailed(RUN, "boom"),
  ).rejects.toThrow("database unavailable");
});

test("expires a lost queued operation after twenty minutes", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  expect(await SecurityEventConnectionRunExecutor.expireStaleRun(run)).toBe(
    true,
  );
  expect(SecurityEventConnectionRunService.updateOneBy).toHaveBeenCalledWith(
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
  expect(await SecurityEventConnectionRunExecutor.expireStaleRun(run)).toBe(
    false,
  );
  expect(SecurityEventConnectionRunService.updateOneBy).not.toHaveBeenCalled();
});
test("does not expire a recent operation", async () => {
  expect(await SecurityEventConnectionRunExecutor.expireStaleRun(run)).toBe(
    false,
  );
  expect(Semaphore.lock).not.toHaveBeenCalled();
});
test("falls back to createdAt when a run was never updated", async () => {
  delete run.updatedAt;
  run.createdAt = new Date(Date.now() - 21 * 60_000);
  expect(await SecurityEventConnectionRunExecutor.expireStaleRun(run)).toBe(
    true,
  );
});
test("releases admission for a replacement after expiring a lost queued run", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (SecurityEventConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    run,
  );
  await enqueue();
  expect(Queue.addJob).toHaveBeenCalledTimes(1);
});

describe("enqueueDueConnections", () => {
  test("queues only due connections, without reading credentials, and expires stale runs first", async () => {
    connection.pollIntervalInMinutes = 5;
    connection.lastPolledAt = new Date(Date.now() - 6 * 60_000);
    const recent: SecurityEventConnection = new SecurityEventConnection();
    recent.id = USER;
    recent.projectId = PROJECT;
    recent.lastPolledAt = new Date(Date.now() - 60_000);
    const neverPolled: SecurityEventConnection = new SecurityEventConnection();
    neverPolled.id = RUN;
    neverPolled.projectId = PROJECT;
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      connection,
      recent,
      neverPolled,
    ]);
    const staleRun: SecurityEventConnectionRun =
      new SecurityEventConnectionRun();
    staleRun.id = USER;
    staleRun.updatedAt = new Date(Date.now() - 25 * 60_000);
    (SecurityEventConnectionRunService.findBy as jest.Mock).mockResolvedValue([
      staleRun,
    ]);
    const expireSpy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "expireStaleRun")
      .mockResolvedValue(true);
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockResolvedValue(RUN);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    expect(expireSpy).toHaveBeenCalledWith(staleRun);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, {
      projectId: PROJECT,
      connectionId: CONNECTION,
      options: { type: "poll" },
      scheduled: true,
    });
    expect(spy).toHaveBeenNthCalledWith(2, {
      projectId: PROJECT,
      connectionId: RUN,
      options: { type: "poll" },
      scheduled: true,
    });
    expect(SecurityEventConnectionService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
        },
        props: { isRoot: true },
      }),
    );
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("a zero interval is read as the five minute default", async () => {
    connection.pollIntervalInMinutes = 0;
    connection.lastPolledAt = new Date(Date.now() - 2 * 60_000);
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      connection,
    ]);
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockResolvedValue(RUN);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    expect(spy).not.toHaveBeenCalled();
  });

  test("a stale-run recovery failure is logged and does not stop the scheduler", async () => {
    const staleRun: SecurityEventConnectionRun =
      new SecurityEventConnectionRun();
    staleRun.id = USER;
    (SecurityEventConnectionRunService.findBy as jest.Mock).mockResolvedValue([
      staleRun,
    ]);
    jest
      .spyOn(SecurityEventConnectionRunExecutor, "expireStaleRun")
      .mockRejectedValue(new Error("Redis unavailable"));
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      connection,
    ]);
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockResolvedValue(RUN);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not recover an interrupted operation"),
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("an admission conflict is the quiet steady state: debug log, no error, nothing stamped", async () => {
    const nextConnection: SecurityEventConnection =
      new SecurityEventConnection();
    nextConnection.id = USER;
    nextConnection.projectId = PROJECT;
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      connection,
      nextConnection,
    ]);
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockRejectedValueOnce(
        new Error(
          "This connection already has a queued or running operation. Open run history for its progress.",
        ),
      )
      .mockResolvedValueOnce(RUN);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(CONNECTION.toString()),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("any other admission failure is logged at error and stamped on the connection, redacted, and the loop continues", async () => {
    const nextConnection: SecurityEventConnection =
      new SecurityEventConnection();
    nextConnection.id = USER;
    nextConnection.projectId = PROJECT;
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      connection,
      nextConnection,
    ]);
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockRejectedValueOnce(
        new Error(`Redis refused: redis://default:${SECRET_VALUE}@redis:6379`),
      )
      .mockResolvedValueOnce(RUN);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not queue the scheduled poll"),
    );
    expect(SecurityEventConnectionService.updateOneById).toHaveBeenCalledTimes(
      1,
    );
    const written: { id: ObjectID; data: JSONObject } = (
      SecurityEventConnectionService.updateOneById as jest.Mock
    ).mock.calls[0]![0] as { id: ObjectID; data: JSONObject };
    expect(written.id).toEqual(CONNECTION);
    expect(written.data["lastError"]).toMatch(
      /^Scheduler could not queue a poll: /,
    );
    expect(written.data["lastError"]).toContain("Redis refused");
    expect(written.data["lastError"]).not.toContain(SECRET_VALUE);
  });

  test("a failed stamp write is swallowed so the remaining connections are still scheduled", async () => {
    const nextConnection: SecurityEventConnection =
      new SecurityEventConnection();
    nextConnection.id = USER;
    nextConnection.projectId = PROJECT;
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      connection,
      nextConnection,
    ]);
    (
      SecurityEventConnectionService.updateOneById as jest.Mock
    ).mockRejectedValue(new Error("deadlock detected"));
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValueOnce(RUN);

    await expect(
      SecurityEventConnectionRunExecutor.enqueueDueConnections(),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(SecurityEventConnectionService.updateOneById).toHaveBeenCalledTimes(
      1,
    );
  });

  test("a connection missing its id or project is skipped, not stamped", async () => {
    const withoutId: SecurityEventConnection = new SecurityEventConnection();
    withoutId.projectId = PROJECT;
    const withoutProject: SecurityEventConnection =
      new SecurityEventConnection();
    withoutProject.id = USER;
    (SecurityEventConnectionService.findBy as jest.Mock).mockResolvedValue([
      withoutId,
      withoutProject,
    ]);
    const spy: jest.SpyInstance = jest
      .spyOn(SecurityEventConnectionRunExecutor, "enqueue")
      .mockResolvedValue(RUN);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    expect(spy).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });
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
  let stored: SecurityEventConnectionRun | null = null;
  (SecurityEventConnectionRunService.findOneBy as jest.Mock).mockImplementation(
    async () => {
      return stored;
    },
  );
  (SecurityEventConnectionRunService.create as jest.Mock).mockImplementation(
    async (data: { data: SecurityEventConnectionRun }) => {
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
  expect(SecurityEventConnectionRunService.create).toHaveBeenCalledTimes(1);
});

test("concurrent duplicate deliveries recheck status under the lock and execute once", async () => {
  useCoordinatedLocks();
  (
    SecurityEventConnectionRunService.updateOneById as jest.Mock
  ).mockImplementation(
    async (data: { data: Partial<SecurityEventConnectionRun> }) => {
      Object.assign(run, data.data);
      return run;
    },
  );
  await Promise.all([
    SecurityEventConnectionRunExecutor.executeRun(RUN),
    SecurityEventConnectionRunExecutor.executeRun(RUN),
  ]);
  expect(SecurityEventConnectionPoller.executeConnection).toHaveBeenCalledTimes(
    1,
  );
  expect(run.status).toBe("success");
});

test("stale recovery cannot overwrite an operation completed before its lock was acquired", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (
    SecurityEventConnectionRunService.updateOneBy as jest.Mock
  ).mockImplementation(
    async (data: { query: { status: { values: Array<string> } } }) => {
      expect(data.query.status.values).not.toContain("success");
      return 0;
    },
  );
  (
    SecurityEventConnectionRunService.findOneById as jest.Mock
  ).mockResolvedValue({ status: "success" });
  expect(await SecurityEventConnectionRunExecutor.expireStaleRun(run)).toBe(
    true,
  );
  expect(
    SecurityEventConnectionRunService.updateOneById,
  ).not.toHaveBeenCalled();
});

test("reuses committed poll diagnostics after a run-history persistence failure", async () => {
  run.status = "running";
  connection.lastPollResult = {
    ...result,
    runId: RUN.toString(),
  } as unknown as JSONObject;
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(
    SecurityEventConnectionPoller.executeConnection,
  ).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledTimes(
    1,
  );
  expect(SecurityEventConnectionRunService.updateOneById).toHaveBeenCalledWith(
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

test.each<
  [
    string,
    JSONObject | undefined,
    SecurityEventConnectionRunStatus,
    SecurityEventConnectionRunType,
  ]
>([
  ["a result of an older run", { runId: USER.toString() }, "running", "poll"],
  ["a queued run (never started)", { runId: RUN.toString() }, "queued", "poll"],
  ["a non-poll run", { runId: RUN.toString() }, "running", "backfill"],
  [
    "a result of another type",
    { runId: RUN.toString(), type: "backfill" },
    "running",
    "poll",
  ],
  [
    "a result still marked running",
    { runId: RUN.toString(), status: "running" },
    "running",
    "poll",
  ],
  [
    "a result without a completion time",
    { runId: RUN.toString(), completedAt: "" },
    "running",
    "poll",
  ],
  ["no stored result", undefined, "running", "poll"],
])(
  "never replays %s",
  async (
    _label: string,
    stored: JSONObject | undefined,
    status: SecurityEventConnectionRunStatus,
    type: SecurityEventConnectionRunType,
  ) => {
    run.status = status;
    run.type = type;
    run.request =
      type === "backfill" ? { type, startTime: START, endTime: END } : { type };
    if (stored) {
      connection.lastPollResult = {
        ...result,
        ...stored,
      } as unknown as JSONObject;
    } else {
      delete connection.lastPollResult;
    }
    await SecurityEventConnectionRunExecutor.executeRun(RUN);
    expect(
      SecurityEventConnectionPoller.executeConnection,
    ).toHaveBeenCalledTimes(1);
  },
);

test("the worker owns the checkpoint ID even if a stored request contains another run ID", async () => {
  run.request = { type: "poll", runId: USER.toString() };
  await SecurityEventConnectionRunExecutor.executeRun(RUN);
  expect(SecurityEventConnectionPoller.executeConnection).toHaveBeenCalledWith(
    connection,
    { type: "poll", runId: RUN.toString() },
  );
});

test("a refreshed running operation still blocks admission when stale expiry matched nothing", async () => {
  run.updatedAt = new Date(Date.now() - 21 * 60_000);
  (SecurityEventConnectionRunService.findOneBy as jest.Mock).mockResolvedValue(
    run,
  );
  (
    SecurityEventConnectionRunService.updateOneBy as jest.Mock
  ).mockResolvedValue(0);
  (
    SecurityEventConnectionRunService.findOneById as jest.Mock
  ).mockResolvedValue({ status: "running" });
  await expect(enqueue()).rejects.toThrow("already has");
  expect(Queue.addJob).not.toHaveBeenCalled();
  expect(SecurityEventConnectionRunService.create).not.toHaveBeenCalled();
});
