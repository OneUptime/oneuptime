import BalanceRechargeGuard, {
  AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS,
  getAutoRechargeSettings,
  RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS,
  RECHARGE_LOCK_TIMEOUT_IN_MS,
} from "../../../../Server/Utils/Billing/BalanceRechargeGuard";
import { AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS } from "../../../../Server/Services/AIBillingService";
import { SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS } from "../../../../Server/Services/NotificationService";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What the two prepaid balances share when they are recharged
 * (Utils/Billing/BalanceRechargeGuard): the per-project recharge lock in the
 * shared cache, and the hour Auto Recharge waits after a failed automatic
 * charge.
 *
 * The rule the messaging balance needs most: a message must never wait for a
 * shared cache that is not there. The lock is answered "no" at once when the
 * cache is not connected - Semaphore.lock would otherwise queue the command
 * and wait for the cache to come back (or for the acquire timeout) while a
 * page waits behind it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000e1",
);

const guard: BalanceRechargeGuard = new BalanceRechargeGuard({
  balanceName: "Test balance",
  lockNamespace: "Test.recharge",
  failureNamespace: "test-auto-recharge-failed",
});

let errors: Array<string>;

beforeEach(() => {
  errors = [];
  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the recharge lock", () => {
  test("is taken per project, in the balance's own namespace, long enough for the payment provider", async () => {
    const mutex: SemaphoreMutex = {} as SemaphoreMutex;
    const lock: jest.SpyInstance = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue(mutex);

    expect(await guard.takeLock(PROJECT_ID)).toBe(mutex);
    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: PROJECT_ID.toString(),
        namespace: "Test.recharge",
        lockTimeout: RECHARGE_LOCK_TIMEOUT_IN_MS,
        acquireTimeout: RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS,
      }),
    );
    expect(RECHARGE_LOCK_TIMEOUT_IN_MS).toBe(30_000);
    expect(RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS).toBe(30_000);
  });

  test("the shared cache is not connected: no lock, at once, without asking for one", async () => {
    (Redis.isConnected as unknown as jest.SpyInstance).mockReturnValue(false);
    const lock: jest.SpyInstance = jest.spyOn(Semaphore, "lock");

    expect(await guard.takeLock(PROJECT_ID)).toBeNull();
    expect(lock).not.toHaveBeenCalled();
    expect(errors).toEqual([
      `Test balance: could not take the recharge lock of project ${PROJECT_ID.toString()}: the shared cache is not connected.`,
    ]);
  });

  test("a lock that cannot be taken (a recharge under way that did not finish in time) is no lock, said in the log", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Acquire mutex timeout"));

    expect(await guard.takeLock(PROJECT_ID)).toBeNull();
    expect(errors[0]).toContain(
      `Test balance: could not take the recharge lock of project ${PROJECT_ID.toString()}`,
    );
    expect(errors[0]).toContain("Acquire mutex timeout");
  });

  test("a lock lost while it is held is said in the log, not thrown from a timer", async () => {
    let onLockLost: ((err: Error) => void) | undefined;

    jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
      onLockLost?: (err: Error) => void;
    }) => {
      onLockLost = data.onLockLost;
      return {} as SemaphoreMutex;
    }) as never);

    await guard.takeLock(PROJECT_ID);

    expect(onLockLost).toBeDefined();
    expect(() => {
      onLockLost!(new Error("refresh failed"));
    }).not.toThrow();
    expect(errors[0]).toContain("was lost while it was held");
  });

  test("giving back no lock does nothing", async () => {
    const release: jest.SpyInstance = jest.spyOn(Semaphore, "release");

    await guard.releaseLock(null, PROJECT_ID);

    expect(release).not.toHaveBeenCalled();
  });

  test("a lock that cannot be given back is said in the log, not thrown at the caller", async () => {
    jest
      .spyOn(Semaphore, "release")
      .mockRejectedValue(new Error("connection reset"));

    await expect(
      guard.releaseLock({} as SemaphoreMutex, PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(errors[0]).toContain("could not release the recharge lock");
  });
});

describe("the wait after a failed automatic charge", () => {
  test("is an hour, for both balances", () => {
    expect(AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(60 * 60);
    expect(SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(
      AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS,
    );
    expect(AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(
      AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS,
    );
  });

  test("is remembered in the balance's own namespace, and expires on its own after the hour", async () => {
    const setString: jest.SpyInstance = jest
      .spyOn(GlobalCache, "setString")
      .mockResolvedValue(undefined);

    await guard.rememberFailure(PROJECT_ID);

    expect(setString).toHaveBeenCalledWith(
      "test-auto-recharge-failed",
      PROJECT_ID.toString(),
      expect.any(String),
      { expiresInSeconds: AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS },
    );

    // When it failed, as an ISO time.
    const when: string = setString.mock.calls[0]![2] as string;
    expect(new Date(when).toISOString()).toBe(when);
  });

  test("is read from the shared cache", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockResolvedValueOnce("2026-10-07T08:00:00.000Z")
      .mockResolvedValueOnce(null);

    expect(await guard.hasRecentFailure(PROJECT_ID)).toBe(true);
    expect(await guard.hasRecentFailure(PROJECT_ID)).toBe(false);
  });

  test("a failure that cannot be read reads as none (nothing is charged without the cache anyway)", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Cache is not connected"));

    expect(await guard.hasRecentFailure(PROJECT_ID)).toBe(false);
    expect(errors[0]).toContain("could not read whether Auto Recharge");
  });

  test("ends when a charge works", async () => {
    const deleteKey: jest.SpyInstance = jest
      .spyOn(GlobalCache, "deleteKey")
      .mockResolvedValue(undefined);

    await guard.forgetFailure(PROJECT_ID);

    expect(deleteKey).toHaveBeenCalledWith(
      "test-auto-recharge-failed",
      PROJECT_ID.toString(),
    );
  });

  test("a cache that cannot be written is said in the log, never thrown at a recharge", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockRejectedValue(new Error("Cache is not connected"));

    await expect(guard.rememberFailure(PROJECT_ID)).resolves.toBeUndefined();
    await expect(guard.forgetFailure(PROJECT_ID)).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);
  });
});

describe("getAutoRechargeSettings: what Auto Recharge is set to", () => {
  test("on, with an amount and a threshold: set up", () => {
    expect(
      getAutoRechargeSettings({
        isEnabled: true,
        rechargeByInUSD: { stored: 20 },
        whenBalanceFallsToInUSD: { stored: 10 },
      }),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 20,
      whenBalanceFallsToInUSD: 10,
    });
  });

  test("off: not set up", () => {
    expect(
      getAutoRechargeSettings({
        isEnabled: false,
        rechargeByInUSD: { stored: 20 },
        whenBalanceFallsToInUSD: { stored: 10 },
      }).isSetUp,
    ).toBe(false);
  });

  test("a change decides over what is stored, even to nothing", () => {
    expect(
      getAutoRechargeSettings({
        isEnabled: true,
        rechargeByInUSD: { changed: 0, stored: 20 },
        whenBalanceFallsToInUSD: { changed: 50, stored: 10 },
      }),
    ).toEqual({
      isSetUp: false,
      rechargeByInUSD: 0,
      whenBalanceFallsToInUSD: 50,
    });
  });

  test("a change that names nothing (undefined or null) keeps what is stored", () => {
    expect(
      getAutoRechargeSettings({
        isEnabled: true,
        rechargeByInUSD: { changed: undefined, stored: 25 },
        whenBalanceFallsToInUSD: { changed: null, stored: 10 },
      }),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 25,
      whenBalanceFallsToInUSD: 10,
    });
  });

  test("anything that is not a number counts as nothing", () => {
    expect(
      getAutoRechargeSettings({
        isEnabled: true,
        rechargeByInUSD: { stored: "twenty" as unknown as number },
        whenBalanceFallsToInUSD: { stored: 10 },
      }),
    ).toEqual({
      isSetUp: false,
      rechargeByInUSD: 0,
      whenBalanceFallsToInUSD: 10,
    });
  });
});
