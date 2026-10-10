/**
 * CertificateReissueOrder - Reissue SSL for status page and dashboard domains.
 *
 * Its contract, in order: take the name's order lock (refused, cooldown
 * untouched, when it is taken); claim the cooldown with a conditional write
 * (refused, nothing ordered, when no row was written); order under the lock;
 * give the cooldown back only when nothing was ordered - never when the order
 * itself failed. The lock is always released.
 *
 * The lock is the real CertificateOrderLock over an in-memory Redis, so a
 * held lock refuses exactly as it does across replicas.
 */

import CertificateReissueOrder from "../../../../Server/Utils/Greenlock/CertificateReissueOrder";
import CertificateOrderLock, {
  CertificateOrderLockHandle,
} from "../../../../Server/Utils/Greenlock/CertificateOrderLock";
import { CertificateOrderOutcome } from "../../../../Server/Utils/Greenlock/CertificateOrderOutcome";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import CertificateReissueUtil from "../../../../Utils/CertificateReissue";
import BadDataException from "../../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const DOMAIN: string = "status.acme.com";
const LOCK_KEY: string = `${CertificateOrderLock.NAMESPACE}-${DOMAIN}`;
const NOW: Date = new Date("2026-03-10T12:00:00.000Z");

const LOCK_TAKEN_MESSAGE: string =
  "A certificate for this domain is being ordered right now. Please try again in a few minutes.";
const ROW_GONE_MESSAGE: string =
  "Could not start a certificate reissue for this domain. Please refresh the page and try again.";
const NOTHING_ORDERED_MESSAGE: string =
  "This installation has used up its new certificates from Let's Encrypt for the moment. Nothing was ordered, and this does not count as your reissue. Please try again in 15 minutes.";

type ReissueCalls = {
  steps: Array<string>;
  claimCooldown: jest.Mock<Promise<number>, []>;
  giveCooldownBack: jest.Mock<Promise<void>, []>;
  order: jest.Mock<
    Promise<CertificateOrderOutcome>,
    [CertificateOrderLockHandle]
  >;
};

/*
 * The three callbacks a domain service hands over, recording the order they
 * run in and, for the order, whether the lock was held while it ran.
 */
function makeCalls(options: {
  claimed?: number;
  claimError?: Error;
  outcome?: CertificateOrderOutcome;
  orderError?: Error;
  giveBackError?: Error;
}): ReissueCalls {
  const steps: Array<string> = [];

  return {
    steps: steps,
    claimCooldown: jest.fn(async (): Promise<number> => {
      steps.push("claimCooldown");

      if (options.claimError) {
        throw options.claimError;
      }

      return options.claimed ?? 1;
    }),
    giveCooldownBack: jest.fn(async (): Promise<void> => {
      steps.push("giveCooldownBack");

      if (options.giveBackError) {
        throw options.giveBackError;
      }
    }),
    order: jest.fn(
      async (
        lock: CertificateOrderLockHandle,
      ): Promise<CertificateOrderOutcome> => {
        steps.push(
          `order(held=${CertificateOrderLock.isHeldFor(lock, DOMAIN)})`,
        );

        if (options.orderError) {
          throw options.orderError;
        }

        return options.outcome ?? CertificateOrderOutcome.Ordered;
      },
    ),
  };
}

async function reissue(
  calls: ReissueCalls,
  extra?: { domain?: string; lastReissueRequestedAt?: Date | undefined },
): Promise<void> {
  await CertificateReissueOrder.reissue({
    domain: extra?.domain ?? DOMAIN,
    now: NOW,
    lastReissueRequestedAt: extra?.lastReissueRequestedAt,
    claimCooldown: calls.claimCooldown,
    giveCooldownBack: calls.giveCooldownBack,
    order: calls.order,
  });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected the reissue to be refused, and it was not.");
}

describe("CertificateReissueOrder.reissue", () => {
  let redis: InMemoryRedis;
  let errorLogs: Array<unknown>;

  beforeEach(() => {
    redis = useInMemoryRedis();
    errorLogs = [];
    jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
      errorLogs.push(message);
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("an order that goes through", () => {
    test("takes the lock, claims the cooldown, then orders with the lock held - and keeps the cooldown", async () => {
      const calls: ReissueCalls = makeCalls({});

      await reissue(calls);

      expect(calls.steps).toEqual(["claimCooldown", "order(held=true)"]);
      expect(calls.giveCooldownBack).not.toHaveBeenCalled();
      expect(redis.lockRequests).toEqual([
        expect.objectContaining({
          key: DOMAIN,
          namespace: CertificateOrderLock.NAMESPACE,
          acquireAttemptsLimit: 1,
        }),
      ]);
    });

    test("hands the order the handle of the name it locked, and releases it afterwards", async () => {
      const calls: ReissueCalls = makeCalls({});

      await reissue(calls);

      const lock: CertificateOrderLockHandle = calls.order.mock
        .calls[0]![0] as CertificateOrderLockHandle;

      expect(lock.domain).toBe(DOMAIN);
      expect(CertificateOrderLock.isHeldFor(lock, DOMAIN)).toBe(false);
      expect(redis.heldLocks.size).toBe(0);
    });

    test("locks the normalized name, so a differently cased request shares one lock", async () => {
      const calls: ReissueCalls = makeCalls({});

      await reissue(calls, { domain: "  Status.ACME.com " });

      expect(redis.lockRequests[0]?.key).toBe(DOMAIN);
      expect(calls.steps).toEqual(["claimCooldown", "order(held=true)"]);
    });

    test("one domain's reissue does not hold up another's", async () => {
      const other: CertificateOrderLockHandle | null =
        await CertificateOrderLock.tryLock("other.acme.com");
      expect(other).not.toBeNull();

      const calls: ReissueCalls = makeCalls({});
      await reissue(calls);

      expect(calls.order).toHaveBeenCalledTimes(1);
      await CertificateOrderLock.release(other!);
    });
  });

  describe("the lock is taken", () => {
    test("refuses without claiming the cooldown or ordering", async () => {
      const held: CertificateOrderLockHandle | null =
        await CertificateOrderLock.tryLock(DOMAIN);
      expect(held).not.toBeNull();

      const calls: ReissueCalls = makeCalls({});
      const err: Error = await captureError(reissue(calls));

      expect(err).toBeInstanceOf(TooManyRequestsException);
      expect(err.message).toBe(LOCK_TAKEN_MESSAGE);
      expect(calls.steps).toEqual([]);

      // The other order's lock is not released by the refused reissue.
      expect(redis.heldLocks.has(LOCK_KEY)).toBe(true);
      expect(CertificateOrderLock.isHeldFor(held!, DOMAIN)).toBe(true);
      await CertificateOrderLock.release(held!);
    });

    test("a second reissue while the first is ordering is refused, and the first still orders", async () => {
      let secondError: Error | undefined;
      const second: ReissueCalls = makeCalls({});

      const first: ReissueCalls = makeCalls({});
      first.order.mockImplementation(
        async (): Promise<CertificateOrderOutcome> => {
          secondError = await captureError(reissue(second));
          return CertificateOrderOutcome.Ordered;
        },
      );

      await reissue(first);

      expect(secondError).toBeInstanceOf(TooManyRequestsException);
      expect(secondError?.message).toBe(LOCK_TAKEN_MESSAGE);
      expect(second.steps).toEqual([]);
      expect(first.claimCooldown).toHaveBeenCalledTimes(1);
      expect(redis.heldLocks.size).toBe(0);

      // Once the first is done, the name can be reissued again.
      const third: ReissueCalls = makeCalls({});
      await reissue(third);
      expect(third.order).toHaveBeenCalledTimes(1);
    });

    test("the lock cannot be taken at all (Redis is down): refused, nothing claimed or ordered", async () => {
      redis.goDown();

      const calls: ReissueCalls = makeCalls({});
      const err: Error = await captureError(reissue(calls));

      expect(err).toBeInstanceOf(TooManyRequestsException);
      expect(err.message).toBe(LOCK_TAKEN_MESSAGE);
      expect(calls.steps).toEqual([]);
    });
  });

  describe("the cooldown cannot be claimed", () => {
    test("still cooling down: refused with the countdown the dashboard shows, nothing ordered", async () => {
      const lastReissueRequestedAt: Date = new Date("2026-03-10T02:30:00.000Z");
      const calls: ReissueCalls = makeCalls({ claimed: 0 });

      const err: Error = await captureError(
        reissue(calls, { lastReissueRequestedAt }),
      );

      expect(err).toBeInstanceOf(TooManyRequestsException);
      expect(err.message).toBe(
        CertificateReissueUtil.getCooldownMessage(lastReissueRequestedAt, NOW),
      );
      // 02:30 + 24h is 02:30 tomorrow: 14h30m from noon.
      expect(err.message).toContain("Please try again in 14 hours 30 minutes.");
      expect(calls.steps).toEqual(["claimCooldown"]);
      expect(redis.heldLocks.size).toBe(0);
    });

    test("never reissued yet the row was not written (claimed by another request, or deleted): refused as bad data", async () => {
      const calls: ReissueCalls = makeCalls({ claimed: 0 });

      const err: Error = await captureError(reissue(calls));

      expect(err).toBeInstanceOf(BadDataException);
      expect(err).not.toBeInstanceOf(TooManyRequestsException);
      expect(err.message).toBe(ROW_GONE_MESSAGE);
      expect(calls.steps).toEqual(["claimCooldown"]);
      expect(redis.heldLocks.size).toBe(0);
    });

    test("a claim that fails is passed on, with the lock released and nothing ordered or given back", async () => {
      const claimError: Error = new Error("database is unavailable");
      const calls: ReissueCalls = makeCalls({ claimError });

      const err: Error = await captureError(reissue(calls));

      expect(err).toBe(claimError);
      expect(calls.steps).toEqual(["claimCooldown"]);
      expect(redis.heldLocks.size).toBe(0);
    });

    test("any positive row count is a claim", async () => {
      const calls: ReissueCalls = makeCalls({ claimed: 2 });

      await reissue(calls);

      expect(calls.order).toHaveBeenCalledTimes(1);
    });
  });

  describe("nothing was ordered", () => {
    test.each([
      CertificateOrderOutcome.LimitReached,
      CertificateOrderOutcome.NotOrderedNow,
      CertificateOrderOutcome.AlreadyIssued,
    ])(
      "%s: the cooldown is given back after the order, and the customer is told to try again shortly",
      async (outcome: CertificateOrderOutcome) => {
        const calls: ReissueCalls = makeCalls({ outcome });

        const err: Error = await captureError(reissue(calls));

        expect(err).toBeInstanceOf(TooManyRequestsException);
        expect(err.message).toBe(NOTHING_ORDERED_MESSAGE);
        expect(calls.steps).toEqual([
          "claimCooldown",
          "order(held=true)",
          "giveCooldownBack",
        ]);
        expect(redis.heldLocks.size).toBe(0);
      },
    );

    test("the cooldown is given back while the lock is still held", async () => {
      const calls: ReissueCalls = makeCalls({
        outcome: CertificateOrderOutcome.LimitReached,
      });
      let heldDuringGiveBack: boolean | undefined;
      calls.giveCooldownBack.mockImplementation(async (): Promise<void> => {
        heldDuringGiveBack = redis.heldLocks.has(LOCK_KEY);
      });

      await captureError(reissue(calls));

      expect(heldDuringGiveBack).toBe(true);
    });

    test("a give-back that fails is logged against the domain, and the customer still hears nothing was ordered", async () => {
      const giveBackError: Error = new Error("write failed");
      const calls: ReissueCalls = makeCalls({
        outcome: CertificateOrderOutcome.LimitReached,
        giveBackError,
      });

      const err: Error = await captureError(reissue(calls));

      expect(err).toBeInstanceOf(TooManyRequestsException);
      expect(err.message).toBe(NOTHING_ORDERED_MESSAGE);
      expect(errorLogs).toContain(giveBackError);
      expect(logger.error).toHaveBeenCalledWith(giveBackError, {
        fullDomain: DOMAIN,
      });
      expect(redis.heldLocks.size).toBe(0);
    });
  });

  describe("the order fails", () => {
    test("the error is passed on, the cooldown is kept (a failed order still cost a validation), and the lock is released", async () => {
      const orderError: Error = new Error("CA rejected the challenge");
      const calls: ReissueCalls = makeCalls({ orderError });

      const err: Error = await captureError(reissue(calls));

      expect(err).toBe(orderError);
      expect(calls.steps).toEqual(["claimCooldown", "order(held=true)"]);
      expect(calls.giveCooldownBack).not.toHaveBeenCalled();
      expect(redis.heldLocks.size).toBe(0);
    });
  });

  test("a lock that cannot be released does not fail a reissue that went through", async () => {
    jest
      .spyOn(Semaphore, "release")
      .mockRejectedValue(new Error("Redis went away") as never);

    const calls: ReissueCalls = makeCalls({});

    await expect(reissue(calls)).resolves.toBeUndefined();
    expect(calls.order).toHaveBeenCalledTimes(1);
  });
});
