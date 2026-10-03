import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../Infrastructure/Semaphore";
import logger, { LogAttributes } from "../Logger";
import OneUptimeDate from "../../../Types/Date";

/*
 * Proof that its holder holds the order lock of one name. Only tryLock makes
 * one, and it stops counting once released.
 */
export interface CertificateOrderLockHandle {
  // The name it locks, normalized.
  readonly domain: string;
}

/*
 * One certificate order per name at a time, across every replica.
 *
 * A name's certificate can be ordered from many places: Check now, the
 * sweeps that order first certificates and re-order missing ones, the order
 * and reissue APIs, the renewal runs and, for the installation's own host,
 * CoreSSL. Two orders for one name at once are two orders against the one
 * Let's Encrypt account the whole installation shares, and two http-01
 * challenges for one name, whose clean-up deletes the challenge rows by
 * name - each order can remove the other's challenge while Let's Encrypt is
 * still checking it.
 *
 * GreenlockUtil.orderCert takes this lock for every order, or checks that its
 * caller holds it (CertificateOrder.orderIfMissing takes it first, to look
 * the name up again before deciding to order). The lock is taken without
 * waiting: a caller that finds it taken orders nothing, because the order
 * already running is the one it would have placed.
 */
export default class CertificateOrderLock {
  public static readonly NAMESPACE: string = "CustomDomainCertificateOrder";

  /*
   * How long the lock outlives a holder that died without releasing it. A
   * live holder refreshes it (redis-semaphore does, every 80% of this), so
   * an order that takes longer - the CA polls a challenge for a while - keeps
   * it.
   */
  public static readonly TIMEOUT_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(2);

  // The handles tryLock gave out and that are not released yet.
  private static readonly held: WeakMap<
    CertificateOrderLockHandle,
    SemaphoreMutex
  > = new WeakMap<CertificateOrderLockHandle, SemaphoreMutex>();

  public static normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  /*
   * The lock on the name, or null when it is taken - or cannot be taken at
   * all. Without Redis nothing is ordered: the sweeps run from Redis' own
   * job queue, and ordering without the lock is what this is here to stop.
   */
  public static async tryLock(
    domain: string,
  ): Promise<CertificateOrderLockHandle | null> {
    const name: string = CertificateOrderLock.normalizeDomain(domain);

    try {
      const mutex: SemaphoreMutex = await Semaphore.lock({
        key: name,
        namespace: CertificateOrderLock.NAMESPACE,
        lockTimeout: CertificateOrderLock.TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        onLockLost: (err: Error) => {
          logger.error(
            `Lost the certificate order lock of ${name} while ordering`,
            { fullDomain: name } as LogAttributes,
          );
          logger.error(err, { fullDomain: name } as LogAttributes);
        },
      });

      const handle: CertificateOrderLockHandle = Object.freeze({
        domain: name,
      });

      CertificateOrderLock.held.set(handle, mutex);

      return handle;
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `A certificate for ${name} is being ordered already: not ordering another`,
          { fullDomain: name } as LogAttributes,
        );
      } else {
        logger.error(
          `Could not take the certificate order lock of ${name}: not ordering now`,
          { fullDomain: name } as LogAttributes,
        );
        logger.error(err, { fullDomain: name } as LogAttributes);
      }

      return null;
    }
  }

  // Whether this handle holds the lock of this name right now.
  public static isHeldFor(
    lock: CertificateOrderLockHandle | undefined,
    domain: string,
  ): boolean {
    return Boolean(
      lock &&
        CertificateOrderLock.held.has(lock) &&
        lock.domain === CertificateOrderLock.normalizeDomain(domain),
    );
  }

  // Never throws: the lock expires on its own, and an order must not fail on it.
  public static async release(lock: CertificateOrderLockHandle): Promise<void> {
    const mutex: SemaphoreMutex | undefined = CertificateOrderLock.held.get(lock);

    if (!mutex) {
      return;
    }

    CertificateOrderLock.held.delete(lock);

    try {
      await Semaphore.release(mutex);
    } catch (err) {
      logger.error(err, { fullDomain: lock.domain } as LogAttributes);
    }
  }
}
