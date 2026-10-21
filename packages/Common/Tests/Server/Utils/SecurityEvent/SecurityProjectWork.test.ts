import SecurityProjectWork, {
  SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS,
  SECURITY_PROJECT_WORK_PERMIT_WAIT_IN_MS,
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  SecurityProjectWorkOutcome,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
import Queue, { QueueJob } from "../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
  SemaphorePermit,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock` types
 * below must resolve to the @types/jest global namespace, as the jest.fn()
 * and jest.mock() calls do (the SecurityEventConnectionRunExecutor pattern).
 */

/*
 * How the security pipeline spreads its work (SecurityProjectWork): a cron
 * queues one job per project, deduplicated so a project never waits twice;
 * a job holds the project's lease (kept between items, so a job BullMQ
 * starts again after a stall finds it held), takes one permit from a pool
 * every worker shares, and starts new items only for its time budget.
 * Valkey and the queue are stubbed.
 */

jest.mock("../../../../Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Worker: "Worker" },
  };
});
jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      keepLock: jest.fn(),
      release: jest.fn(),
      acquirePermit: jest.fn(),
      releasePermit: jest.fn(),
    },
  };
});
jest.mock("../../../../Server/Utils/Logger", () => {
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

const WORK: SecurityProjectWorkDefinition = {
  jobName: "DetectionRules:EvaluateProject",
  key: "detection-rules",
  maxConcurrentProjects: 16,
};
const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const NOW: Date = new Date("2026-10-21T12:34:56.000Z");
const MINUTE: number = Math.floor(NOW.getTime() / 60000);

const mutex: SemaphoreMutex = { identifier: "lease" } as SemaphoreMutex;
const permit: SemaphorePermit = { identifier: "permit" } as SemaphorePermit;

const addJob: jest.Mock = Queue.addJob as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const keepLock: jest.Mock = Semaphore.keepLock as unknown as jest.Mock;
const release: jest.Mock = Semaphore.release as unknown as jest.Mock;
const acquirePermit: jest.Mock = Semaphore.acquirePermit as unknown as jest.Mock;
const releasePermit: jest.Mock = Semaphore.releasePermit as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  addJob.mockResolvedValue(undefined as never);
  lock.mockResolvedValue(mutex as never);
  keepLock.mockResolvedValue(true as never);
  release.mockResolvedValue(undefined as never);
  acquirePermit.mockResolvedValue(permit as never);
  releasePermit.mockResolvedValue(undefined as never);
});

describe("SecurityProjectWork.enqueueProjects", () => {
  test("queues one job per project, once each, deduplicated by project", async () => {
    const queued: number = await SecurityProjectWork.enqueueProjects(
      WORK,
      [PROJECT_A, undefined, PROJECT_B, new ObjectID(PROJECT_A.toString())],
      NOW,
    );

    expect(queued).toBe(2);
    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(
      1,
      "Worker",
      `detection-rules-${PROJECT_A.toString()}-${MINUTE}`,
      "DetectionRules:EvaluateProject",
      // The payload is the project id only: the job reads the rest itself.
      { projectId: PROJECT_A.toString() },
      {
        attempts: 1,
        // At most one turn per project waiting or running, however many ticks queue it.
        deduplication: { id: `detection-rules-${PROJECT_A.toString()}` },
      },
    );
    expect(addJob.mock.calls[1]?.[3]).toEqual({
      projectId: PROJECT_B.toString(),
    });
  });

  test("a project the queue refuses is logged, and the rest are still queued", async () => {
    addJob.mockRejectedValueOnce(new Error("Valkey is down") as never);

    const queued: number = await SecurityProjectWork.enqueueProjects(
      WORK,
      [PROJECT_A, PROJECT_B],
      NOW,
    );

    expect(queued).toBe(1);
    expect(addJob).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(PROJECT_A.toString()),
    );
  });

  test("a job id names the work, the project and the minute", () => {
    expect(SecurityProjectWork.jobIdOf(WORK, PROJECT_A, NOW)).toBe(
      `detection-rules-${PROJECT_A.toString()}-${MINUTE}`,
    );
    // The same minute, the same id; the next minute, a new one.
    expect(
      SecurityProjectWork.jobIdOf(
        WORK,
        PROJECT_A,
        new Date(NOW.getTime() + 3000),
      ),
    ).toBe(SecurityProjectWork.jobIdOf(WORK, PROJECT_A, NOW));
    expect(
      SecurityProjectWork.jobIdOf(
        WORK,
        PROJECT_A,
        new Date(NOW.getTime() + 60000),
      ),
    ).not.toBe(SecurityProjectWork.jobIdOf(WORK, PROJECT_A, NOW));
  });
});

describe("SecurityProjectWork.projectIdOfJob", () => {
  test("reads the project from the job's payload", () => {
    expect(
      SecurityProjectWork.projectIdOfJob({
        data: { projectId: PROJECT_A.toString() },
      } as unknown as QueueJob).toString(),
    ).toBe(PROJECT_A.toString());
  });

  test.each([
    ["no job", undefined],
    ["no payload", {}],
    ["no project", { data: {} }],
    ["a project that is not an id", { data: { projectId: "not-an-id" } }],
    ["a project that is not a string", { data: { projectId: 42 } }],
  ])("refuses %s", (_label: string, job: unknown) => {
    expect(() => {
      SecurityProjectWork.projectIdOfJob(job as QueueJob | undefined);
    }).toThrow("A valid project ID is required.");
  });
});

describe("SecurityProjectWork.runForProject", () => {
  test("takes the project's lease, then a permit from the shared pool, runs the turn, and gives both back", async () => {
    const turn: jest.Mock = jest.fn(async (): Promise<void> => {
      // The lease and the permit are held while the turn runs.
      expect(release).not.toHaveBeenCalled();
      expect(releasePermit).not.toHaveBeenCalled();
    });

    const outcome: SecurityProjectWorkOutcome =
      await SecurityProjectWork.runForProject(
        WORK,
        PROJECT_A,
        turn as unknown as (lease: SecurityProjectWorkLease) => Promise<void>,
      );

    expect(outcome).toBe("Done");
    expect(turn).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith({
      namespace: "detection-rules-lease",
      key: PROJECT_A.toString(),
      lockTimeout: SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS,
      acquireAttemptsLimit: 1,
      // Held only while kept: a job that stops keeping it lets go.
      refreshInterval: 0,
    });
    expect(acquirePermit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "detection-rules-permit",
        key: "projects",
        limit: 16,
        acquireTimeout: SECURITY_PROJECT_WORK_PERMIT_WAIT_IN_MS,
      }),
    );
    expect(releasePermit).toHaveBeenCalledWith(permit);
    expect(release).toHaveBeenCalledWith(mutex);
  });

  test("a project whose lease another job holds is left to it", async () => {
    lock.mockRejectedValue(new Error("lock is held") as never);
    const turn: jest.Mock = jest.fn();

    const outcome: SecurityProjectWorkOutcome =
      await SecurityProjectWork.runForProject(
        WORK,
        PROJECT_A,
        turn as unknown as (lease: SecurityProjectWorkLease) => Promise<void>,
      );

    expect(outcome).toBe("Busy");
    expect(turn).not.toHaveBeenCalled();
    expect(acquirePermit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("a project that gets no permit in time waits for the next minute, and gives its lease back", async () => {
    acquirePermit.mockRejectedValue(new Error("timed out") as never);
    const turn: jest.Mock = jest.fn();

    const outcome: SecurityProjectWorkOutcome =
      await SecurityProjectWork.runForProject(
        WORK,
        PROJECT_A,
        turn as unknown as (lease: SecurityProjectWorkLease) => Promise<void>,
      );

    expect(outcome).toBe("Throttled");
    expect(turn).not.toHaveBeenCalled();
    expect(releasePermit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(mutex);
  });

  test("a turn that throws still gives both back, and the error is the job's", async () => {
    await expect(
      SecurityProjectWork.runForProject(
        WORK,
        PROJECT_A,
        async (): Promise<void> => {
          throw new Error("ClickHouse is down");
        },
      ),
    ).rejects.toThrow("ClickHouse is down");

    expect(releasePermit).toHaveBeenCalledWith(permit);
    expect(release).toHaveBeenCalledWith(mutex);
  });

  test("giving back what Valkey already let go of is not an error", async () => {
    release.mockRejectedValue(new Error("lock was lost") as never);
    releasePermit.mockRejectedValue(new Error("permit was lost") as never);

    await expect(
      SecurityProjectWork.runForProject(
        WORK,
        PROJECT_A,
        async (): Promise<void> => {
          // Nothing to do.
        },
      ),
    ).resolves.toBe("Done");
  });

  test("the lease is kept by re-asserting the lock, and a lost lease ends the turn", async () => {
    keepLock
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    const seen: Array<{ kept: boolean; timeLeft: boolean }> = [];

    await SecurityProjectWork.runForProject(
      WORK,
      PROJECT_A,
      async (lease: SecurityProjectWorkLease): Promise<void> => {
        for (let item: number = 0; item < 3; item++) {
          const kept: boolean = await lease.keep();
          seen.push({ kept, timeLeft: lease.hasTimeLeft() });
        }
      },
    );

    expect(keepLock).toHaveBeenCalledWith(mutex);
    expect(seen).toEqual([
      { kept: true, timeLeft: true },
      { kept: false, timeLeft: false },
      // Once lost, it stays lost: Valkey is not asked again.
      { kept: false, timeLeft: false },
    ]);
    expect(keepLock).toHaveBeenCalledTimes(2);
  });

  test("a lease that cannot be vouched for is lost", async () => {
    keepLock.mockRejectedValue(new Error("Redis client is not connected") as never);
    let kept: boolean | null = null;

    await SecurityProjectWork.runForProject(
      WORK,
      PROJECT_A,
      async (lease: SecurityProjectWorkLease): Promise<void> => {
        kept = await lease.keep();
      },
    );

    expect(kept).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a turn starts new items only for its time budget", async () => {
    let withBudget: boolean | null = null;
    let withoutBudget: boolean | null = null;

    await SecurityProjectWork.runForProject(
      WORK,
      PROJECT_A,
      async (lease: SecurityProjectWorkLease): Promise<void> => {
        withBudget = lease.hasTimeLeft();
      },
      { timeBudgetInMs: 60 * 1000 },
    );
    await SecurityProjectWork.runForProject(
      WORK,
      PROJECT_A,
      async (lease: SecurityProjectWorkLease): Promise<void> => {
        withoutBudget = lease.hasTimeLeft();
      },
      { timeBudgetInMs: 0 },
    );

    expect(withBudget).toBe(true);
    expect(withoutBudget).toBe(false);
  });

  test("work done outside a project job is never stopped", async () => {
    await expect(UNLIMITED_SECURITY_PROJECT_WORK_LEASE.keep()).resolves.toBe(
      true,
    );
    expect(UNLIMITED_SECURITY_PROJECT_WORK_LEASE.hasTimeLeft()).toBe(true);
  });
});
