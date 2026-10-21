import GlobalCache from "../../Infrastructure/GlobalCache";
import Redis from "../../Infrastructure/Redis";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * What a project's two prepaid balances share when they are recharged - its
 * balance for SMS, calls, WhatsApp and Telegram (NotificationService) and
 * its AI credits (AIBillingService):
 *
 * - One recharge at a time, per project and balance. Every recharge takes a
 *   lock in the shared cache first, and reads the balance again once it
 *   holds it. So the messages or AI calls that find the balance low at the
 *   same moment charge the card once: the first recharges, and the others,
 *   waiting their turn, find what it added and charge nothing.
 * - The wait after an automatic charge failed (no payment method, a
 *   declined card): Auto Recharge does not try the card again for
 *   AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS. Without it, every message or AI
 *   call made while the balance is low would try the card once more, each
 *   try a voided invoice at the payment provider and, repeated, a card the
 *   bank starts to refuse. A recharge by hand, or saving Auto Recharge
 *   again, tries at once and, when it works, ends the wait.
 *
 * Without the shared cache there is no lock, and nothing waits for one: a
 * cache that is not connected answers at once, so a message is never held
 * up looking for it. The caller decides what to do without the lock - an
 * automatic recharge charges nothing (two servers could each charge the
 * card), a recharge somebody asked for goes ahead (they are told whether it
 * worked, and the credit is one statement whatever else is writing).
 */

/*
 * How long Auto Recharge waits after a failed automatic charge before it
 * tries the card again: an hour, for both balances. Long enough that a
 * paging storm on a declined card tries it once, not once per message; short
 * enough that a card fixed without anyone recharging by hand is tried again
 * the same hour. The balance is recharged when it falls below its threshold
 * (10 USD unless changed), so messages keep going out on what is left while
 * Auto Recharge waits.
 */
export const AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS: number = 60 * 60;

// Long enough for the payment provider; refreshed while it is held.
export const RECHARGE_LOCK_TIMEOUT_IN_MS: number = 30_000;

// How long a caller waits for a recharge already under way.
export const RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS: number = 30_000;

// What Auto Recharge is set to, from the project row or a change to it.
export interface AutoRechargeSettings {
  isSetUp: boolean;
  rechargeByInUSD: number;
  whenBalanceFallsToInUSD: number;
}

/*
 * Auto Recharge can only refill a balance when it is on and has an amount
 * to add and a balance to add it at. The dashboard asks for both, and they
 * default to 20 and 10 USD, so "on" almost always means "set up"; one set to
 * nothing through the API recharges nothing, so it counts as off everywhere.
 *
 * A change not written yet (somebody saving Auto Recharge) decides over the
 * row: what it sets, even to nothing; otherwise what is stored.
 */
export const getAutoRechargeSettings: (data: {
  isEnabled: boolean;
  rechargeByInUSD: {
    changed?: number | undefined | null;
    stored?: number | undefined | null;
  };
  whenBalanceFallsToInUSD: {
    changed?: number | undefined | null;
    stored?: number | undefined | null;
  };
}) => AutoRechargeSettings = (data: {
  isEnabled: boolean;
  rechargeByInUSD: {
    changed?: number | undefined | null;
    stored?: number | undefined | null;
  };
  whenBalanceFallsToInUSD: {
    changed?: number | undefined | null;
    stored?: number | undefined | null;
  };
}): AutoRechargeSettings => {
  const pick: (amount: {
    changed?: number | undefined | null;
    stored?: number | undefined | null;
  }) => number = (amount: {
    changed?: number | undefined | null;
    stored?: number | undefined | null;
  }): number => {
    const value: number | undefined | null =
      amount.changed !== undefined && amount.changed !== null
        ? amount.changed
        : amount.stored;

    return Number(value || 0) || 0;
  };

  const rechargeByInUSD: number = pick(data.rechargeByInUSD);
  const whenBalanceFallsToInUSD: number = pick(data.whenBalanceFallsToInUSD);

  return {
    isSetUp:
      data.isEnabled && rechargeByInUSD > 0 && whenBalanceFallsToInUSD > 0,
    rechargeByInUSD,
    whenBalanceFallsToInUSD,
  };
};

export interface BalanceRechargeGuardOptions {
  // What the balance is called in log lines: "AI credits".
  balanceName: string;
  // The recharge lock's namespace in the shared cache.
  lockNamespace: string;
  // Where a failed automatic charge is remembered, in the shared cache.
  failureNamespace: string;
}

export default class BalanceRechargeGuard {
  private readonly options: BalanceRechargeGuardOptions;

  public constructor(options: BalanceRechargeGuardOptions) {
    this.options = options;
  }

  public getLockNamespace(): string {
    return this.options.lockNamespace;
  }

  public getFailureNamespace(): string {
    return this.options.failureNamespace;
  }

  /*
   * The recharge lock, or null when it cannot be taken: the shared cache is
   * not connected (answered at once, without trying), or a recharge under
   * way did not finish in time.
   */
  public async takeLock(projectId: ObjectID): Promise<SemaphoreMutex | null> {
    if (!Redis.isConnected()) {
      logger.error(
        `${this.options.balanceName}: could not take the recharge lock of project ${projectId.toString()}: the shared cache is not connected.`,
      );
      return null;
    }

    try {
      return await Semaphore.lock({
        key: projectId.toString(),
        namespace: this.options.lockNamespace,
        lockTimeout: RECHARGE_LOCK_TIMEOUT_IN_MS,
        acquireTimeout: RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS,
        onLockLost: (err: Error): void => {
          logger.error(
            `${this.options.balanceName}: the recharge lock of project ${projectId.toString()} was lost while it was held: ${err}`,
          );
        },
      });
    } catch (err) {
      logger.error(
        `${this.options.balanceName}: could not take the recharge lock of project ${projectId.toString()}: ${err}`,
      );
      return null;
    }
  }

  public async releaseLock(
    lock: SemaphoreMutex | null,
    projectId: ObjectID,
  ): Promise<void> {
    if (!lock) {
      return;
    }

    try {
      await Semaphore.release(lock);
    } catch (err) {
      logger.error(
        `${this.options.balanceName}: could not release the recharge lock of project ${projectId.toString()}: ${err}`,
      );
    }
  }

  /*
   * Whether an automatic charge failed within the last
   * AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS. A failure that cannot be read
   * (the shared cache is down) reads as none: without the cache there is no
   * lock either, so nothing is charged anyway.
   */
  public async hasRecentFailure(projectId: ObjectID): Promise<boolean> {
    try {
      return Boolean(
        await GlobalCache.getString(
          this.options.failureNamespace,
          projectId.toString(),
        ),
      );
    } catch (err) {
      logger.error(
        `${this.options.balanceName}: could not read whether Auto Recharge of project ${projectId.toString()} failed recently: ${err}`,
      );
      return false;
    }
  }

  public async rememberFailure(projectId: ObjectID): Promise<void> {
    try {
      await GlobalCache.setString(
        this.options.failureNamespace,
        projectId.toString(),
        new Date().toISOString(),
        { expiresInSeconds: AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS },
      );
    } catch (err) {
      logger.error(
        `${this.options.balanceName}: could not record that Auto Recharge of project ${projectId.toString()} failed: ${err}`,
      );
    }
  }

  public async forgetFailure(projectId: ObjectID): Promise<void> {
    try {
      await GlobalCache.deleteKey(
        this.options.failureNamespace,
        projectId.toString(),
      );
    } catch (err) {
      logger.error(
        `${this.options.balanceName}: could not clear the Auto Recharge failure of project ${projectId.toString()}: ${err}`,
      );
    }
  }
}
