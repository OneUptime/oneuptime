/*
 * Issue #5546 against a real Valkey and real BullMQ: what the Worker queue
 * does with a job whose name the worker has no job for.
 *
 * The report: a worker still on 14.0.97 failed every run of two crons that
 * servers on 14.0.99 scheduled ("No job found with name"), once a minute
 * each, forever. Here the Queue wrapper, schedule claims, QueueWorker,
 * runWorkerJob and BullMQ's own Lua run for real, on a queue of this suite's
 * own, and show that such a worker:
 *   - skips the runs of a cron a running server claims, and fails none;
 *   - retires a schedule no running server claims, so it stops firing;
 *   - hands a job queued once back to the queue - delayed, none of its
 *     attempts used - so a worker that has the job runs it;
 *   - fails such a job once, without retrying it, when nobody runs it in
 *     time;
 * and that registering a cron replaces its schedule on an old pattern, and a
 * schedule retired while its holder was registering it comes back at the
 * holder's next refresh.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310 and `npm
 * test` exports its settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16405:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16405 \
 *     npx jest Tests/Workers/UnknownWorkerJobValkey.test.ts
 *
 * Only this suite's queue and its schedule claims are touched, and they are
 * removed afterwards.
 */

/*
 * The real Queue wrapper, on a queue of this suite's own: the Worker entry of
 * the wrapper's own enum is renamed in place, so the schedule claims (which
 * are the Worker queue's) and UnknownWorkerJob both use this queue. The name
 * is built inside the factory, which runs, hoisted, before anything declared
 * in this file.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  type QueueModule = {
    default: unknown;
    QueueName: Record<string, string>;
  };

  const actual: QueueModule = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  ) as QueueModule;

  actual.QueueName["Worker"] =
    `UnknownWorkerJobTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
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
      trace: jest.fn(),
    },
  };
});

// This process; the "other" servers' releases are written into their claims.
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    AppVersion: "14.0.97",
  };
});

import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import UnknownQueueJob from "Common/Server/Infrastructure/UnknownQueueJob";
import logger from "Common/Server/Utils/Logger";
import runWorkerJob from "../../FeatureSet/Workers/Utils/RunWorkerJob";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type BullQueue = ReturnType<typeof Queue.getQueue>;
type BullWorker = ReturnType<typeof QueueWorker.getWorker>;
type RedisClient = Awaited<BullQueue["client"]>;

type HandBackSettings = {
  HAND_BACK_FOR_MS: number;
  FIRST_HAND_BACK_DELAY_MS: number;
  LONGEST_HAND_BACK_DELAY_MS: number;
};

const handBackSettings: HandBackSettings =
  UnknownQueueJob as unknown as HandBackSettings;
const realHandBackSettings: HandBackSettings = {
  HAND_BACK_FOR_MS: handBackSettings.HAND_BACK_FOR_MS,
  FIRST_HAND_BACK_DELAY_MS: handBackSettings.FIRST_HAND_BACK_DELAY_MS,
  LONGEST_HAND_BACK_DELAY_MS: handBackSettings.LONGEST_HAND_BACK_DELAY_MS,
};

// Every second, so a test sees several runs.
const EVERY_SECOND: string = "* * * * * *";

let queue: BullQueue;
let client: RedisClient;
let worker: BullWorker | null = null;
// Each run a job function of this suite got, by job name.
const ran: Map<string, Array<QueueJob>> = new Map<string, Array<QueueJob>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutInMs: number = 15000,
): Promise<void> {
  const deadline: number = Date.now() + timeoutInMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await sleep(25);
  }
}

// The worker of the report: it has no job by the names below.
function startWorker(): void {
  worker = QueueWorker.getWorker(
    QueueName.Worker,
    async (job: QueueJob, token?: string) => {
      await runWorkerJob(job, token);
    },
    { concurrency: 4 },
  );
}

async function schedulesNamed(name: string): Promise<Array<string>> {
  return (await queue.getRepeatableJobs())
    .filter((schedule: { name: string }) => {
      return schedule.name === name;
    })
    .map((schedule: { pattern?: string | null }) => {
      return schedule.pattern || "";
    });
}

async function jobsNamed(
  name: string,
  states: Array<"completed" | "failed" | "delayed" | "wait" | "active">,
): Promise<Array<QueueJob>> {
  return (await queue.getJobs(states, 0, -1)).filter((job: QueueJob) => {
    return job.name === name;
  });
}

function claimKey(jobName: string): string {
  return `queue:schedule-claim:${QueueName.Worker}:${jobName}`;
}

function retiredKey(jobName: string): string {
  return `queue:schedule-retired:${QueueName.Worker}:${jobName}`;
}

// A schedule as an earlier release left it in Redis: no claim at all.
async function leaveScheduleBehind(name: string): Promise<void> {
  const jobId: string = name.replace(/:/g, "-");
  await queue.add(
    name,
    {},
    {
      jobId,
      repeat: { pattern: EVERY_SECOND, jobId },
    },
  );
}

beforeAll(async () => {
  queue = Queue.getQueue(QueueName.Worker);
  await queue.waitUntilReady();
  client = await queue.client;
});

afterAll(async () => {
  Object.assign(handBackSettings, realHandBackSettings);

  if (worker) {
    await worker.close();
  }

  if (queue) {
    const claims: Array<string> = await client.keys(
      `queue:schedule-*:${QueueName.Worker}:*`,
    );

    if (claims.length > 0) {
      await client.del(...claims);
    }

    await queue.obliterate({ force: true });
    await queue.close();
  }
});

beforeEach(() => {
  ran.clear();
  jest.mocked(logger.warn).mockClear();
  jest.mocked(logger.info).mockClear();
  jest.mocked(logger.error).mockClear();
  (
    UnknownQueueJob as unknown as { lastWarnedAt: Map<string, number> }
  ).lastWarnedAt.clear();
});

afterEach(async () => {
  Object.assign(handBackSettings, realHandBackSettings);

  if (worker) {
    await worker.close();
    worker = null;
  }

  /*
   * The claims refresh runs every minute once a cron is registered; a test
   * calls it when it means to, so one on a slow machine never fires midway.
   */
  const refresh: { scheduleClaimRefreshTimer: NodeJS.Timeout | null } =
    Queue as unknown as { scheduleClaimRefreshTimer: NodeJS.Timeout | null };

  if (refresh.scheduleClaimRefreshTimer) {
    clearInterval(refresh.scheduleClaimRefreshTimer);
    refresh.scheduleClaimRefreshTimer = null;
  }
});

describe("a worker that has no job by a name, on a real Valkey", () => {
  test("skips every run of a cron a server of another release schedules, and fails none", async () => {
    // A server on 14.0.99 registers the cron (and claims it), as in the report.
    await Queue.addJob(
      QueueName.Worker,
      "SecurityHunts:RunScheduledHunts",
      "SecurityHunts:RunScheduledHunts",
      {},
      { scheduleAt: EVERY_SECOND },
    );
    await client.set(
      claimKey("SecurityHunts:RunScheduledHunts"),
      "14.0.99",
      "PX",
      Queue.SCHEDULE_CLAIM_TTL_MS,
    );

    startWorker();

    await waitFor("three skipped runs", async () => {
      return (
        (await jobsNamed("SecurityHunts:RunScheduledHunts", ["completed"]))
          .length >= 3
      );
    });

    expect(
      await jobsNamed("SecurityHunts:RunScheduledHunts", ["failed"]),
    ).toEqual([]);
    // The schedule is the 14.0.99 servers': it stays.
    expect(await schedulesNamed("SecurityHunts:RunScheduledHunts")).toEqual([
      EVERY_SECOND,
    ]);
    // Once, however many runs were skipped.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipped a run of "SecurityHunts:RunScheduledHunts": this worker runs OneUptime 14.0.97, which has no job by that name, and a server running OneUptime 14.0.99 schedules it.',
      ),
    );

    await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SecurityHunts:RunScheduledHunts",
    );
  }, 30000);

  test("retires a schedule no running server claims, so it stops firing", async () => {
    // Left behind by a release that no longer runs here.
    await leaveScheduleBehind("AIAgent:TimeoutStuckTasks");
    expect(await schedulesNamed("AIAgent:TimeoutStuckTasks")).toEqual([
      EVERY_SECOND,
    ]);

    startWorker();

    await waitFor("the schedule to be retired", async () => {
      return (await schedulesNamed("AIAgent:TimeoutStuckTasks")).length === 0;
    });

    // A run a worker had already taken when it was retired still finishes.
    await waitFor("the runs already taken to finish", async () => {
      return (
        (
          await jobsNamed("AIAgent:TimeoutStuckTasks", [
            "active",
            "wait",
            "delayed",
          ])
        ).length === 0
      );
    });

    const runsWhenRetired: number = (
      await jobsNamed("AIAgent:TimeoutStuckTasks", ["completed", "failed"])
    ).length;

    // Nothing fires any more.
    await sleep(2500);

    expect(
      (await jobsNamed("AIAgent:TimeoutStuckTasks", ["completed", "failed"]))
        .length,
    ).toBe(runsWhenRetired);
    expect(
      await jobsNamed("AIAgent:TimeoutStuckTasks", ["delayed", "wait"]),
    ).toEqual([]);
    expect(await jobsNamed("AIAgent:TimeoutStuckTasks", ["failed"])).toEqual(
      [],
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Removed the schedule of "AIAgent:TimeoutStuckTasks": no running OneUptime server schedules it any more',
      ),
    );
  }, 30000);

  test("hands a job queued once back to the queue, using none of its attempts, and a worker that has the job runs it", async () => {
    handBackSettings.FIRST_HAND_BACK_DELAY_MS = 400;
    handBackSettings.LONGEST_HAND_BACK_DELAY_MS = 400;

    // Queued by a server on a newer release, as one turn of its new pipeline.
    await Queue.addJob(
      QueueName.Worker,
      "turn-of-project-1",
      "SecurityWatchlists:RunProjectTurn",
      { projectId: "5f0d8d1e-1111-4111-8111-111111111111" },
      { attempts: 1 },
    );

    startWorker();

    // Delayed again, and the worker has said why.
    await waitFor("the job to be handed back", async () => {
      const job: QueueJob | undefined = await queue.getJob("turn-of-project-1");
      return Boolean(
        job &&
          (job.attemptsStarted || 0) >= 1 &&
          (await job.isDelayed()) &&
          jest.mocked(logger.warn).mock.calls.length > 0,
      );
    });

    const handedBack: QueueJob = (await queue.getJob(
      "turn-of-project-1",
    )) as QueueJob;
    expect(handedBack.attemptsMade).toBe(0);
    expect(await handedBack.isFailed()).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Handed a job named "SecurityWatchlists:RunProjectTurn" back to the',
      ),
    );

    // A worker of that release comes up: this one now has the job.
    JobDictionary.setJobFunction(
      "SecurityWatchlists:RunProjectTurn",
      async (job?: QueueJob) => {
        ran.set("SecurityWatchlists:RunProjectTurn", [
          ...(ran.get("SecurityWatchlists:RunProjectTurn") || []),
          job as QueueJob,
        ]);
      },
    );

    await waitFor("the job to run", async () => {
      const job: QueueJob | undefined = await queue.getJob("turn-of-project-1");
      return Boolean(job && (await job.isCompleted()));
    });

    const runs: Array<QueueJob> =
      ran.get("SecurityWatchlists:RunProjectTurn") || [];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.data).toEqual({
      projectId: "5f0d8d1e-1111-4111-8111-111111111111",
    });
    expect(
      await jobsNamed("SecurityWatchlists:RunProjectTurn", ["failed"]),
    ).toEqual([]);
  }, 30000);

  test("a project's turn handed back keeps holding its place: turns queued meanwhile do not pile up, and it runs once", async () => {
    handBackSettings.FIRST_HAND_BACK_DELAY_MS = 300;
    handBackSettings.LONGEST_HAND_BACK_DELAY_MS = 300;

    // As SecurityProjectWork queues a project's turn, once a minute.
    const queueTurn: (minute: number) => Promise<void> = async (
      minute: number,
    ): Promise<void> => {
      await Queue.addJob(
        QueueName.Worker,
        `watchlists-project-1-${minute}`,
        "SecurityWatchlists:RunProjectTurnDeduplicated",
        { projectId: "5f0d8d1e-2222-4222-8222-222222222222" },
        {
          attempts: 1,
          deduplication: { id: "watchlists-project-1" },
        },
      );
    };

    await queueTurn(1);
    startWorker();

    await waitFor("the turn to be handed back", async () => {
      const job: QueueJob | undefined = await queue.getJob(
        "watchlists-project-1-1",
      );
      return Boolean(
        job && (job.attemptsStarted || 0) >= 1 && (await job.isDelayed()),
      );
    });

    // The next minutes' turns for the same project, while it waits.
    await queueTurn(2);
    await queueTurn(3);

    expect(
      await jobsNamed("SecurityWatchlists:RunProjectTurnDeduplicated", [
        "delayed",
        "wait",
        "active",
        "completed",
        "failed",
      ]),
    ).toHaveLength(1);

    JobDictionary.setJobFunction(
      "SecurityWatchlists:RunProjectTurnDeduplicated",
      async (job?: QueueJob) => {
        ran.set("SecurityWatchlists:RunProjectTurnDeduplicated", [
          ...(ran.get("SecurityWatchlists:RunProjectTurnDeduplicated") || []),
          job as QueueJob,
        ]);
      },
    );

    await waitFor("the turn to run", async () => {
      const job: QueueJob | undefined = await queue.getJob(
        "watchlists-project-1-1",
      );
      return Boolean(job && (await job.isCompleted()));
    });

    expect(
      ran.get("SecurityWatchlists:RunProjectTurnDeduplicated"),
    ).toHaveLength(1);

    // Done, the project's next turn can be queued again.
    await queueTurn(4);
    await waitFor("the next turn to run", () => {
      return (
        (ran.get("SecurityWatchlists:RunProjectTurnDeduplicated") || [])
          .length === 2
      );
    });
  }, 30000);

  test("fails a job queued once that nobody runs in time - once, and saying why", async () => {
    handBackSettings.HAND_BACK_FOR_MS = 1500;
    handBackSettings.FIRST_HAND_BACK_DELAY_MS = 200;
    handBackSettings.LONGEST_HAND_BACK_DELAY_MS = 300;

    // Three attempts: giving up must not spend them.
    await Queue.addJob(
      QueueName.Worker,
      "nobody-has-it-1",
      "Removed:InThisRelease",
      {},
      { attempts: 3, backoffDelayInMs: 100 },
    );

    startWorker();

    await waitFor(
      "the job to fail",
      async () => {
        const job: QueueJob | undefined = await queue.getJob("nobody-has-it-1");
        return Boolean(job && (await job.isFailed()));
      },
      20000,
    );

    const failed: QueueJob = (await queue.getJob(
      "nobody-has-it-1",
    )) as QueueJob;

    expect(failed.failedReason).toContain(
      'No worker ran a job named "Removed:InThisRelease" within',
    );
    expect(failed.failedReason).toContain(
      "This worker runs OneUptime 14.0.97 and has nothing to run it with",
    );
    // Failed once: the attempts it was queued with were not spent retrying.
    expect(failed.attemptsMade).toBe(1);
    expect(failed.attemptsStarted).toBeGreaterThan(1);
  }, 30000);
});

describe("schedules and the processes that register them, on a real Valkey", () => {
  test("registering a cron whose schedule changed leaves only the new schedule", async () => {
    await Queue.addJob(
      QueueName.Worker,
      "Monitor:KeepCurrentStateConsistent",
      "Monitor:KeepCurrentStateConsistent",
      {},
      { scheduleAt: "0 * * * * *" },
    );

    // The next release runs it every five minutes instead.
    await Queue.addJob(
      QueueName.Worker,
      "Monitor:KeepCurrentStateConsistent",
      "Monitor:KeepCurrentStateConsistent",
      {},
      { scheduleAt: "0 */5 * * * *" },
    );

    expect(await schedulesNamed("Monitor:KeepCurrentStateConsistent")).toEqual([
      "0 */5 * * * *",
    ]);

    await Queue.removeRepeatableByName(
      QueueName.Worker,
      "Monitor:KeepCurrentStateConsistent",
    );
  });

  test("a schedule retired while its holder was registering it is back after the holder's next refresh", async () => {
    await Queue.addJob(
      QueueName.Worker,
      "Incident:KeepCurrentStateConsistent",
      "Incident:KeepCurrentStateConsistent",
      {},
      { scheduleAt: "0 0 * * * *" },
    );
    expect(
      await client.get(claimKey("Incident:KeepCurrentStateConsistent")),
    ).toBe("14.0.97");

    // A worker that has no job by the name read "no claim" a moment before.
    await client.del(claimKey("Incident:KeepCurrentStateConsistent"));
    await expect(
      Queue.retireUnclaimedSchedule(
        QueueName.Worker,
        "Incident:KeepCurrentStateConsistent",
      ),
    ).resolves.toEqual({ claimedBy: null, removedCount: 1 });
    expect(await schedulesNamed("Incident:KeepCurrentStateConsistent")).toEqual(
      [],
    );

    await Queue.refreshScheduleClaims();

    expect(await schedulesNamed("Incident:KeepCurrentStateConsistent")).toEqual(
      ["0 0 * * * *"],
    );
    expect(
      await client.get(retiredKey("Incident:KeepCurrentStateConsistent")),
    ).toBeNull();
    expect(
      await client.get(claimKey("Incident:KeepCurrentStateConsistent")),
    ).toBe("14.0.97");
    // Its claim lapses ten minutes after it was last made.
    const ttl: number = await client.pttl(
      claimKey("Incident:KeepCurrentStateConsistent"),
    );
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);

    await Queue.removeRepeatableByName(
      QueueName.Worker,
      "Incident:KeepCurrentStateConsistent",
    );
  });
});
