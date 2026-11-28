import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS,
  PROBE_SCHEDULING_MAX_WAIT_MS,
  ProbeSchedulingAbandonedError,
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
  monitorTestLaneLimits,
  probeSchedulingLimits,
} from "../../../../Server/Utils/Probe/ProbeSchedulingLimiter";
import ProbeSchedulingLane from "../../../../Server/Utils/Probe/ProbeSchedulingLane";
import {
  ProbeSchedulingMaxConcurrentMonitorTestRequests,
  ProbeSchedulingMaxConcurrentRequests,
} from "../../../../Server/EnvironmentConfig";
import {
  KeyedConcurrencyRefusal,
  KeyedConcurrencyRelease,
} from "../../../../Server/Utils/KeyedConcurrencyLimiter";
import ProbeSchedulingMetricsInstance, {
  ProbeSchedulingLaneMetrics,
  ProbeSchedulingMetricsSnapshot,
} from "../../../../Server/Utils/Probe/ProbeSchedulingMetrics";
import logger from "../../../../Server/Utils/Logger";
import {
  PROBE_ALARM_ATTRIBUTE_KEY,
  PROBE_ALARM_LOG_PREFIX,
  PROBE_ALARM_OVER_LOG_PREFIX,
  ProbeAlarm,
} from "../../../../Server/Utils/Probe/ProbeAlarmLog";
import ExceptionCode from "../../../../Types/Exception/ExceptionCode";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * The per-process limit on probe scheduling requests (#7920): how many run
 * at once, how many for one probe, how long one waits, what a refused one
 * gets, and the busy warning in the server log - at most once a minute,
 * however many requests are refused.
 */

jest.mock("../../../../Server/Utils/Logger");

async function settle(): Promise<void> {
  for (let round: number = 0; round < 3; round++) {
    await new Promise<void>((resolve: () => void): void => {
      process.nextTick(resolve);
    });
  }
}

describe("ProbeSchedulingLimiter", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("the defaults: a fifth of the pool at once shared fairly, a bounded queue, a 5 s wait", () => {
    expect(ProbeSchedulingMaxConcurrentRequests).toBe(10);
    expect(ProbeSchedulingLimiterInstance.limits).toEqual({
      maxRunning: 10,
      // No fixed share: one probe alone may use every slot (#10819).
      maxRunningPerKey: 10,
      maxWaiting: 100,
      maxWaitingPerKey: 50,
      maxWaitMs: 5000,
    });
    // Answered well inside the probe's 10 s slow-request threshold.
    expect(PROBE_SCHEDULING_MAX_WAIT_MS).toBeLessThan(10_000);
    expect(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS).toBeGreaterThan(0);
  });

  test("the defaults of the monitor test lane: 2 at once, a queue for a large fleet's probe replicas", () => {
    expect(ProbeSchedulingMaxConcurrentMonitorTestRequests).toBe(2);
    expect(
      ProbeSchedulingLimiterInstance.laneLimits(
        ProbeSchedulingLane.MonitorTests,
      ),
    ).toEqual({
      maxRunning: 2,
      maxRunningPerKey: 2,
      maxWaiting: 200,
      maxWaitingPerKey: 200,
      maxWaitMs: 5000,
    });
    expect(monitorTestLaneLimits(10).maxWaiting).toBe(500);
    expect(monitorTestLaneLimits(0).maxRunning).toBe(1);
  });

  test("limits for any size: at least one at once, and one probe may hold them all", () => {
    expect(probeSchedulingLimits(1)).toEqual({
      maxRunning: 1,
      maxRunningPerKey: 1,
      maxWaiting: 10,
      maxWaitingPerKey: 5,
      maxWaitMs: 5000,
    });
    expect(probeSchedulingLimits(3).maxRunningPerKey).toBe(3);
    expect(probeSchedulingLimits(0).maxRunning).toBe(1);
    expect(probeSchedulingLimits(7.9).maxRunning).toBe(7);
  });

  test("one probe alone may use every slot; another probe's request takes the next one freed", async () => {
    const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
      probeSchedulingLimits(4),
    );
    const started: Array<string> = [];
    const finishers: Map<string, () => void> = new Map<string, () => void>();
    const work: (label: string) => () => Promise<void> = (
      label: string,
    ): (() => Promise<void>) => {
      return (): Promise<void> => {
        started.push(label);
        return new Promise<void>((resolve: () => void): void => {
          finishers.set(label, resolve);
        });
      };
    };

    const runs: Array<Promise<void>> = [1, 2, 3, 4, 5, 6].map(
      (index: number): Promise<void> => {
        return limiter.run("probe-a", work(`a${index}`));
      },
    );
    await settle();

    // It used to be two of the four: half, for one probe, however idle.
    expect(started).toEqual(["a1", "a2", "a3", "a4"]);
    expect(limiter.runningCount("probe-a")).toBe(4);

    runs.push(limiter.run("probe-b", work("b1")));
    await settle();
    expect(limiter.waitingCount("probe-b")).toBe(1);

    // a5 and a6 came first; probe-b holds no slot, so it is next.
    finishers.get("a1")!();
    await settle();
    expect(started).toEqual(["a1", "a2", "a3", "a4", "b1"]);

    finishers.get("a2")!();
    await settle();
    expect(started).toEqual(["a1", "a2", "a3", "a4", "b1", "a5"]);

    for (let round: number = 0; round < 3; round++) {
      for (const finish of Array.from(finishers.values())) {
        finish();
      }
      await settle();
    }
    await Promise.all(runs);
    expect(limiter.runningCount()).toBe(0);
  });

  test("probes that compete for the slots get equal shares, whatever each sends", async () => {
    const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
      probeSchedulingLimits(6),
    );
    const finishers: Array<{ probe: string; finish: () => void }> = [];
    const runs: Array<Promise<void>> = [];
    const launch: (probe: string) => void = (probe: string): void => {
      runs.push(
        limiter.run(probe, (): Promise<void> => {
          return new Promise<void>((resolve: () => void): void => {
            finishers.push({ probe, finish: resolve });
          });
        }),
      );
    };

    // One probe with many replicas, two with one each.
    for (let index: number = 0; index < 24; index++) {
      launch("many-replicas");
    }
    for (let index: number = 0; index < 8; index++) {
      launch("one-replica-a");
      launch("one-replica-b");
    }
    await settle();
    expect(limiter.runningCount("many-replicas")).toBe(6);

    // Requests finish one at a time, the oldest first.
    for (let step: number = 0; step < 12; step++) {
      finishers.shift()!.finish();
      await settle();
    }

    expect([
      limiter.runningCount("many-replicas"),
      limiter.runningCount("one-replica-a"),
      limiter.runningCount("one-replica-b"),
    ]).toEqual([2, 2, 2]);

    while (finishers.length > 0) {
      finishers.shift()!.finish();
      await settle();
    }
    await Promise.all(runs);
    expect(limiter.runningCount()).toBe(0);
  });

  test("a refused request is a 429 with the busy message, and its work never runs", async () => {
    const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
      ...probeSchedulingLimits(1),
      maxWaiting: 0,
    });
    const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
    const work: Mock<() => Promise<void>> = jest.fn(async (): Promise<void> => {
      return undefined;
    });

    const refusal: unknown = await limiter.run("probe-b", work).then(
      (): null => {
        return null;
      },
      (error: unknown): unknown => {
        return error;
      },
    );

    expect(refusal).toBeInstanceOf(ProbeSchedulingBusyError);
    expect(refusal).toBeInstanceOf(TooManyRequestsException);
    expect((refusal as TooManyRequestsException).code).toBe(
      ExceptionCode.TooManyRequestsException,
    );
    expect((refusal as Error).message).toBe(PROBE_SCHEDULING_BUSY_MESSAGE);
    expect(work).not.toHaveBeenCalled();

    await expect(limiter.acquire("probe-c")).rejects.toBeInstanceOf(
      ProbeSchedulingBusyError,
    );
    held();
  });

  test("a request whose probe hung up while it waited never runs", async () => {
    const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
      probeSchedulingLimits(1),
    );
    const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
    const controller: AbortController = new AbortController();
    const waiting: Promise<KeyedConcurrencyRelease> = limiter.acquire(
      "probe-b",
      { signal: controller.signal },
    );
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ProbeSchedulingAbandonedError);
    expect(limiter.waitingCount()).toBe(0);
    held();
  });

  describe("the busy warning", () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
    });

    test("is said at most once a minute, with how many requests were refused since", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
        ...probeSchedulingLimits(1),
        maxWaiting: 0,
      });
      const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
      const warn: jest.Mock = logger.warn as unknown as jest.Mock;

      for (let index: number = 0; index < 5; index++) {
        await limiter.acquire("probe-b").catch((): void => {
          return undefined;
        });
      }
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        "PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS=1",
      );

      jest.advanceTimersByTime(PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS);
      await limiter.acquire("probe-b").catch((): void => {
        return undefined;
      });
      expect(warn).toHaveBeenCalledTimes(2);
      // The four refused since the first warning, and this one.
      expect(String(warn.mock.calls[1]![0])).toContain(
        "5 probe request(s) answered busy since the last report",
      );
      held();
    });
  });

  /*
   * On 27 November 2026 every replica refused every probe request for
   * twelve hours, and the busy warning above - a warn line, on servers that
   * log errors only - was all that said so (ProbeSchedulingRefusalAlarm).
   */
  describe("the refusal alarm", () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
      jest.setSystemTime(new Date("2026-11-27T04:09:00.000Z"));
    });

    function alarms(mock: jest.Mock, prefix: string): Array<Array<unknown>> {
      return mock.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).startsWith(prefix);
      });
    }

    test("most requests refused for minutes is an error line every five minutes, never one a request; handed out again, it is over", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
        ...probeSchedulingLimits(1),
        maxWaiting: 0,
      });
      // The one slot, held for good: the lane hands out nothing.
      const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
      const error: jest.Mock = logger.error as unknown as jest.Mock;
      const warn: jest.Mock = logger.warn as unknown as jest.Mock;

      // Ten minutes of it, a request refused every six seconds.
      for (let index: number = 0; index < 100; index++) {
        await limiter.acquire("probe-b").catch((): void => {
          return undefined;
        });
        jest.advanceTimersByTime(6000);
      }

      // Raised at 04:12, three minutes in, and again at 04:17.
      const raised: Array<Array<unknown>> = alarms(
        error,
        PROBE_ALARM_LOG_PREFIX,
      );
      expect(raised).toHaveLength(2);
      expect(error).toHaveBeenCalledTimes(2);
      expect(String(raised[0]![0])).toBe(
        "Probe alarm: this App replica has answered 30 of 31 probe requests busy in its work lane since 2026-11-27T04:09:00.000Z (3 min), so the probes that ask it are refused most of the monitors and other work they ask for, and their checks wait past their time. Now 1 requests are running and 0 waiting for its 1 slots (PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS=1). /metrics/probe-scheduling shows how every App replica hands out probe work.",
      );
      expect(raised[0]![1]).toEqual({
        [PROBE_ALARM_ATTRIBUTE_KEY]: ProbeAlarm.SchedulingRefused,
      });
      expect(String(raised[1]![0])).toContain(
        "has answered 80 of 81 probe requests busy in its work lane since 2026-11-27T04:09:00.000Z (8 min)",
      );

      // The busy warning goes on beside it, once a minute.
      expect(warn).toHaveBeenCalledTimes(10);

      // The slot comes back, and a minute of requests is handed out.
      held();
      for (let index: number = 0; index < 10; index++) {
        (await limiter.acquire("probe-b"))();
        jest.advanceTimersByTime(6000);
      }
      (await limiter.acquire("probe-b"))();

      const ended: Array<Array<unknown>> = alarms(
        warn,
        PROBE_ALARM_OVER_LOG_PREFIX,
      );
      expect(ended).toHaveLength(1);
      expect(String(ended[0]![0])).toBe(
        "Probe alarm over: this App replica hands out probe work again in its work lane. It had answered 100 of 101 probe requests busy there from 2026-11-27T04:09:00.000Z to 2026-11-27T04:19:00.000Z (10 min).",
      );
      expect(error).toHaveBeenCalledTimes(2);
    });

    test("a moment of refusals, however many, raises nothing", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
        ...probeSchedulingLimits(1),
        maxWaiting: 0,
      });
      const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");

      for (let index: number = 0; index < 500; index++) {
        await limiter.acquire("probe-b").catch((): void => {
          return undefined;
        });
      }
      held();

      // Then a few minutes of work handed out.
      for (let index: number = 0; index < 30; index++) {
        jest.advanceTimersByTime(10_000);
        (await limiter.acquire("probe-b"))();
      }

      expect(logger.error).not.toHaveBeenCalled();
      expect(
        alarms(
          logger.warn as unknown as jest.Mock,
          PROBE_ALARM_OVER_LOG_PREFIX,
        ),
      ).toEqual([]);
    });
  });
  /*
   * Test Monitor runs (#10819): someone is waiting on the Dashboard for
   * each, and their fetches used to wait in the same queue as every monitor
   * fetch of the same probe - a fleet catching up had them answered busy,
   * and the test never ran.
   */
  describe("the monitor test lane", () => {
    test("a test fetch runs while every work slot is held and the work queue is full", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
        { ...probeSchedulingLimits(2), maxWaiting: 2, maxWaitingPerKey: 2 },
        monitorTestLaneLimits(1),
      );
      const held: Array<KeyedConcurrencyRelease> = [
        await limiter.acquire("probe-a"),
        await limiter.acquire("probe-a"),
      ];
      const queued: Array<Promise<KeyedConcurrencyRelease>> = [
        limiter.acquire("probe-a"),
        limiter.acquire("probe-a"),
      ];
      await settle();
      await expect(limiter.acquire("probe-a")).rejects.toBeInstanceOf(
        ProbeSchedulingBusyError,
      );

      const test: KeyedConcurrencyRelease = await limiter.acquire("probe-a", {
        lane: ProbeSchedulingLane.MonitorTests,
      });

      expect(
        limiter.runningCount("probe-a", ProbeSchedulingLane.MonitorTests),
      ).toBe(1);
      expect(limiter.runningCount("probe-a")).toBe(2);
      expect(limiter.waitingCount("probe-a")).toBe(2);

      test();
      for (const release of held) {
        release();
      }
      for (const waiting of queued) {
        (await waiting)();
      }
      expect(limiter.runningCount()).toBe(0);
    });

    test("test fetches queue among themselves, and a busy test lane leaves the work lane alone", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
        probeSchedulingLimits(2),
        { ...monitorTestLaneLimits(1), maxWaiting: 1, maxWaitingPerKey: 1 },
      );
      const tests: { lane: ProbeSchedulingLane } = {
        lane: ProbeSchedulingLane.MonitorTests,
      };
      const running: KeyedConcurrencyRelease = await limiter.acquire(
        "probe-a",
        tests,
      );
      const waiting: Promise<KeyedConcurrencyRelease> = limiter.acquire(
        "probe-b",
        tests,
      );
      await settle();

      await expect(limiter.acquire("probe-c", tests)).rejects.toBeInstanceOf(
        ProbeSchedulingBusyError,
      );

      // The work lane is untouched by the test lane's queue.
      const work: KeyedConcurrencyRelease = await limiter.acquire("probe-c");
      expect(limiter.runningCount()).toBe(1);

      running();
      (await waiting)();
      work();
      expect(
        limiter.runningCount(undefined, ProbeSchedulingLane.MonitorTests),
      ).toBe(0);
    });

    test("a busy test lane is said in the log under its own setting", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
        probeSchedulingLimits(2),
        { ...monitorTestLaneLimits(1), maxWaiting: 0, maxWaitingPerKey: 0 },
      );
      const tests: { lane: ProbeSchedulingLane } = {
        lane: ProbeSchedulingLane.MonitorTests,
      };
      const held: KeyedConcurrencyRelease = await limiter.acquire(
        "probe-a",
        tests,
      );
      const warn: jest.Mock = logger.warn as unknown as jest.Mock;

      await limiter.acquire("probe-b", tests).catch((): void => {
        return undefined;
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        "in the monitor test lane (PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS=1",
      );
      held();
    });
  });

  describe("what it reports (ProbeSchedulingMetrics)", () => {
    test("each lane's running, waiting and slots, as they are now", async () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
        probeSchedulingLimits(1),
        monitorTestLaneLimits(3),
      );
      const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
      const waiting: Promise<KeyedConcurrencyRelease> =
        limiter.acquire("probe-b");
      await settle();

      const snapshot: ProbeSchedulingMetricsSnapshot =
        limiter.metrics.snapshot();

      expect(snapshot.lanes[ProbeSchedulingLane.Work]).toMatchObject({
        running: 1,
        waiting: 1,
        maxConcurrentRequests: 1,
      });
      expect(snapshot.lanes[ProbeSchedulingLane.MonitorTests]).toMatchObject({
        running: 0,
        waiting: 0,
        maxConcurrentRequests: 3,
      });

      held();
      (await waiting)();
    });

    test("how long each request waited for its slot, by lane", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });

      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
        probeSchedulingLimits(1),
      );
      const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
      const waiting: Promise<KeyedConcurrencyRelease> =
        limiter.acquire("probe-b");
      await settle();

      jest.advanceTimersByTime(1200);
      held();
      (await waiting)();

      const work: ProbeSchedulingLaneMetrics =
        limiter.metrics.snapshot().lanes[ProbeSchedulingLane.Work]!;

      expect(work.slotWaitMs.count).toBe(2);
      expect(work.slotWaitMs.max).toBe(1200);
      expect(work.refused).toBe(0);
      expect(
        limiter.metrics.snapshot().lanes[ProbeSchedulingLane.MonitorTests]!
          .slotWaitMs.count,
      ).toBe(0);
    });

    test("each refusal, by lane and by why: a full queue, or a wait that ran out", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });

      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
        ...probeSchedulingLimits(1),
        maxWaiting: 1,
        maxWaitingPerKey: 1,
      });
      const held: KeyedConcurrencyRelease = await limiter.acquire("probe-a");
      const waited: Promise<unknown> = limiter
        .acquire("probe-b")
        .catch((error: unknown): unknown => {
          return error;
        });
      await settle();

      const full: unknown = await limiter
        .acquire("probe-c")
        .catch((error: unknown): unknown => {
          return error;
        });
      expect((full as ProbeSchedulingBusyError).reason).toBe(
        KeyedConcurrencyRefusal.QueueFull,
      );

      jest.advanceTimersByTime(PROBE_SCHEDULING_MAX_WAIT_MS);
      expect(((await waited) as ProbeSchedulingBusyError).reason).toBe(
        KeyedConcurrencyRefusal.WaitedTooLong,
      );

      const work: ProbeSchedulingLaneMetrics =
        limiter.metrics.snapshot().lanes[ProbeSchedulingLane.Work]!;
      expect(work).toMatchObject({
        refused: 2,
        refusedQueueFull: 1,
        refusedWaitedTooLong: 1,
      });
      held();
    });

    test("only the process's own limiter reports to the process's metrics", () => {
      const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
        probeSchedulingLimits(1),
      );

      expect(limiter.metrics).not.toBe(ProbeSchedulingMetricsInstance);
      expect(ProbeSchedulingLimiterInstance.metrics).toBe(
        ProbeSchedulingMetricsInstance,
      );
    });
  });

  /*
   * The limit is per process, as the pool it protects is: each App replica
   * runs its own, so the bound for the fleet - and its capacity - is the
   * limit times the replicas, and a probe's requests that reach several
   * replicas use each one's slots.
   */
  describe("across App replicas", () => {
    test("each replica bounds its own requests; together they run the limit times the replicas", async () => {
      const replicas: Array<ProbeSchedulingLimiter> = [1, 2, 3].map(
        (): ProbeSchedulingLimiter => {
          return new ProbeSchedulingLimiter(probeSchedulingLimits(2));
        },
      );
      const finishers: Array<() => void> = [];
      const runs: Array<Promise<void>> = [];

      // One probe's 12 requests, spread over the replicas in turn.
      for (let request: number = 0; request < 12; request++) {
        runs.push(
          replicas[request % 3]!.run("probe-a", (): Promise<void> => {
            return new Promise<void>((resolve: () => void): void => {
              finishers.push(resolve);
            });
          }),
        );
      }
      await settle();

      expect(
        replicas.map((replica: ProbeSchedulingLimiter): number => {
          return replica.runningCount("probe-a");
        }),
      ).toEqual([2, 2, 2]);
      expect(
        replicas.reduce((sum: number, replica: ProbeSchedulingLimiter) => {
          return sum + replica.runningCount() + replica.waitingCount();
        }, 0),
      ).toBe(12);

      while (finishers.length > 0) {
        finishers.shift()!();
        await settle();
        for (const replica of replicas) {
          expect(replica.runningCount()).toBeLessThanOrEqual(2);
        }
      }
      await Promise.all(runs);
    });
  });
});
