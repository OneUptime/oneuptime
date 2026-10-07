import AIBillingService, {
  AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS,
  AI_RECHARGE_LOCK_NAMESPACE,
  AiAutoRechargeSettings,
} from "../../../Server/Services/AIBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import AiAutoRechargeState from "../../../Types/Billing/AiAutoRechargeState";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  AiCreditsWorld,
  useAiCreditsWorld,
} from "../TestingUtils/AiCreditsWorld";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AIBillingService: how a project's AI credits are recharged.
 *
 * - Auto Recharge recharges when the credits are below the balance it is set
 *   to recharge at, by the amount it is set to add - before a billed AI call
 *   that found them used up, after every billed call, and when somebody
 *   turns it on.
 * - One recharge at a time per project: every recharge takes one lock and
 *   reads the balance again holding it, so callers arriving together charge
 *   the card once. An automatic recharge never charges without the lock.
 * - The credit is one atomic add, so whatever was billed meanwhile, and a
 *   second recharge, is never written over.
 * - After a failed automatic charge, Auto Recharge waits an hour before it
 *   tries the card again; a recharge by hand, or saving Auto Recharge, tries
 *   at once and ends the wait when it works.
 */

type MockBillingGlobal = typeof globalThis & {
  __aiBillingAutoRechargeTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__aiBillingAutoRechargeTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__aiBillingAutoRechargeTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__aiBillingAutoRechargeTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000c1",
);

const FAILURE_KEY: string = `ai-auto-recharge-failed-${PROJECT_ID.toString()}`;

let world: AiCreditsWorld;

beforeEach(() => {
  setBillingEnabled(true);
  world = useAiCreditsWorld(PROJECT_ID, {
    aiCurrentBalanceInUSDCents: 0,
    enableAutoRechargeAiBalance: true,
    autoAiRechargeByBalanceInUSD: 20,
    autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(true);
});

function row(values: Record<string, unknown>): Project {
  return values as unknown as Project;
}

describe("AIBillingService.getAutoRechargeSettings", () => {
  test("on, with an amount to add and a balance to add it at: set up", () => {
    const settings: AiAutoRechargeSettings =
      AIBillingService.getAutoRechargeSettings(
        row({
          enableAutoRechargeAiBalance: true,
          autoAiRechargeByBalanceInUSD: 50,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: 25,
        }),
      );

    expect(settings).toEqual({
      isSetUp: true,
      rechargeByInUSD: 50,
      whenBalanceFallsToInUSD: 25,
    });
  });

  test("off: not set up, whatever the amounts", () => {
    expect(
      AIBillingService.getAutoRechargeSettings(
        row({
          enableAutoRechargeAiBalance: false,
          autoAiRechargeByBalanceInUSD: 20,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
        }),
      ).isSetUp,
    ).toBe(false);
  });

  test.each([
    ["no amount", { autoAiRechargeByBalanceInUSD: 0 }],
    ["an unset amount", { autoAiRechargeByBalanceInUSD: null }],
    ["no threshold", { autoRechargeAiWhenCurrentBalanceFallsInUSD: 0 }],
    [
      "an unset threshold",
      { autoRechargeAiWhenCurrentBalanceFallsInUSD: undefined },
    ],
  ])(
    "on with %s: not set up, so nothing can be recharged",
    (_case: string, overrides: Record<string, unknown>) => {
      expect(
        AIBillingService.getAutoRechargeSettings(
          row({
            enableAutoRechargeAiBalance: true,
            autoAiRechargeByBalanceInUSD: 20,
            autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
            ...overrides,
          }),
        ).isSetUp,
      ).toBe(false);
    },
  );

  test("a change not written yet decides over the row: turning it on, with new amounts", () => {
    expect(
      AIBillingService.getAutoRechargeSettings(
        row({
          enableAutoRechargeAiBalance: false,
          autoAiRechargeByBalanceInUSD: 20,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
        }),
        {
          enableAutoRechargeAiBalance: true,
          autoAiRechargeByBalanceInUSD: 100,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: 50,
        },
      ),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 100,
      whenBalanceFallsToInUSD: 50,
    });
  });

  test("a change that names no amounts keeps the stored ones", () => {
    expect(
      AIBillingService.getAutoRechargeSettings(
        row({
          enableAutoRechargeAiBalance: false,
          autoAiRechargeByBalanceInUSD: 25,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
        }),
        { enableAutoRechargeAiBalance: true },
      ),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 25,
      whenBalanceFallsToInUSD: 10,
    });
  });

  test("amounts sent as text count as numbers", () => {
    expect(
      AIBillingService.getAutoRechargeSettings(
        row({
          enableAutoRechargeAiBalance: true,
          autoAiRechargeByBalanceInUSD: "20",
          autoRechargeAiWhenCurrentBalanceFallsInUSD: "10",
        }),
      ),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 20,
      whenBalanceFallsToInUSD: 10,
    });
  });
});

describe("AIBillingService.getAutoRechargeState", () => {
  async function stateOf(values: Record<string, unknown>): Promise<string> {
    return AIBillingService.getAutoRechargeState({
      projectId: PROJECT_ID,
      project: row({
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: 20,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
        ...values,
      }),
    });
  }

  test("on and set up, with no recent failure: Ready", async () => {
    expect(await stateOf({})).toBe(AiAutoRechargeState.Ready);
  });

  test("off: Off", async () => {
    expect(await stateOf({ enableAutoRechargeAiBalance: false })).toBe(
      AiAutoRechargeState.Off,
    );
  });

  test("on with nothing to add: Off", async () => {
    expect(await stateOf({ autoAiRechargeByBalanceInUSD: 0 })).toBe(
      AiAutoRechargeState.Off,
    );
  });

  test("its last charge failed within the hour: Failed", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");

    expect(await stateOf({})).toBe(AiAutoRechargeState.Failed);
  });

  test("a failure that cannot be read reads as none: Ready", async () => {
    (GlobalCache.getString as unknown as jest.SpyInstance).mockRejectedValue(
      new Error("Cache is not connected"),
    );

    expect(await stateOf({})).toBe(AiAutoRechargeState.Ready);
  });
});

describe("AIBillingService.rechargeIfBalanceIsLow", () => {
  test("below the threshold: charges the set amount once, adds it, and answers the new balance", async () => {
    world.row.aiCurrentBalanceInUSDCents = 250;

    const balance: number =
      await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(world.charges).toEqual([20]);
    expect(balance).toBe(2250);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(2250);
  });

  test("the charge is an AI Balance Recharge on the project's own customer", async () => {
    await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);

    const call: Array<unknown> = (
      BillingService.generateInvoiceAndChargeCustomer as unknown as jest.SpyInstance
    ).mock.calls[0] as Array<unknown>;

    expect(call[0]).toBe("cus_ai_credits_world");
    expect(call[1]).toBe("AI Balance Recharge");
    expect(call[2]).toBe(20);
  });

  test("the credit is added to the balance as it is when the charge lands, not written back over it", async () => {
    world.row.aiCurrentBalanceInUSDCents = 100;
    world.setChargeDelayInMs(30);

    const recharge: Promise<number> =
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);

    // An AI call is billed while the payment provider answers.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
    world.row.aiCurrentBalanceInUSDCents -= 40;

    await recharge;

    expect(world.row.aiCurrentBalanceInUSDCents).toBe(100 - 40 + 2000);
  });

  test("at or above the threshold: nothing is charged, and no lock is taken", async () => {
    world.row.aiCurrentBalanceInUSDCents = 1000;

    expect(await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      1000,
    );
    expect(world.charges).toEqual([]);
    expect(world.locksTaken()).toBe(0);
  });

  test("Auto Recharge off: nothing is charged, however low", async () => {
    world.row.enableAutoRechargeAiBalance = false;
    world.row.aiCurrentBalanceInUSDCents = -500;

    expect(await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      -500,
    );
    expect(world.charges).toEqual([]);
    expect(BillingService.hasPaymentMethods).not.toHaveBeenCalled();
  });

  test("where OneUptime does not bill (self-hosted): nothing is read or charged", async () => {
    setBillingEnabled(false);

    expect(await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(0);
    expect(world.charges).toEqual([]);
    expect(world.locksTaken()).toBe(0);
  });

  test("it takes the project's recharge lock, and gives it back", async () => {
    await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: PROJECT_ID.toString(),
        namespace: AI_RECHARGE_LOCK_NAMESPACE,
      }),
    );
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("ten callers at once: the card is charged once, and every one answers the recharged balance", async () => {
    const balances: Array<number> = await Promise.all(
      Array.from({ length: 10 }, () => {
        return AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);
      }),
    );

    expect(world.charges).toEqual([20]);
    expect(world.mostLockHoldersAtOnce()).toBe(1);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(2000);
    expect(new Set(balances)).toEqual(new Set([2000]));
  });

  test("without the lock (the shared cache is down) nothing is charged: two servers could each charge the card", async () => {
    world.failLocksWith(new Error("Redis client is not connected"));

    expect(await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(0);
    expect(world.charges).toEqual([]);
    expect(BillingService.hasPaymentMethods).not.toHaveBeenCalled();
  });

  test("a charge that fails throws, and Auto Recharge waits an hour before trying the card again", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("Your card was declined.");

    expect(world.cache.has(FAILURE_KEY)).toBe(true);
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "ai-auto-recharge-failed",
      PROJECT_ID.toString(),
      expect.any(String),
      { expiresInSeconds: AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS },
    );
    expect(AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(3600);

    // The next caller within the hour: no lock, no charge.
    world.failChargesWith(null);

    expect(await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(0);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).toHaveBeenCalledTimes(1);
  });

  test("no payment method: the wait starts too, and the provider is never asked to charge", async () => {
    world.setHasPaymentMethods(false);

    await expect(
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow(BadDataException);

    expect(world.cache.has(FAILURE_KEY)).toBe(true);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).not.toHaveBeenCalled();
  });

  test("once the hour has passed (the wait has expired), the card is tried again", async () => {
    world.failChargesWith(new Error("Your card was declined."));
    await expect(
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow();

    // The shared cache lets the key expire after the hour.
    world.cache.delete(FAILURE_KEY);
    world.failChargesWith(null);

    expect(await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      2000,
    );
    expect(world.charges).toEqual([20]);
  });

  test("somebody saving Auto Recharge tries the card at once, whatever failed before", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");

    expect(
      await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID, {
        enableAutoRechargeAiBalance: true,
        ignoreRecentFailure: true,
      }),
    ).toBe(2000);
    expect(world.charges).toEqual([20]);
    // It worked: the wait is over.
    expect(world.cache.has(FAILURE_KEY)).toBe(false);
  });

  test("turning Auto Recharge on uses the amounts being saved, before they are written", async () => {
    world.row.enableAutoRechargeAiBalance = false;

    await AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID, {
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 50,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 25,
    });

    expect(world.charges).toEqual([50]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(5000);
  });

  test("a waiter finds the credits the first recharge added, and charges nothing", async () => {
    world.setChargeDelayInMs(40);

    const first: Promise<number> =
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
    const second: Promise<number> =
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(await first).toBe(2000);
    expect(await second).toBe(2000);
    expect(world.charges).toEqual([20]);
  });

  test("charged, but the credits could not be written: it says so plainly, and starts no wait", async () => {
    (
      ProjectService.atomicAddToColumnsByIdWithoutHooks as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("database unavailable"));

    await expect(
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("database unavailable");

    expect(world.charges).toEqual([20]);
    expect(world.cache.has(FAILURE_KEY)).toBe(false);
    expect(
      world.ownerEmails.filter((email: { subject: string }) => {
        return email.subject.startsWith("ACTION REQUIRED");
      }),
    ).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "was charged 20 USD for AI credits, and the credits could not be added",
      ),
    );
  });
});

describe("AIBillingService.rechargeBalance (the Recharge button)", () => {
  test("charges the amount asked for and confirms it to the owners", async () => {
    world.row.aiCurrentBalanceInUSDCents = 500;

    expect(await AIBillingService.rechargeBalance(PROJECT_ID, 25)).toBe(3000);
    expect(world.charges).toEqual([25]);
    expect(world.ownerEmails.map((email: { subject: string }) => email.subject))
      .toEqual(["AI Balance Recharge Successful for project - Acme Production"]);
  });

  test("takes the same lock as Auto Recharge, and gives it back when the charge fails", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 25),
    ).rejects.toThrow("Your card was declined.");

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: AI_RECHARGE_LOCK_NAMESPACE }),
    );
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("a recharge by hand that fails does not start Auto Recharge's wait", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 25),
    ).rejects.toThrow();

    expect(world.cache.has(FAILURE_KEY)).toBe(false);
  });

  test("one that works ends Auto Recharge's wait: the card works", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");

    await AIBillingService.rechargeBalance(PROJECT_ID, 25);

    expect(world.cache.has(FAILURE_KEY)).toBe(false);
    expect(
      await AIBillingService.getAutoRechargeState({
        projectId: PROJECT_ID,
        project: world.row as unknown as Project,
      }),
    ).toBe(AiAutoRechargeState.Ready);
  });

  test("goes ahead without the lock: the person who asked is told whether it worked", async () => {
    world.failLocksWith(new Error("Redis client is not connected"));

    expect(await AIBillingService.rechargeBalance(PROJECT_ID, 25)).toBe(2500);
    expect(world.charges).toEqual([25]);
    expect(Semaphore.release).not.toHaveBeenCalled();
  });

  test("an automatic recharge waiting behind it finds the credits it added, and charges nothing", async () => {
    world.setChargeDelayInMs(40);

    const byHand: Promise<number> = AIBillingService.rechargeBalance(
      PROJECT_ID,
      25,
    );
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
    const automatic: Promise<number> =
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(await byHand).toBe(2500);
    expect(await automatic).toBe(2500);
    expect(world.charges).toEqual([25]);
  });

  test("where billing is off, it refuses", async () => {
    setBillingEnabled(false);

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 25),
    ).rejects.toThrow("Billing is not enabled");
    expect(world.charges).toEqual([]);
  });
});
