import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../Infrastructure/Semaphore";
import GlobalCache from "../../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import GreenlockUtil from "./Greenlock";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../Types/Date";

/*
 * Whether Check now may place an order for a domain now, and, when it may
 * not, how the last one it placed ended.
 */
export interface OnDemandOrderClaim {
  mayOrder: boolean;
  // Why the order Check now placed in this window failed, if it did.
  lastError?: string | undefined;
}

export enum CertificateOrderOutcome {
  // A certificate was ordered and stored.
  Ordered = "Ordered",
  /*
   * The name already had a certificate. It was recorded as ordered and
   * nothing was ordered.
   */
  AlreadyIssued = "AlreadyIssued",
  /*
   * Nothing was ordered now: another order for the name was running, or the
   * lock that keeps orders apart could not be taken. The sweeps try again.
   */
  NotOrderedNow = "NotOrderedNow",
}

/*
 * The first certificate of a custom domain, ordered once.
 *
 * A status page domain's certificate can be ordered from three places: the
 * domain's own "Check now" (the verify-cname route orders the moment the
 * record is found), the 15-minute sweep that orders for verified domains,
 * and the sweep that re-orders a certificate that has gone missing. They run
 * on different replicas, and the two sweeps start on the same tick. Without
 * this, a domain verified a moment before the sweep starts is ordered twice:
 * two orders against the one Let's Encrypt account the whole installation
 * shares, for a name Let's Encrypt allows five certificates a week, and two
 * http-01 challenges for one name, which clean up each other's challenge
 * rows.
 *
 * So every first order goes through orderIfMissing:
 *   - one order per name at a time, across every replica: a Redis lock on
 *     the name, taken without waiting. A caller that finds it taken orders
 *     nothing - the order already running is the one it would have placed;
 *   - with the lock held, the certificate table is read again. A name that
 *     has a certificate - ordered by whoever held the lock a moment ago, or
 *     a domain that was briefly unverified and is verified again - is only
 *     recorded as ordered. Ordering it again would spend an order on a
 *     duplicate, and a renewal that is due is the renewal run's to order.
 *
 * Renewals and reissues are not first orders and do not come through here.
 */
export default class CertificateOrder {
  public static readonly LOCK_NAMESPACE: string =
    "CustomDomainCertificateOrder";

  /*
   * How long the lock outlives a holder that died without releasing it. A
   * live holder refreshes it (redis-semaphore does, every 80% of this), so
   * an order that takes longer - the CA polls a challenge for a while - keeps
   * it.
   */
  public static readonly LOCK_TIMEOUT_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(2);

  /*
   * How often a person may make Check now place an order for one domain.
   *
   * Check now is open to everyone who can read the domain, and an order
   * that fails leaves the domain unordered, so without this every click
   * after a failure - or a script - would place another order against the
   * one Let's Encrypt account the installation shares: 300 new orders per
   * three hours, and five failed validations per name per hour. Within the
   * window Check now only reports how the last order went; the sweeps keep
   * retrying on their own capped schedule.
   */
  public static readonly ON_DEMAND_ORDER_WINDOW_IN_MINUTES: number = 15;

  public static readonly ON_DEMAND_ORDER_NAMESPACE: string =
    "CustomDomainOnDemandCertificateOrder";

  private static readonly ON_DEMAND_ORDERING: string = "ordering";

  /*
   * Claims this window's on-demand order for the domain. Exactly one caller
   * per window gets mayOrder (Redis SET NX); any other gets the last
   * order's error, if it failed. Without Redis nothing is ordered on
   * demand: the sweeps order the certificate.
   */
  @CaptureSpan()
  public static async claimOnDemandOrder(
    domain: string,
  ): Promise<OnDemandOrderClaim> {
    const key: string = CertificateOrder.normalizeDomain(domain);

    try {
      const claimed: boolean = await GlobalCache.setStringIfNotExists(
        CertificateOrder.ON_DEMAND_ORDER_NAMESPACE,
        key,
        CertificateOrder.ON_DEMAND_ORDERING,
        {
          expiresInSeconds:
            CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES * 60,
        },
      );

      if (claimed) {
        return { mayOrder: true };
      }

      const last: string | null = await GlobalCache.getString(
        CertificateOrder.ON_DEMAND_ORDER_NAMESPACE,
        key,
      );

      if (last && last !== CertificateOrder.ON_DEMAND_ORDERING) {
        return { mayOrder: false, lastError: last };
      }

      return { mayOrder: false };
    } catch (err) {
      logger.error(
        `Could not check the on-demand certificate order window of ${key}: not ordering now`,
        { fullDomain: key } as LogAttributes,
      );
      logger.error(err, { fullDomain: key } as LogAttributes);

      return { mayOrder: false };
    }
  }

  /*
   * Remembers why the on-demand order of this window failed, so a click
   * within the window shows it instead of a bare "issuing". The key is
   * written with a whole window again, so the next on-demand order waits a
   * window from the failure rather than from the click.
   */
  @CaptureSpan()
  public static async recordOnDemandOrderFailure(
    domain: string,
    error: string,
  ): Promise<void> {
    try {
      await GlobalCache.setString(
        CertificateOrder.ON_DEMAND_ORDER_NAMESPACE,
        CertificateOrder.normalizeDomain(domain),
        error || "We could not order an SSL certificate for this domain.",
        {
          expiresInSeconds:
            CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES * 60,
        },
      );
    } catch (err) {
      logger.error(err, { fullDomain: domain } as LogAttributes);
    }
  }

  /*
   * A budget of orders that several sweeps share, per 15-minute window - the
   * window the sweeps run on and GreenlockUtil.pickForThisRun picks in.
   *
   * Each sweep caps its own batch, but several sweeps run on every tick,
   * and every order spends from the one Let's Encrypt account the whole
   * installation shares (300 new orders per three hours, renewals
   * included). A budget they draw from together bounds what they order in
   * a window between them, however many of them have a backlog.
   */
  public static readonly ORDER_BUDGET_NAMESPACE: string =
    "CustomDomainCertificateOrderBudget";

  public static readonly ORDER_BUDGET_WINDOW_IN_MINUTES: number = 15;

  /*
   * Takes one order from this window's budget: true while fewer than
   * maxPerWindow were taken in it. A taken order is not given back - an
   * order that fails still cost the account a validation. Without Redis
   * nothing is taken, and nothing is ordered.
   */
  @CaptureSpan()
  public static async takeOrderSlot(data: {
    budget: string;
    maxPerWindow: number;
    now: Date;
  }): Promise<boolean> {
    const windowInMs: number = OneUptimeDate.convertMinutesToMilliseconds(
      CertificateOrder.ORDER_BUDGET_WINDOW_IN_MINUTES,
    );

    const windowIndex: number = Math.floor(data.now.getTime() / windowInMs);

    try {
      const taken: number = await GlobalCache.incrementWithExpiry(
        CertificateOrder.ORDER_BUDGET_NAMESPACE,
        `${data.budget}-${windowIndex}`,
        {
          // Two windows: long enough for every replica's clock.
          expiresInSeconds: CertificateOrder.ORDER_BUDGET_WINDOW_IN_MINUTES * 2 * 60,
        },
      );

      return taken <= data.maxPerWindow;
    } catch (err) {
      logger.error(
        `Could not read the certificate order budget ${data.budget}: not ordering now`,
      );
      logger.error(err);

      return false;
    }
  }

  public static normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  @CaptureSpan()
  public static async orderIfMissing(data: {
    domain: string;
    // Called when the name has a certificate already, instead of ordering.
    recordAsOrdered: () => Promise<void>;
    // Orders and stores the certificate.
    order: () => Promise<void>;
    /*
     * Asked only when an order is about to be placed - a budget such as
     * takeOrderSlot. False orders nothing (NotOrderedNow).
     */
    mayOrder?: (() => Promise<boolean>) | undefined;
  }): Promise<CertificateOrderOutcome> {
    const domain: string = CertificateOrder.normalizeDomain(data.domain);

    const logAttributes: LogAttributes = {
      fullDomain: domain,
    } as LogAttributes;

    const mutex: SemaphoreMutex | null = await CertificateOrder.tryLock(domain);

    if (!mutex) {
      return CertificateOrderOutcome.NotOrderedNow;
    }

    try {
      const certificates: Map<string, AcmeCertificate> =
        await GreenlockUtil.findCertificatesByDomain([domain]);

      if (certificates.has(domain)) {
        logger.debug(
          `${domain} already has a certificate: recording it as ordered instead of ordering another`,
          logAttributes,
        );

        await data.recordAsOrdered();

        return CertificateOrderOutcome.AlreadyIssued;
      }

      if (data.mayOrder && !(await data.mayOrder())) {
        logger.debug(
          `Not ordering a certificate for ${domain} now: this run's orders are used up`,
          logAttributes,
        );

        return CertificateOrderOutcome.NotOrderedNow;
      }

      await data.order();

      return CertificateOrderOutcome.Ordered;
    } finally {
      await CertificateOrder.release(mutex, domain);
    }
  }

  /*
   * The lock on the name, or null when it is taken - or cannot be taken at
   * all. Without Redis the order is left to the sweeps, which run from
   * Redis' own job queue: ordering without the lock is what this is here to
   * stop.
   */
  private static async tryLock(domain: string): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: domain,
        namespace: CertificateOrder.LOCK_NAMESPACE,
        lockTimeout: CertificateOrder.LOCK_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        onLockLost: (err: Error) => {
          logger.error(
            `Lost the certificate order lock of ${domain} while ordering`,
            { fullDomain: domain } as LogAttributes,
          );
          logger.error(err, { fullDomain: domain } as LogAttributes);
        },
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `A certificate for ${domain} is being ordered already: not ordering another`,
          { fullDomain: domain } as LogAttributes,
        );
      } else {
        logger.error(
          `Could not take the certificate order lock of ${domain}: not ordering now`,
          { fullDomain: domain } as LogAttributes,
        );
        logger.error(err, { fullDomain: domain } as LogAttributes);
      }

      return null;
    }
  }

  private static async release(
    mutex: SemaphoreMutex,
    domain: string,
  ): Promise<void> {
    try {
      await Semaphore.release(mutex);
    } catch (err) {
      // It expires on its own; a failed release must not fail the order.
      logger.error(err, { fullDomain: domain } as LogAttributes);
    }
  }
}
