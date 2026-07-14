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
