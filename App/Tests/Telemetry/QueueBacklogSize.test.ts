import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test — the queue-size numbers that feed autoscaling.
 *
 * getQueueBacklogSize is the KEDA scaling signal: it must count only jobs
 * that still need a worker (waiting + delayed) and must NOT count active
 * jobs. Telemetry jobs park in the active state for the fan-in writer's
 * full flush window while awaiting their ClickHouse ack; counting them made
 * the autoscaler read busy-but-healthy capacity as demand, so pod count
 * converged on job rate x ack latency instead of real queue pressure.
 *
 * getQueueSize keeps the active-inclusive sum — it backs the ingest
 * backpressure checks, where in-flight work genuinely counts against
 * capacity — so both are pinned here to stop either from drifting into the
 * other's semantics.
 */

type FakeCounts = {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
};

function fakeBullQueue(counts: FakeCounts): {
  queue: unknown;
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const track: (name: string) => void = (name: string): void => {
    calls[name] = (calls[name] || 0) + 1;
  };

  const queue: unknown = {
    getWaitingCount: async (): Promise<number> => {
      track("getWaitingCount");
      return counts.waiting;
    },
    getActiveCount: async (): Promise<number> => {
      track("getActiveCount");
      return counts.active;
    },
    getDelayedCount: async (): Promise<number> => {
      track("getDelayedCount");
      return counts.delayed;
    },
    getCompletedCount: async (): Promise<number> => {
      track("getCompletedCount");
      return counts.completed;
    },
    getFailedCount: async (): Promise<number> => {
      track("getFailedCount");
      return counts.failed;
    },
  };

  return { queue, calls };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Queue.getQueueBacklogSize", () => {
  test("counts waiting + delayed only", async () => {
    const { queue } = fakeBullQueue({
      waiting: 7,
      active: 100,
      delayed: 3,
      completed: 500,
      failed: 9,
    });
    jest.spyOn(Queue, "getQueue").mockReturnValue(queue as never);

    await expect(Queue.getQueueBacklogSize(QueueName.Telemetry)).resolves.toBe(
      10,
    );
  });

  test("never queries the active count — active jobs are capacity, not demand", async () => {
    const { queue, calls } = fakeBullQueue({
      waiting: 1,
      active: 99999,
      delayed: 2,
      completed: 0,
      failed: 0,
    });
    jest.spyOn(Queue, "getQueue").mockReturnValue(queue as never);

    await Queue.getQueueBacklogSize(QueueName.Telemetry);

    expect(calls["getActiveCount"]).toBeUndefined();
    expect(calls["getWaitingCount"]).toBe(1);
    expect(calls["getDelayedCount"]).toBe(1);
  });

  test("a fleet saturated with parked-but-active jobs reports zero backlog", async () => {
    // The exact regime that used to overscale: everything active, nothing waiting.
    const { queue } = fakeBullQueue({
      waiting: 0,
      active: 4000,
      delayed: 0,
      completed: 0,
      failed: 0,
    });
    jest.spyOn(Queue, "getQueue").mockReturnValue(queue as never);

    await expect(Queue.getQueueBacklogSize(QueueName.Telemetry)).resolves.toBe(
      0,
    );
  });
});

describe("Queue.getQueueSize (backpressure semantics, unchanged)", () => {
  test("still counts waiting + active + delayed", async () => {
    const { queue } = fakeBullQueue({
      waiting: 7,
      active: 100,
      delayed: 3,
      completed: 500,
      failed: 9,
    });
    jest.spyOn(Queue, "getQueue").mockReturnValue(queue as never);

    await expect(Queue.getQueueSize(QueueName.Telemetry)).resolves.toBe(110);
  });
});
