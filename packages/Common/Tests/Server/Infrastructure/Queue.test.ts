import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import { RepeatableJob } from "bullmq";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getRedisOptions: jest.fn().mockReturnValue({}),
    },
  };
});

type MockBullQueue = {
  getRepeatableJobs: jest.Mock;
  removeRepeatableByKey: jest.Mock;
  getJob: jest.Mock;
  clean: jest.Mock;
  add: jest.Mock;
  getWaitingCount: jest.Mock;
  getDelayedCount: jest.Mock;
  getActiveCount: jest.Mock;
  getJobSchedulersCount: jest.Mock;
  client: Promise<{ on: jest.Mock }>;
};

/*
 * Must be prefixed with "mock" — jest.mock() factories are hoisted and may not
 * reference out-of-scope variables that aren't so named.
 */
const mockBullQueueInstances: Array<MockBullQueue> = [];

jest.mock("bullmq", () => {
  return {
    __esModule: true,
    Queue: jest.fn().mockImplementation(() => {
      const instance: MockBullQueue = {
        getRepeatableJobs: jest.fn().mockResolvedValue([]),
        removeRepeatableByKey: jest.fn().mockResolvedValue(true),
        getJob: jest.fn().mockResolvedValue(undefined),
        clean: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue({}),
        getWaitingCount: jest.fn().mockResolvedValue(0),
        getDelayedCount: jest.fn().mockResolvedValue(0),
        getActiveCount: jest.fn().mockResolvedValue(0),
        getJobSchedulersCount: jest.fn().mockResolvedValue(0),
        client: Promise.resolve({ on: jest.fn() }),
      };
      mockBullQueueInstances.push(instance);
      return instance;
    }),
  };
});

/*
 * Builds a RepeatableJob as BullMQ returns it: `key` is the opaque md5 zset
 * member, and is the ONLY thing removeRepeatableByKey() accepts.
 */
const repeatable: (name: string, key: string) => RepeatableJob = (
  name: string,
  key: string,
): RepeatableJob => {
  return {
    key: key,
    name: name,
    id: null,
    endDate: null,
    tz: null,
    pattern: "*/15 * * * *",
  };
};

describe("Queue.removeRepeatableByName", () => {
  let queue: MockBullQueue;

  beforeAll(() => {
    // Force the (cached) BullQueue for the Worker queue to be constructed.
    Queue.getQueue(QueueName.Worker);
    queue = mockBullQueueInstances[0] as MockBullQueue;
  });

  beforeEach(() => {
    queue.getRepeatableJobs.mockReset().mockResolvedValue([]);
    queue.removeRepeatableByKey.mockReset().mockResolvedValue(true);
  });

  /*
   * The whole point of the method: go from a job NAME to the opaque repeat KEY.
   * A renamed cron (e.g. SentinelInsight:ScanForInsights ->
   * AIInsight:ScanForInsights) leaves its old repeatable behind in Redis,
   * firing forever, and the name is all we have to find it by.
   */
  it("removes a repeatable whose name matches, using its key", async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      repeatable("AIInsight:ScanForInsights", "aaaaaaaaaaaaaaaa"),
      repeatable("SentinelInsight:ScanForInsights", "86b9a73a59ccbe97264b573"),
    ]);

    const removedCount: number = await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    expect(removedCount).toBe(1);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith(
      "86b9a73a59ccbe97264b573",
    );
  });

  /*
   * Regression guard for the trap this method exists to avoid: BullMQ's
   * removeRepeatableByKey() ZREMs the exact member it is given, so passing a
   * job NAME (or a job id derived from it) matches nothing and silently
   * no-ops. The key must be the one from getRepeatableJobs().
   */
  it("never passes the job name to removeRepeatableByKey", async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      repeatable("SentinelInsight:ScanForInsights", "86b9a73a59ccbe97264b573"),
    ]);

    await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    expect(queue.removeRepeatableByKey).not.toHaveBeenCalledWith(
      "SentinelInsight:ScanForInsights",
    );
    // ...nor the ":"-sanitized form that Queue.removeJob() would have used.
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalledWith(
      "SentinelInsight-ScanForInsights",
    );
  });

  it("removes every repeatable sharing the name and returns the count", async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      repeatable("SentinelInsight:ScanForInsights", "key-one"),
      repeatable("SomeOther:Job", "key-two"),
      repeatable("SentinelInsight:ScanForInsights", "key-three"),
    ]);

    const removedCount: number = await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    expect(removedCount).toBe(2);
    expect(
      queue.removeRepeatableByKey.mock.calls.map((c: Array<string>) => {
        return c[0];
      }),
    ).toEqual(["key-one", "key-three"]);
  });

  /*
   * Idempotence is what lets this run on EVERY worker boot: once the legacy
   * repeatable is gone (or on a fresh install that never had it), the sweep
   * must be a cheap no-op rather than an error.
   */
  it("is a no-op when no repeatable has that name", async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      repeatable("AIInsight:ScanForInsights", "aaaaaaaaaaaaaaaa"),
    ]);

    const removedCount: number = await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    expect(removedCount).toBe(0);
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("does not count a repeatable BullMQ reported as not removed", async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      repeatable("SentinelInsight:ScanForInsights", "key-one"),
    ]);
    // BullMQ returns false when the key was already gone from the repeat zset.
    queue.removeRepeatableByKey.mockResolvedValue(false);

    const removedCount: number = await Queue.removeRepeatableByName(
      QueueName.Worker,
      "SentinelInsight:ScanForInsights",
    );

    expect(removedCount).toBe(0);
  });

  it("skips the Redis round trip when the name is empty", async () => {
    const removedCount: number = await Queue.removeRepeatableByName(
      QueueName.Worker,
      "",
    );

    expect(removedCount).toBe(0);
    expect(queue.getRepeatableJobs).not.toHaveBeenCalled();
  });
});

describe("Queue.removeJob", () => {
  let queue: MockBullQueue;

  beforeAll(() => {
    Queue.getQueue(QueueName.Worker);
    queue = mockBullQueueInstances[0] as MockBullQueue;
  });

  beforeEach(() => {
    queue.getJob.mockReset().mockResolvedValue(undefined);
    queue.removeRepeatableByKey.mockReset().mockResolvedValue(true);
  });

  /*
   * The repeat key is NOT a job id: it is either an md5 or a legacy
   * "name:id:endDate:tz:pattern" string. Sanitizing ":" -> "-" (which the job
   * id lookup must do, since BullMQ rejects colons in custom ids) would mangle
   * the legacy form into a zset member that does not exist, and the removal
   * would silently no-op. QueueWorkflow passes job.repeatJobKey straight in
   * here, so the raw value has to survive.
   */
  it("passes the repeat key through unsanitized", async () => {
    await Queue.removeJob(QueueName.Worker, "myjob:someid:0::*/5 * * * *");

    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith(
      "myjob:someid:0::*/5 * * * *",
    );
  });

  // The job-id lookup, by contrast, must use the sanitized id.
  it("looks the one-off job up by its sanitized id", async () => {
    await Queue.removeJob(QueueName.Worker, "myjob:someid");

    expect(queue.getJob).toHaveBeenCalledWith("myjob-someid");
  });
});

/*
 * The KEDA scaling signal.
 *
 * Every RunCron() registration parks one entry in BullMQ's DELAYED set — the
 * placeholder holding its next fire time — and getDelayedCount() counts it.
 * There are 127 of them on the Worker queue, so an uncorrected
 * waiting + delayed sum has a hard floor of 127: above every sensible
 * scale-down target, and therefore a fleet that can never scale in however
 * idle it is.
 *
 * The placeholders are discounted from `delayed`, where they are parked, and
 * NOT from the combined waiting + delayed sum. A placeholder stops being a
 * placeholder the moment it comes due: promoteDelayedJobs ZREMs it out of
 * `delayed` and onto `wait`, and its successor is only created once a worker
 * moves that job to active. So mid-promotion there are k due cron jobs in
 * `waiting`, delayed = 127 - k, and a scheduler count still reading 127 —
 * and those k jobs are queued work, not placeholders. Several tests below
 * pin exactly that window; they are the ones a combined-sum subtraction
 * fails.
 */
describe("Queue.getQueueBacklogSize", () => {
  let queue: MockBullQueue;

  beforeAll(() => {
    Queue.getQueue(QueueName.Worker);
    queue = mockBullQueueInstances[0] as MockBullQueue;
  });

  beforeEach(() => {
    queue.getWaitingCount.mockReset().mockResolvedValue(0);
    queue.getDelayedCount.mockReset().mockResolvedValue(0);
    queue.getActiveCount.mockReset().mockResolvedValue(0);
    queue.getJobSchedulersCount.mockReset().mockResolvedValue(0);
  });

  it("discounts the parked scheduler placeholders from the delayed count", async () => {
    queue.getWaitingCount.mockResolvedValue(200);
    queue.getDelayedCount.mockResolvedValue(130);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(
      203,
    );
  });

  /*
   * Delayed work that is NOT a cron placeholder — a retry sitting out its
   * backoff, a job added with an explicit delay — is still demand, and still
   * shows up once the placeholders are accounted for.
   */
  it("counts genuinely delayed work sitting above the scheduler placeholders", async () => {
    queue.getWaitingCount.mockResolvedValue(0);
    queue.getDelayedCount.mockResolvedValue(136);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(9);
  });

  /*
   * The exact regime this change exists for: a completely idle worker fleet
   * whose only "delayed" entries are the cron placeholders. Before the
   * subtraction this reported 127 forever and pinned the fleet at its
   * scaled-up size.
   */
  it("reports zero when the only delayed entries are the cron schedulers", async () => {
    queue.getWaitingCount.mockResolvedValue(0);
    queue.getDelayedCount.mockResolvedValue(127);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(0);
  });

  /*
   * ...and the other half of that: the discount must not swallow real demand.
   * Work queued while every placeholder is still parked shows up 1:1.
   */
  it("still reports waiting jobs sitting above the scheduler floor", async () => {
    queue.getWaitingCount.mockResolvedValue(5);
    queue.getDelayedCount.mockResolvedValue(127);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(5);
  });

  /*
   * The case above is the easy one: delayed is still 127, so any discount
   * shape gets it right. THIS is the real promotion window, and the reason
   * the placeholders are discounted from `delayed` rather than from the
   * combined sum.
   *
   * Five crons have just come due. promoteDelayedJobs moved their five
   * placeholders out of `delayed` and onto `wait`, and the successors are not
   * created until a worker moves each job to active — so delayed has dropped
   * to 122 while the repeat zset still reads 127. Those five jobs are queued
   * work waiting for a worker and must be reported as such.
   *
   * `max(0, waiting + delayed - schedulers)` reports 0 here: it cancels the
   * promoted jobs out against placeholders they are no longer sitting in.
   */
  it("counts crons that have been promoted out of the delayed set", async () => {
    queue.getWaitingCount.mockResolvedValue(5);
    queue.getDelayedCount.mockResolvedValue(122);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(5);
  });

  /*
   * The same window at the top of a minute, when a whole batch of
   * EVERY_MINUTE crons is promoted at once and nothing else is queued. A
   * combined-sum discount reads exactly 0 here — an idle signal at the
   * precise moment sixty jobs landed on the queue, which tells KEDA to scale
   * in under load. That is the expensive direction to get wrong.
   */
  it("reports a mass cron promotion as demand, not as an idle queue", async () => {
    queue.getWaitingCount.mockResolvedValue(60);
    queue.getDelayedCount.mockResolvedValue(67);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(60);
  });

  /*
   * The invariant behind both of those, swept across the whole promotion
   * window: however many of the 127 schedulers are mid-flight, the waiting
   * count passes through untouched. Placeholders are only ever discounted
   * from the set they are actually parked in.
   */
  it("never discounts a scheduler out of the waiting count", async () => {
    const schedulerCount: number = 127;
    const promotedCounts: Array<number> = [0, 1, 5, 60, 126, 127];

    for (const promoted of promotedCounts) {
      queue.getWaitingCount.mockResolvedValue(promoted);
      queue.getDelayedCount.mockResolvedValue(schedulerCount - promoted);
      queue.getJobSchedulersCount.mockResolvedValue(schedulerCount);

      await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(
        promoted,
      );
    }
  });

  /*
   * The three counts are read concurrently and are not a consistent
   * snapshot, so delayed can be read mid-promotion and come back well below
   * the scheduler count. The discount is clamped at zero there: an unclamped
   * subtraction would carry the shortfall into `waiting` (re-introducing the
   * masking above) and could drive the gauge negative, which KEDA reads as a
   * garbage value.
   */
  it("clamps the delayed discount rather than eating into the waiting count", async () => {
    queue.getWaitingCount.mockResolvedValue(4);
    queue.getDelayedCount.mockResolvedValue(100);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(4);
  });

  it("reports zero, not a negative, when the delayed set is short and nothing waits", async () => {
    queue.getWaitingCount.mockResolvedValue(0);
    queue.getDelayedCount.mockResolvedValue(100);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(0);
  });

  it("clamps a delayed set emptied out from under the scheduler count", async () => {
    queue.getWaitingCount.mockResolvedValue(0);
    queue.getDelayedCount.mockResolvedValue(0);
    queue.getJobSchedulersCount.mockResolvedValue(127);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(0);
  });

  /*
   * Regression guard: on a queue with no crons registered at all (Telemetry,
   * Runbook) the number must be byte-for-byte what it was before the
   * subtraction existed.
   */
  it("is unchanged from waiting + delayed when there are no schedulers", async () => {
    queue.getWaitingCount.mockResolvedValue(7);
    queue.getDelayedCount.mockResolvedValue(3);
    queue.getJobSchedulersCount.mockResolvedValue(0);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(10);
  });

  /*
   * ACTIVE jobs stay excluded. Telemetry jobs park in the active state for
   * the fan-in writer's whole flush window, so counting them makes the
   * scaler read busy-but-healthy capacity as demand.
   */
  it("never queries the active count", async () => {
    await Queue.getQueueBacklogSize(QueueName.Worker);

    expect(queue.getActiveCount).not.toHaveBeenCalled();
    expect(queue.getWaitingCount).toHaveBeenCalledTimes(1);
    expect(queue.getDelayedCount).toHaveBeenCalledTimes(1);
    expect(queue.getJobSchedulersCount).toHaveBeenCalledTimes(1);
  });

  /*
   * All three reads must be in flight together. This is scraped on every
   * KEDA poll, for four queues, from three deployments — serializing the
   * round trips would triple the Redis latency of the scrape for no reason.
   */
  it("fetches the three counts concurrently, not serially", async () => {
    const release: Array<() => void> = [];

    const deferred: (value: number) => () => Promise<number> = (
      value: number,
    ) => {
      return (): Promise<number> => {
        return new Promise((resolve: (value: number) => void) => {
          release.push(() => {
            return resolve(value);
          });
        });
      };
    };

    queue.getWaitingCount.mockImplementation(deferred(1));
    queue.getDelayedCount.mockImplementation(deferred(2));
    queue.getJobSchedulersCount.mockImplementation(deferred(0));

    const backlog: Promise<number> = Queue.getQueueBacklogSize(
      QueueName.Worker,
    );

    // Let the synchronous part of the call, and one microtask, run.
    await Promise.resolve();

    /*
     * A serial `await a; await b; await c;` would have issued only the first
     * of these while the others were still blocked.
     */
    expect(queue.getWaitingCount).toHaveBeenCalledTimes(1);
    expect(queue.getDelayedCount).toHaveBeenCalledTimes(1);
    expect(queue.getJobSchedulersCount).toHaveBeenCalledTimes(1);

    for (const resolve of release) {
      resolve();
    }

    await expect(backlog).resolves.toBe(3);
  });

  /*
   * getJobSchedulersCount() is newer than the repeatable API it replaces.
   * The count only ever CORRECTS the backlog, so a BullMQ build without it
   * must fall back to the uncorrected sum — throwing here would take the
   * whole scaling metric offline and leave KEDA with no signal at all.
   */
  it("falls back to waiting + delayed when BullMQ has no scheduler count", async () => {
    queue.getWaitingCount.mockResolvedValue(7);
    queue.getDelayedCount.mockResolvedValue(3);

    const originalSchedulerCount: jest.Mock = queue.getJobSchedulersCount;
    delete (queue as Partial<MockBullQueue>).getJobSchedulersCount;

    try {
      await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(
        10,
      );
    } finally {
      queue.getJobSchedulersCount = originalSchedulerCount;
    }
  });

  /*
   * BullMQ returns undefined rather than 0 from a ZCARD against a repeat
   * zset that does not exist yet (a queue booted with no crons registered).
   * `undefined` would turn the subtraction into NaN, which KEDA reads as a
   * missing metric.
   */
  it("treats a missing scheduler count as zero, not NaN", async () => {
    queue.getWaitingCount.mockResolvedValue(7);
    queue.getDelayedCount.mockResolvedValue(3);
    queue.getJobSchedulersCount.mockResolvedValue(undefined);

    await expect(Queue.getQueueBacklogSize(QueueName.Worker)).resolves.toBe(10);
  });
});
