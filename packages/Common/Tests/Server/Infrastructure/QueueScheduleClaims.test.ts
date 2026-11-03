import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import logger from "../../../Server/Utils/Logger";
import { RepeatableJob } from "bullmq";

/*
 * Schedule claims (Server/Infrastructure/Queue.ts).
 *
 * Issue #5546: a worker still running 14.0.97 failed every run of two crons
 * that servers on 14.0.99 had scheduled, once a minute, with "No job found
 * with name". A worker that has no job by a name cannot tell, from the job
 * alone, whether a server of another release still schedules it (skip the
 * run) or whether a release that no longer runs anywhere left the schedule
 * behind (retire it). Claims tell it: every process claims each Worker
 * schedule it registers, before writing it and then every minute, and a
 * claim lapses ten minutes after it was last made.
 *
 * The Redis here keeps strings with a lapse on a clock of the test's own, and
 * logs every write and every schedule BullMQ is handed, in order, so a test
 * can tell which came first.
 */

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    AppVersion: "14.0.103",
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getRedisOptions: jest.fn().mockReturnValue({}) },
  };
});

type MockStoredValue = { value: string; expiresAt: number };

const mockValues: Map<string, MockStoredValue> = new Map<
  string,
  MockStoredValue
>();
const mockLog: Array<string> = [];
const mockReadyHandlers: Map<string, () => Promise<void>> = new Map<
  string,
  () => Promise<void>
>();
const mockState: { now: number; failClaims: boolean } = {
  now: Date.UTC(2026, 10, 3, 9, 0, 0),
  failClaims: false,
};

function mockRead(key: string): string | null {
  const stored: MockStoredValue | undefined = mockValues.get(key);

  if (!stored || stored.expiresAt <= mockState.now) {
    return null;
  }

  return stored.value;
}

type MockClient = {
  on: jest.Mock;
  get: jest.Mock;
  mget: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  pipeline: jest.Mock;
};

function mockClientFor(queueName: string): MockClient {
  const client: MockClient = {
    on: jest.fn((event: string, handler: () => Promise<void>) => {
      if (event === "ready") {
        mockReadyHandlers.set(queueName, handler);
      }
    }),
    get: jest.fn(async (key: string) => {
      return mockRead(key);
    }),
    mget: jest.fn(async (keys: Array<string>) => {
      return keys.map(mockRead);
    }),
    set: jest.fn(
      async (key: string, value: string, _unit: string, ttl: number) => {
        mockLog.push(`set ${key}`);
        mockValues.set(key, { value, expiresAt: mockState.now + ttl });
        return "OK";
      },
    ),
    del: jest.fn(async (key: string) => {
      mockLog.push(`del ${key}`);
      return mockValues.delete(key) ? 1 : 0;
    }),
    pipeline: jest.fn(() => {
      const commands: Array<() => Promise<unknown>> = [];

      const pipeline: {
        set: (...args: Array<unknown>) => unknown;
        exec: () => Promise<Array<[Error | null, unknown]>>;
      } = {
        set: (key: unknown, value: unknown, unit: unknown, ttl: unknown) => {
          commands.push(() => {
            return client.set(key, value, unit, ttl);
          });
          return pipeline;
        },
        exec: async () => {
          if (mockState.failClaims) {
            throw new Error("Connection is closed.");
          }

          const results: Array<[Error | null, unknown]> = [];

          for (const command of commands) {
            results.push([null, await command()]);
          }

          return results;
        },
      };

      return pipeline;
    }),
  };

  return client;
}

type MockBullQueue = {
  name: string;
  getRepeatableJobs: jest.Mock;
  removeRepeatableByKey: jest.Mock;
  getJob: jest.Mock;
  clean: jest.Mock;
  add: jest.Mock;
  client: Promise<MockClient>;
  redis: MockClient;
};

const mockBullQueues: Map<string, MockBullQueue> = new Map<
  string,
  MockBullQueue
>();

jest.mock("bullmq", () => {
  return {
    __esModule: true,
    Queue: jest.fn().mockImplementation((name: string) => {
      const redis: MockClient = mockClientFor(name);

      const instance: MockBullQueue = {
        name,
        getRepeatableJobs: jest.fn().mockResolvedValue([]),
        removeRepeatableByKey: jest.fn().mockResolvedValue(true),
        getJob: jest.fn().mockResolvedValue(undefined),
        clean: jest.fn().mockResolvedValue([]),
        add: jest.fn(async (jobName: string) => {
          mockLog.push(`add ${name} ${jobName}`);
          return { repeatJobKey: `key-of-${jobName}` };
        }),
        client: Promise.resolve(redis),
        redis,
      };

      mockBullQueues.set(name, instance);

      return instance;
    }),
  };
});

const CLAIM_PREFIX: string = "queue:schedule-claim:Worker:";
const RETIRED_PREFIX: string = "queue:schedule-retired:Worker:";
const MINUTE: number = 60 * 1000;

type QueueInternals = {
  repeatableJobs: Record<string, unknown>;
  scheduleClaimRefreshTimer: ReturnType<typeof setInterval> | null;
};

const internals: QueueInternals = Queue as unknown as QueueInternals;

function bullQueue(queueName: QueueName): MockBullQueue {
  Queue.getQueue(queueName);
  return mockBullQueues.get(queueName) as MockBullQueue;
}

function repeatable(name: string, key: string, pattern: string): RepeatableJob {
  return { key, name, id: null, endDate: null, tz: null, pattern };
}

async function registerCron(jobName: string, pattern: string): Promise<void> {
  await Queue.addJob(
    QueueName.Worker,
    jobName,
    jobName,
    {},
    {
      scheduleAt: pattern,
    },
  );
}

beforeEach(() => {
  internals.repeatableJobs = {};

  if (internals.scheduleClaimRefreshTimer) {
    clearInterval(internals.scheduleClaimRefreshTimer);
  }

  internals.scheduleClaimRefreshTimer = null;
  mockValues.clear();
  mockLog.length = 0;
  mockState.failClaims = false;
  mockState.now = Date.UTC(2026, 10, 3, 9, 0, 0);

  for (const queue of mockBullQueues.values()) {
    queue.getRepeatableJobs.mockReset().mockResolvedValue([]);
    queue.removeRepeatableByKey.mockReset().mockResolvedValue(true);
    queue.add.mockClear();
    queue.redis.set.mockClear();
  }

  jest.mocked(logger.error).mockClear();
  jest.mocked(logger.info).mockClear();
});

afterAll(() => {
  if (internals.scheduleClaimRefreshTimer) {
    clearInterval(internals.scheduleClaimRefreshTimer);
  }
});

describe("Queue.addJob claims a Worker cron before writing its schedule", () => {
  test("the claim names this release and lapses after ten minutes", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");

    const redis: MockClient = bullQueue(QueueName.Worker).redis;

    expect(redis.set).toHaveBeenCalledWith(
      `${CLAIM_PREFIX}SecurityHunts:RunScheduledHunts`,
      "14.0.103",
      "PX",
      10 * MINUTE,
    );
    expect(Queue.SCHEDULE_CLAIM_TTL_MS).toBe(10 * MINUTE);
  });

  test("the claim is written before BullMQ is handed the schedule", async () => {
    await registerCron(
      "AIAgent:FindPullRequestsToReviewInProduction",
      "* * * * *",
    );

    const claimAt: number = mockLog.indexOf(
      `set ${CLAIM_PREFIX}AIAgent:FindPullRequestsToReviewInProduction`,
    );
    const scheduleAt: number = mockLog.indexOf(
      "add Worker AIAgent:FindPullRequestsToReviewInProduction",
    );

    expect(claimAt).toBeGreaterThanOrEqual(0);
    expect(scheduleAt).toBeGreaterThan(claimAt);
  });

  test("a claim that cannot be written does not keep the schedule from being added", async () => {
    mockState.failClaims = true;

    await registerCron("Incident:KeepCurrentStateConsistent", "* * * * *");

    expect(bullQueue(QueueName.Worker).add).toHaveBeenCalledWith(
      "Incident:KeepCurrentStateConsistent",
      {},
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: "* * * * *" }),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Could not claim the schedule of Incident:KeepCurrentStateConsistent",
      ),
    );
  });

  test("a job queued once is not claimed", async () => {
    await Queue.addJob(QueueName.Worker, "turn-1", "SecurityHunts:Turn", {
      projectId: "p",
    });

    expect(
      mockLog.filter((entry: string) => {
        return entry.startsWith("set ");
      }),
    ).toEqual([]);
  });

  test("a Workflow schedule is not claimed: its Workflow row owns it", async () => {
    await Queue.addJob(
      QueueName.Workflow,
      "workflow-1",
      "workflow-1",
      {},
      {
        scheduleAt: "*/5 * * * *",
      },
    );

    expect(bullQueue(QueueName.Workflow).redis.set).not.toHaveBeenCalled();
    expect(Queue.isScheduleClaimedQueue(QueueName.Workflow)).toBe(false);
    expect(Queue.isScheduleClaimedQueue(QueueName.Worker)).toBe(true);
  });
});

describe("Queue.getScheduleClaim", () => {
  test("says which release claimed a schedule", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");

    await expect(
      Queue.getScheduleClaim(
        QueueName.Worker,
        "SecurityHunts:RunScheduledHunts",
      ),
    ).resolves.toBe("14.0.103");
  });

  test("is null for a schedule nobody claimed", async () => {
    await expect(
      Queue.getScheduleClaim(QueueName.Worker, "Removed:LongAgo"),
    ).resolves.toBeNull();
  });

  test("is null once ten minutes pass without the claim being made again", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");

    mockState.now += 10 * MINUTE - 1;
    await expect(
      Queue.getScheduleClaim(
        QueueName.Worker,
        "SecurityHunts:RunScheduledHunts",
      ),
    ).resolves.toBe("14.0.103");

    mockState.now += 1;
    await expect(
      Queue.getScheduleClaim(
        QueueName.Worker,
        "SecurityHunts:RunScheduledHunts",
      ),
    ).resolves.toBeNull();
  });
});

describe("Queue.refreshScheduleClaims", () => {
  test("claims every schedule this process holds again, so a running holder never lapses", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");
    await registerCron(
      "AIAgent:FindPullRequestsToReviewInProduction",
      "* * * * *",
    );

    // Nine minutes on, then a refresh: both claims last another ten.
    mockState.now += 9 * MINUTE;
    await Queue.refreshScheduleClaims();
    mockState.now += 9 * MINUTE;

    await expect(
      Queue.getScheduleClaim(
        QueueName.Worker,
        "SecurityHunts:RunScheduledHunts",
      ),
    ).resolves.toBe("14.0.103");
    await expect(
      Queue.getScheduleClaim(
        QueueName.Worker,
        "AIAgent:FindPullRequestsToReviewInProduction",
      ),
    ).resolves.toBe("14.0.103");
  });

  test("does not claim a schedule this process removed by name", async () => {
    await registerCron("SentinelInsight:ScanForInsights", "*/15 * * * *");
    await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    mockLog.length = 0;
    await Queue.refreshScheduleClaims();

    expect(mockLog).toEqual([]);
  });

  test("never throws, even when Redis refuses", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");
    mockState.failClaims = true;

    await expect(Queue.refreshScheduleClaims()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Could not refresh the schedule claims on queue Worker",
    );
  });

  test("runs every minute once a cron is registered, on a timer that keeps no process alive", async () => {
    const unref: jest.Mock = jest.fn();
    const setIntervalSpy: jest.SpyInstance = jest
      .spyOn(global, "setInterval")
      .mockImplementation((() => {
        return { unref } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval);

    try {
      await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");
      await registerCron(
        "AIAgent:FindPullRequestsToReviewInProduction",
        "* * * * *",
      );

      // One timer for the process, however many crons it registers.
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy.mock.calls[0]![1]).toBe(MINUTE);
      expect(unref).toHaveBeenCalled();

      const refresh: jest.SpyInstance = jest
        .spyOn(Queue, "refreshScheduleClaims")
        .mockResolvedValue(undefined);

      (setIntervalSpy.mock.calls[0]![0] as () => void)();
      expect(refresh).toHaveBeenCalledTimes(1);
      refresh.mockRestore();
    } finally {
      setIntervalSpy.mockRestore();
      internals.scheduleClaimRefreshTimer = null;
    }
  });
});

describe("Queue.retireUnclaimedSchedule", () => {
  test("leaves a schedule a running process claims, and says which release that is", async () => {
    // A server running 14.0.99 claimed it; this one has no job by the name.
    mockValues.set(`${CLAIM_PREFIX}SecurityHunts:RunScheduledHunts`, {
      value: "14.0.99",
      expiresAt: mockState.now + 10 * MINUTE,
    });
    bullQueue(QueueName.Worker).getRepeatableJobs.mockResolvedValue([
      repeatable(
        "SecurityHunts:RunScheduledHunts",
        "208750ac869e9af73fe7ea424f11d73c",
        "* * * * *",
      ),
    ]);

    await expect(
      Queue.retireUnclaimedSchedule(
        QueueName.Worker,
        "SecurityHunts:RunScheduledHunts",
      ),
    ).resolves.toEqual({ claimedBy: "14.0.99", removedCount: 0 });

    expect(
      bullQueue(QueueName.Worker).removeRepeatableByKey,
    ).not.toHaveBeenCalled();
  });

  test("removes a schedule nobody claims, by its key, and notes that it did", async () => {
    bullQueue(QueueName.Worker).getRepeatableJobs.mockResolvedValue([
      repeatable(
        "AIAgent:TimeoutStuckTasks",
        "6f1ed002ab5595859014ebf0951522d9",
        "* * * * *",
      ),
      repeatable("Incident:KeepCurrentStateConsistent", "aaaa", "* * * * *"),
    ]);

    await expect(
      Queue.retireUnclaimedSchedule(
        QueueName.Worker,
        "AIAgent:TimeoutStuckTasks",
      ),
    ).resolves.toEqual({ claimedBy: null, removedCount: 1 });

    expect(
      bullQueue(QueueName.Worker).removeRepeatableByKey,
    ).toHaveBeenCalledTimes(1);
    expect(
      bullQueue(QueueName.Worker).removeRepeatableByKey,
    ).toHaveBeenCalledWith("6f1ed002ab5595859014ebf0951522d9");
    expect(mockRead(`${RETIRED_PREFIX}AIAgent:TimeoutStuckTasks`)).toBe(
      "14.0.103",
    );
  });

  test("a claim that has lapsed no longer protects a schedule", async () => {
    mockValues.set(`${CLAIM_PREFIX}Removed:InANewerRelease`, {
      value: "14.0.110",
      expiresAt: mockState.now + 10 * MINUTE,
    });
    bullQueue(QueueName.Worker).getRepeatableJobs.mockResolvedValue([
      repeatable("Removed:InANewerRelease", "bbbb", "*/5 * * * *"),
    ]);

    mockState.now += 10 * MINUTE;

    await expect(
      Queue.retireUnclaimedSchedule(
        QueueName.Worker,
        "Removed:InANewerRelease",
      ),
    ).resolves.toEqual({ claimedBy: null, removedCount: 1 });
  });

  test("leaves no note when there was nothing to remove", async () => {
    await expect(
      Queue.retireUnclaimedSchedule(QueueName.Worker, "Already:Retired"),
    ).resolves.toEqual({ claimedBy: null, removedCount: 0 });

    expect(mockRead(`${RETIRED_PREFIX}Already:Retired`)).toBeNull();
  });

  test("never touches a Workflow schedule", async () => {
    bullQueue(QueueName.Workflow).getRepeatableJobs.mockResolvedValue([
      repeatable("workflow-1", "cccc", "*/5 * * * *"),
    ]);

    await expect(
      Queue.retireUnclaimedSchedule(QueueName.Workflow, "workflow-1"),
    ).resolves.toEqual({ claimedBy: null, removedCount: 0 });

    expect(
      bullQueue(QueueName.Workflow).removeRepeatableByKey,
    ).not.toHaveBeenCalled();
  });
});

describe("a schedule retired while its holder was registering it comes back", () => {
  test("the holder adds it again at its next refresh and clears the note", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");

    /*
     * A worker that has no job by the name read "no claim" a moment before
     * this process claimed it, and removed it a moment after.
     */
    mockValues.set(`${RETIRED_PREFIX}SecurityHunts:RunScheduledHunts`, {
      value: "14.0.97",
      expiresAt: mockState.now + 10 * MINUTE,
    });

    bullQueue(QueueName.Worker).add.mockClear();
    await Queue.refreshScheduleClaims();

    expect(bullQueue(QueueName.Worker).add).toHaveBeenCalledTimes(1);
    expect(bullQueue(QueueName.Worker).add).toHaveBeenCalledWith(
      "SecurityHunts:RunScheduledHunts",
      {},
      expect.objectContaining({
        jobId: "SecurityHunts-RunScheduledHunts",
        repeat: {
          pattern: "* * * * *",
          jobId: "SecurityHunts-RunScheduledHunts",
        },
      }),
    );
    expect(
      mockRead(`${RETIRED_PREFIX}SecurityHunts:RunScheduledHunts`),
    ).toBeNull();

    // Claimed again before it was added again.
    const lastClaim: number = mockLog.lastIndexOf(
      `set ${CLAIM_PREFIX}SecurityHunts:RunScheduledHunts`,
    );
    const readded: number = mockLog.lastIndexOf(
      "add Worker SecurityHunts:RunScheduledHunts",
    );
    expect(readded).toBeGreaterThan(lastClaim);
  });

  test("a schedule nobody retired is not added again", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");

    bullQueue(QueueName.Worker).add.mockClear();
    await Queue.refreshScheduleClaims();

    expect(bullQueue(QueueName.Worker).add).not.toHaveBeenCalled();
  });

  test("retiring a schedule leaves alone what a process holds, so the holder can bring it back", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");
    bullQueue(QueueName.Worker).getRepeatableJobs.mockResolvedValue([
      repeatable(
        "SecurityHunts:RunScheduledHunts",
        "208750ac869e9af73fe7ea424f11d73c",
        "* * * * *",
      ),
    ]);

    // The race: the claim was not there yet when the retiring worker looked.
    mockValues.delete(`${CLAIM_PREFIX}SecurityHunts:RunScheduledHunts`);
    await expect(
      Queue.retireUnclaimedSchedule(
        QueueName.Worker,
        "SecurityHunts:RunScheduledHunts",
      ),
    ).resolves.toEqual({ claimedBy: null, removedCount: 1 });

    bullQueue(QueueName.Worker).add.mockClear();
    await Queue.refreshScheduleClaims();

    expect(bullQueue(QueueName.Worker).add).toHaveBeenCalledWith(
      "SecurityHunts:RunScheduledHunts",
      {},
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: "* * * * *" }),
      }),
    );
  });

  test("removing a schedule by name is still what makes this process let go of it", async () => {
    await registerCron("SentinelInsight:ScanForInsights", "*/15 * * * *");
    mockValues.set(`${RETIRED_PREFIX}SentinelInsight:ScanForInsights`, {
      value: "14.0.97",
      expiresAt: mockState.now + 10 * MINUTE,
    });

    await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    bullQueue(QueueName.Worker).add.mockClear();
    await Queue.refreshScheduleClaims();

    expect(bullQueue(QueueName.Worker).add).not.toHaveBeenCalled();
  });
});

describe("re-adding schedules when Redis comes back", () => {
  test("claims each schedule before adding it again", async () => {
    await registerCron("SecurityHunts:RunScheduledHunts", "* * * * *");

    // Let the reconnect listener attach.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    const onReady: (() => Promise<void>) | undefined = mockReadyHandlers.get(
      QueueName.Worker,
    );
    expect(onReady).toBeDefined();

    mockValues.clear();
    mockLog.length = 0;
    await onReady!();

    expect(mockLog).toEqual([
      `set ${CLAIM_PREFIX}SecurityHunts:RunScheduledHunts`,
      "add Worker SecurityHunts:RunScheduledHunts",
    ]);
  });
});

describe("registering a cron replaces its schedules on other patterns", () => {
  test("a Worker cron whose schedule changed stops running on the old one", async () => {
    bullQueue(QueueName.Worker).getRepeatableJobs.mockResolvedValue([
      repeatable(
        "Monitor:KeepCurrentStateConsistent",
        "old-pattern",
        "* * * * *",
      ),
      repeatable(
        "Monitor:KeepCurrentStateConsistent",
        "same-pattern",
        "*/5 * * * *",
      ),
      repeatable(
        "Incident:KeepCurrentStateConsistent",
        "another-job",
        "* * * * *",
      ),
    ]);

    await registerCron("Monitor:KeepCurrentStateConsistent", "*/5 * * * *");

    const removed: Array<unknown> = bullQueue(
      QueueName.Worker,
    ).removeRepeatableByKey.mock.calls.map((call: Array<unknown>) => {
      return call[0];
    });

    expect(removed.sort()).toEqual(["old-pattern", "same-pattern"]);
  });

  test("a Workflow schedule on another pattern is left to its Workflow row", async () => {
    bullQueue(QueueName.Workflow).getRepeatableJobs.mockResolvedValue([
      repeatable("workflow-1", "other-pattern", "* * * * *"),
      repeatable("workflow-1", "same-pattern", "*/5 * * * *"),
    ]);

    await Queue.addJob(
      QueueName.Workflow,
      "workflow-1",
      "workflow-1",
      {},
      {
        scheduleAt: "*/5 * * * *",
      },
    );

    expect(
      bullQueue(QueueName.Workflow).removeRepeatableByKey.mock.calls,
    ).toEqual([["same-pattern"]]);
  });
});
