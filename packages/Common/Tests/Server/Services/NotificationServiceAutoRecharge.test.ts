import NotificationService, {
  SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS,
  SMS_OR_CALL_RECHARGE_LOCK_NAMESPACE,
} from "../../../Server/Services/NotificationService";
import { AI_RECHARGE_LOCK_NAMESPACE } from "../../../Server/Services/AIBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import { AutoRechargeSettings } from "../../../Server/Utils/Billing/BalanceRechargeGuard";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import AutoRechargeState from "../../../Types/Billing/AutoRechargeState";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  MessagingBalanceWorld,
  useMessagingBalanceWorld,
} from "../TestingUtils/MessagingBalanceWorld";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * NotificationService: how a project's balance for SMS, calls, WhatsApp and
 * Telegram is recharged - the twin of AIBillingService for AI credits.
 *
 * - Auto Recharge recharges when the balance is below the one it is set to
 *   recharge at, by the amount it is set to add - when a message finds it
 *   low, and when somebody turns it on.
 * - One recharge at a time per project: every recharge takes one lock and
 *   reads the balance again holding it, so the messages of a paging storm
 *   that find the balance low together charge the card once. They used to
 *   each charge it.
 * - The credit is one statement that adds to the balance as it is when the
 *   charge lands: a message's cost taken meanwhile, and a second recharge,
 *   are never written over. It used to write back "the balance read before
 *   the charge, plus the amount".
 * - An automatic recharge never charges without the lock, and never waits
 *   for a shared cache that is not connected: the message goes out on the
 *   balance there is, and the next message tries again.
 * - After a failed automatic charge, Auto Recharge waits an hour before it
 *   tries the card again; a recharge by hand, or saving Auto Recharge, tries
 *   at once and ends the wait when it works.
 */

type MockBillingGlobal = typeof globalThis & {
  __messagingAutoRechargeTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__messagingAutoRechargeTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__messagingAutoRechargeTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (
    globalThis as MockBillingGlobal
  ).__messagingAutoRechargeTestBillingEnabled = value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000d1",
);

const FAILURE_KEY: string = `sms-or-call-auto-recharge-failed-${PROJECT_ID.toString()}`;

let world: MessagingBalanceWorld;

beforeEach(() => {
  setBillingEnabled(true);
  world = useMessagingBalanceWorld(PROJECT_ID, {
    smsOrCallCurrentBalanceInUSDCents: 0,
    enableAutoRechargeSmsOrCallBalance: true,
    autoRechargeSmsOrCallByBalanceInUSD: 20,
    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
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

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

function loggedErrors(): Array<string> {
  return (logger.error as unknown as jest.SpyInstance).mock.calls.map(
    (call: Array<unknown>) => {
      return String(call[0]);
    },
  );
}

describe("NotificationService.getAutoRechargeSettings", () => {
  test("on, with an amount to add and a balance to add it at: set up", () => {
    const settings: AutoRechargeSettings =
      NotificationService.getAutoRechargeSettings(
        row({
          enableAutoRechargeSmsOrCallBalance: true,
          autoRechargeSmsOrCallByBalanceInUSD: 50,
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 25,
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
      NotificationService.getAutoRechargeSettings(
        row({
          enableAutoRechargeSmsOrCallBalance: false,
          autoRechargeSmsOrCallByBalanceInUSD: 20,
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
        }),
      ).isSetUp,
    ).toBe(false);
  });

  test.each([
    ["no amount", { autoRechargeSmsOrCallByBalanceInUSD: 0 }],
    ["an unset amount", { autoRechargeSmsOrCallByBalanceInUSD: null }],
    ["no threshold", { autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 0 }],
    [
      "an unset threshold",
      { autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: undefined },
    ],
  ])(
    "on with %s: not set up, so nothing can be recharged",
    (_case: string, overrides: Record<string, unknown>) => {
      expect(
        NotificationService.getAutoRechargeSettings(
          row({
            enableAutoRechargeSmsOrCallBalance: true,
            autoRechargeSmsOrCallByBalanceInUSD: 20,
            autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
            ...overrides,
          }),
        ).isSetUp,
      ).toBe(false);
    },
  );

  test("a change not written yet decides over the row", () => {
    expect(
      NotificationService.getAutoRechargeSettings(
        row({
          enableAutoRechargeSmsOrCallBalance: false,
          autoRechargeSmsOrCallByBalanceInUSD: 20,
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
        }),
        {
          enableAutoRechargeSmsOrCallBalance: true,
          autoRechargeSmsOrCallByBalanceInUSD: 100,
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 50,
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
      NotificationService.getAutoRechargeSettings(
        row({
          enableAutoRechargeSmsOrCallBalance: false,
          autoRechargeSmsOrCallByBalanceInUSD: 25,
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
        }),
        { enableAutoRechargeSmsOrCallBalance: true },
      ),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 25,
      whenBalanceFallsToInUSD: 10,
    });
  });

  test("a change that sets an amount to nothing is taken at its word (it used to fall back to the stored one)", () => {
    expect(
      NotificationService.getAutoRechargeSettings(
        row({
          enableAutoRechargeSmsOrCallBalance: false,
          autoRechargeSmsOrCallByBalanceInUSD: 20,
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
        }),
        {
          enableAutoRechargeSmsOrCallBalance: true,
          autoRechargeSmsOrCallByBalanceInUSD: 0,
        },
      ),
    ).toEqual({
      isSetUp: false,
      rechargeByInUSD: 0,
      whenBalanceFallsToInUSD: 10,
    });
  });

  test("amounts sent as text count as numbers", () => {
    expect(
      NotificationService.getAutoRechargeSettings(
        row({
          enableAutoRechargeSmsOrCallBalance: true,
          autoRechargeSmsOrCallByBalanceInUSD: "20",
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: "10",
        }),
      ),
    ).toEqual({
      isSetUp: true,
      rechargeByInUSD: 20,
      whenBalanceFallsToInUSD: 10,
    });
  });
});

describe("NotificationService.getAutoRechargeState", () => {
  async function stateOf(values: Record<string, unknown>): Promise<string> {
    return NotificationService.getAutoRechargeState({
      projectId: PROJECT_ID,
      project: row({
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: 20,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
        ...values,
      }),
    });
  }

  test("on and set up, with no recent failure: Ready", async () => {
    expect(await stateOf({})).toBe(AutoRechargeState.Ready);
  });

  test("off: Off", async () => {
    expect(await stateOf({ enableAutoRechargeSmsOrCallBalance: false })).toBe(
      AutoRechargeState.Off,
    );
  });

  test("on with nothing to add: Off", async () => {
    expect(await stateOf({ autoRechargeSmsOrCallByBalanceInUSD: 0 })).toBe(
      AutoRechargeState.Off,
    );
  });

  test("its last automatic charge failed within the hour: Failed", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");

    expect(await stateOf({})).toBe(AutoRechargeState.Failed);
  });

  test("an AI credits failure is not this balance's: Ready", async () => {
    world.cache.set(
      `ai-auto-recharge-failed-${PROJECT_ID.toString()}`,
      "2026-10-07T08:00:00.000Z",
    );

    expect(await stateOf({})).toBe(AutoRechargeState.Ready);
  });

  test("a failure that cannot be read (the shared cache is down) reads as none: Ready", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");
    world.setCacheConnected(false);

    expect(await stateOf({})).toBe(AutoRechargeState.Ready);
  });
});

describe("NotificationService.rechargeIfBalanceIsLow", () => {
  test("below the threshold: charges the set amount once, adds it, and answers the new balance", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 250;

    const balance: number =
      await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(world.charges).toEqual([20]);
    expect(balance).toBe(2250);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(2250);
  });

  test("the charge is an SMS or Call Balance Recharge on the project's own customer", async () => {
    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    const call: Array<unknown> = (
      BillingService.generateInvoiceAndChargeCustomer as unknown as jest.SpyInstance
    ).mock.calls[0] as Array<unknown>;

    expect(call[0]).toBe("cus_messaging_balance_world");
    expect(call[1]).toBe("SMS or Call Balance Recharge");
    expect(call[2]).toBe(20);
  });

  test("the balance is added in one statement, in whole cents: never a balance computed before the charge", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 250;

    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(ProjectService.creditSmsOrCallBalanceInUSDCents).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, amountInUSDCents: 2000 },
    );

    // No write of a balance it worked out itself.
    for (const call of (
      ProjectService.updateOneById as unknown as jest.SpyInstance
    ).mock.calls) {
      expect(
        Object.keys((call[0] as { data: Record<string, unknown> }).data),
      ).not.toContain("smsOrCallCurrentBalanceInUSDCents");
    }
  });

  test("a message's cost taken while the card is charged is kept (it used to be written over)", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 500;
    world.setChargeDelayInMs(30);

    const recharge: Promise<number> =
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    // An SMS is paid for while the payment provider answers.
    await wait(10);
    await ProjectService.deductSmsOrCallBalanceInUSDCents({
      projectId: PROJECT_ID,
      amountInUSDCents: 7,
    });

    expect(await recharge).toBe(500 - 7 + 2000);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(2493);
  });

  test("the credit re-arms the owners' notices, low balance included", async () => {
    world.row.lowCallAndSMSBalanceNotificationSentToOwners = true;
    world.row.failedCallAndSMSBalanceChargeNotificationSentToOwners = true;

    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(world.row.lowCallAndSMSBalanceNotificationSentToOwners).toBe(false);
    expect(
      world.row.failedCallAndSMSBalanceChargeNotificationSentToOwners,
    ).toBe(false);
  });

  test("at or above the threshold: nothing is charged, and no lock is taken", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 1000;

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      1000,
    );
    expect(world.charges).toEqual([]);
    expect(world.locksTaken()).toBe(0);
  });

  test("Auto Recharge off: nothing is charged, however low", async () => {
    world.row.enableAutoRechargeSmsOrCallBalance = false;
    world.row.smsOrCallCurrentBalanceInUSDCents = -35;

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      -35,
    );
    expect(world.charges).toEqual([]);
    expect(BillingService.hasPaymentMethods).not.toHaveBeenCalled();
  });

  test("where OneUptime does not bill (self-hosted): nothing is read or charged", async () => {
    setBillingEnabled(false);

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      0,
    );
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(world.charges).toEqual([]);
  });

  test("it takes the project's recharge lock - not the AI credits' - and gives it back", async () => {
    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: PROJECT_ID.toString(),
        namespace: SMS_OR_CALL_RECHARGE_LOCK_NAMESPACE,
      }),
    );
    expect(SMS_OR_CALL_RECHARGE_LOCK_NAMESPACE).not.toBe(
      AI_RECHARGE_LOCK_NAMESPACE,
    );
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("ten messages at once: the card is charged once, and every one is answered the recharged balance", async () => {
    const balances: Array<number> = await Promise.all(
      Array.from({ length: 10 }, () => {
        return NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
      }),
    );

    expect(world.charges).toEqual([20]);
    expect(world.mostLockHoldersAtOnce()).toBe(1);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(2000);
    expect(new Set(balances)).toEqual(new Set([2000]));
  });

  test("a waiter finds the balance the first recharge added, and charges nothing", async () => {
    world.setChargeDelayInMs(40);

    const first: Promise<number> =
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
    await wait(5);
    const second: Promise<number> =
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(await first).toBe(2000);
    expect(await second).toBe(2000);
    expect(world.charges).toEqual([20]);
  });

  test("the lock cannot be taken: nothing is charged, the balance is answered as it is, and it says why", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 300;
    world.failLocksWith(new Error("Lock timed out"));

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      300,
    );
    expect(world.charges).toEqual([]);
    expect(BillingService.hasPaymentMethods).not.toHaveBeenCalled();
    expect(
      loggedErrors().some((line: string) => {
        return line.includes(
          `Auto Recharge of project ${PROJECT_ID.toString()} did not run: the recharge lock could not be taken`,
        );
      }),
    ).toBe(true);
  });

  test("the shared cache is down: no lock is even tried (a message never waits for it), and nothing is charged", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 300;
    world.setCacheConnected(false);

    const startedAt: number = Date.now();

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      300,
    );

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(Semaphore.lock).not.toHaveBeenCalled();
    expect(world.charges).toEqual([]);
    expect(
      loggedErrors().some((line: string) => {
        return line.includes("the shared cache is not connected");
      }),
    ).toBe(true);
  });

  test("the shared cache is back: the next message recharges", async () => {
    world.setCacheConnected(false);
    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
    expect(world.charges).toEqual([]);

    world.setCacheConnected(true);

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      2000,
    );
    expect(world.charges).toEqual([20]);
  });

  test("a charge that fails throws, and Auto Recharge waits an hour before trying the card again", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("Your card was declined.");

    expect(world.cache.has(FAILURE_KEY)).toBe(true);
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "sms-or-call-auto-recharge-failed",
      PROJECT_ID.toString(),
      expect.any(String),
      { expiresInSeconds: SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS },
    );
    expect(SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(3600);

    // The next message within the hour: no lock, no charge.
    world.failChargesWith(null);
    const locksBefore: number = world.locksTaken();

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      0,
    );
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).toHaveBeenCalledTimes(1);
    expect(world.locksTaken()).toBe(locksBefore);
  });

  test("ten messages after a failed charge: the card is not tried again by any of them", async () => {
    world.failChargesWith(new Error("Your card was declined."));
    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow();

    world.failChargesWith(null);

    await Promise.all(
      Array.from({ length: 10 }, () => {
        return NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
      }),
    );

    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).toHaveBeenCalledTimes(1);
  });

  test("the failed charge tells the owners once a day, as it always has", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    for (let attempt: number = 0; attempt < 3; attempt++) {
      world.cache.delete(FAILURE_KEY);
      await expect(
        NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
      ).rejects.toThrow();
    }

    expect(
      world.ownerEmails.filter((email: { subject: string }) => {
        return email.subject.startsWith(
          "ACTION REQUIRED: SMS and Call Recharge Failed",
        );
      }),
    ).toHaveLength(1);
  });

  test("no payment method: the wait starts too, and the provider is never asked to charge", async () => {
    world.setHasPaymentMethods(false);

    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow(BadDataException);

    expect(world.cache.has(FAILURE_KEY)).toBe(true);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).not.toHaveBeenCalled();
  });

  test("once the hour has passed (the wait has expired), the card is tried again", async () => {
    world.failChargesWith(new Error("Your card was declined."));
    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow();

    // The shared cache lets the key expire after the hour.
    world.cache.delete(FAILURE_KEY);
    world.failChargesWith(null);

    expect(await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID)).toBe(
      2000,
    );
    expect(world.charges).toEqual([20]);
  });

  test("somebody saving Auto Recharge tries the card at once, whatever failed before, and ends the wait", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");

    expect(
      await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID, {
        enableAutoRechargeSmsOrCallBalance: true,
        ignoreRecentFailure: true,
      }),
    ).toBe(2000);
    expect(world.charges).toEqual([20]);
    expect(world.cache.has(FAILURE_KEY)).toBe(false);
  });

  test("turning Auto Recharge on uses the amounts being saved, before they are written", async () => {
    world.row.enableAutoRechargeSmsOrCallBalance = false;

    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID, {
      enableAutoRechargeSmsOrCallBalance: true,
      autoRechargeSmsOrCallByBalanceInUSD: 50,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 25,
    });

    expect(world.charges).toEqual([50]);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(5000);
  });

  test("turning Auto Recharge on with no amount to add charges nothing, whatever amount was stored", async () => {
    world.row.enableAutoRechargeSmsOrCallBalance = false;

    expect(
      await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID, {
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: 0,
      }),
    ).toBe(0);
    expect(world.charges).toEqual([]);
  });

  test("charged, but the balance could not be written: it says so plainly, and starts no wait", async () => {
    (
      ProjectService.creditSmsOrCallBalanceInUSDCents as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("database unavailable"));

    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("database unavailable");

    expect(world.charges).toEqual([20]);
    expect(world.cache.has(FAILURE_KEY)).toBe(false);
    expect(
      world.ownerEmails.filter((email: { subject: string }) => {
        return email.subject.startsWith("ACTION REQUIRED");
      }),
    ).toEqual([]);
    expect(
      loggedErrors().some((line: string) => {
        return line.includes(
          "was charged 20 USD for SMS and call balance, and the balance could not be added",
        );
      }),
    ).toBe(true);
  });

  test("a successful automatic recharge mails the owners nothing", async () => {
    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(world.ownerEmails).toEqual([]);
  });
});

describe("NotificationService.rechargeBalance (the Recharge button)", () => {
  test("charges the amount asked for and confirms it to the owners", async () => {
    world.row.smsOrCallCurrentBalanceInUSDCents = 500;

    expect(await NotificationService.rechargeBalance(PROJECT_ID, 25)).toBe(
      3000,
    );
    expect(world.charges).toEqual([25]);
    expect(
      world.ownerEmails.map((email: { subject: string }) => {
        return email.subject;
      }),
    ).toEqual(["SMS and Call Recharge Successful for project - Acme Production"]);
    expect(world.ownerEmails[0]!.body).toContain(
      "Your current balance is 30 USD.",
    );
  });

  test("takes the same lock as Auto Recharge, and gives it back when the charge fails", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 25),
    ).rejects.toThrow("Your card was declined.");

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: SMS_OR_CALL_RECHARGE_LOCK_NAMESPACE,
      }),
    );
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("a recharge by hand that fails does not start Auto Recharge's wait", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 25),
    ).rejects.toThrow();

    expect(world.cache.has(FAILURE_KEY)).toBe(false);
  });

  test("one that works ends Auto Recharge's wait: the card works", async () => {
    world.cache.set(FAILURE_KEY, "2026-10-07T08:00:00.000Z");

    await NotificationService.rechargeBalance(PROJECT_ID, 25);

    expect(world.cache.has(FAILURE_KEY)).toBe(false);
    expect(
      await NotificationService.getAutoRechargeState({
        projectId: PROJECT_ID,
        project: world.row as unknown as Project,
      }),
    ).toBe(AutoRechargeState.Ready);
  });

  test("goes ahead without the lock: the person who asked is told whether it worked", async () => {
    world.failLocksWith(new Error("Lock timed out"));

    expect(await NotificationService.rechargeBalance(PROJECT_ID, 25)).toBe(
      2500,
    );
    expect(world.charges).toEqual([25]);
    expect(Semaphore.release).not.toHaveBeenCalled();
  });

  test("two recharges by hand side by side: both are credited", async () => {
    world.failLocksWith(new Error("Lock timed out"));

    await Promise.all([
      NotificationService.rechargeBalance(PROJECT_ID, 20),
      NotificationService.rechargeBalance(PROJECT_ID, 30),
    ]);

    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(5000);
  });

  test("an automatic recharge waiting behind it finds the balance it added, and charges nothing", async () => {
    world.setChargeDelayInMs(40);

    const byHand: Promise<number> = NotificationService.rechargeBalance(
      PROJECT_ID,
      25,
    );
    await wait(5);
    const automatic: Promise<number> =
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(await byHand).toBe(2500);
    expect(await automatic).toBe(2500);
    expect(world.charges).toEqual([25]);
  });

  test("where billing is off, it refuses", async () => {
    setBillingEnabled(false);

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 25),
    ).rejects.toThrow("Billing is not enabled");
    expect(world.charges).toEqual([]);
  });
});
