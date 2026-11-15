import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS,
  PROBE_SCHEDULING_MAX_WAIT_MS,
  ProbeSchedulingAbandonedError,
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
  probeSchedulingLimits,
} from "../../../../Server/Utils/Probe/ProbeSchedulingLimiter";
import { ProbeSchedulingMaxConcurrentRequests } from "../../../../Server/EnvironmentConfig";
import { KeyedConcurrencyRelease } from "../../../../Server/Utils/KeyedConcurrencyLimiter";
import logger from "../../../../Server/Utils/Logger";
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

  test("the defaults: a fifth of the pool at once, half of that for one probe, a bounded queue, a 5 s wait", () => {
    expect(ProbeSchedulingMaxConcurrentRequests).toBe(10);
    expect(ProbeSchedulingLimiterInstance.limits).toEqual({
      maxRunning: 10,
      maxRunningPerKey: 5,
      maxWaiting: 100,
      maxWaitingPerKey: 50,
      maxWaitMs: 5000,
    });
    // Answered well inside the probe's 10 s slow-request threshold.
    expect(PROBE_SCHEDULING_MAX_WAIT_MS).toBeLessThan(10_000);
    expect(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS).toBeGreaterThan(0);
  });

  test("limits for any size: at least one at once and one per probe", () => {
    expect(probeSchedulingLimits(1)).toEqual({
      maxRunning: 1,
      maxRunningPerKey: 1,
      maxWaiting: 10,
      maxWaitingPerKey: 5,
      maxWaitMs: 5000,
    });
    expect(probeSchedulingLimits(3).maxRunningPerKey).toBe(2);
    expect(probeSchedulingLimits(0).maxRunning).toBe(1);
  });

  test("one probe's requests take at most their share; another probe's start at once", async () => {
    const limiter: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
      probeSchedulingLimits(4),
    );
    const started: Array<string> = [];
    const finishers: Array<() => void> = [];
    const work: (label: string) => () => Promise<void> = (
      label: string,
    ): (() => Promise<void>) => {
      return (): Promise<void> => {
        started.push(label);
        return new Promise<void>((resolve: () => void): void => {
          finishers.push(resolve);
        });
      };
    };

    const runs: Array<Promise<void>> = [
      limiter.run("probe-a", work("a1")),
      limiter.run("probe-a", work("a2")),
      limiter.run("probe-a", work("a3")),
      limiter.run("probe-b", work("b1")),
    ];
    await settle();

    expect(started).toEqual(["a1", "a2", "b1"]);
    expect(limiter.runningCount("probe-a")).toBe(2);
    expect(limiter.waitingCount("probe-a")).toBe(1);

    finishers[0]!();
    await settle();
    expect(started).toEqual(["a1", "a2", "b1", "a3"]);

    for (const finish of finishers) {
      finish();
    }
    await settle();
    for (const finish of finishers) {
      finish();
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
});
