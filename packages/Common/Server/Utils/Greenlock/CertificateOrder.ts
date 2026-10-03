import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../Infrastructure/Semaphore";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import GreenlockUtil from "./Greenlock";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../Types/Date";

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
