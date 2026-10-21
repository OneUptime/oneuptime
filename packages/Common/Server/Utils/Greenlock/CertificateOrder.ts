import GlobalCache from "../../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import GreenlockUtil from "./Greenlock";
import CertificateOrderLock, {
  CertificateOrderLockHandle,
} from "./CertificateOrderLock";
import CertificateOrderFailures, {
  CertificateOrderFailure,
} from "./CertificateOrderFailures";
import { CertificateOrderOutcome } from "./CertificateOrderOutcome";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../Types/Date";
import Exception from "../../../Types/Exception/Exception";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";

export { CertificateOrderOutcome } from "./CertificateOrderOutcome";

/*
 * Whether Check now may place an order for a domain now, and, when it may
 * not, how the last one it placed ended.
 */
export interface OnDemandOrderClaim {
  mayOrder: boolean;
  // Why the order Check now placed in this window failed, if it did.
  lastError?: string | undefined;
}

// Where a custom domain's certificate stands, for its Status column.
export interface CustomDomainCertificateState {
  // When its certificate expires; undefined when it has none.
  certificateExpiresAt?: Date | undefined;
  // The last order for it that failed, while no order since has succeeded.
  lastOrderError?: string | undefined;
  lastOrderFailedAt?: Date | undefined;
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
 *   - one order per name at a time, across every replica: the name's order
 *     lock (CertificateOrderLock), taken without waiting. A caller that finds
 *     it taken orders nothing - the order already running is the one it
 *     would have placed;
 *   - with the lock held, the certificate table is read again. A name that
 *     has a certificate - ordered by whoever held the lock a moment ago, or
 *     a domain that was briefly unverified and is verified again - is only
 *     recorded as ordered. Ordering it again would spend an order on a
 *     duplicate, and a renewal that is due is the renewal run's to order.
 *
 * Renewals and reissues are not first orders and do not come through here,
 * but they take the same lock: GreenlockUtil.orderCert places every order
 * under it.
 */
export default class CertificateOrder {
  public static readonly LOCK_NAMESPACE: string =
    CertificateOrderLock.NAMESPACE;

  public static readonly LOCK_TIMEOUT_IN_MS: number =
    CertificateOrderLock.TIMEOUT_IN_MS;

  /*
   * How often a person may make Check now - or the order API - place an
   * order for one domain.
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
   * How many orders one project may place on demand - Check now and the
   * order API, across all of its domains - in one 15-minute window. Each
   * domain has its own window above; this bounds a project's sum, so
   * somebody clicking through many domains whose orders fail cannot use up
   * the new certificates of the whole installation (CertificateOrderBudget)
   * and hold up everybody else's. Per project, so one project using its
   * share up leaves every other project its own.
   */
  public static readonly ON_DEMAND_ORDER_BUDGET: string =
    "CustomDomainOnDemandOrders";

  public static readonly ON_DEMAND_ORDERS_PER_PROJECT_PER_WINDOW: number = 5;

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
   * Gives the window's claim back: the claim was taken, but nothing was
   * ordered - another order of the name was running, or the budget was used
   * up - so the next click may try again rather than wait out a window for
   * an order that never happened. Only a claim still marked as ordering is
   * removed, never a recorded failure. Never throws.
   */
  @CaptureSpan()
  public static async releaseOnDemandOrder(domain: string): Promise<void> {
    try {
      await GlobalCache.deleteKeyIfValue(
        CertificateOrder.ON_DEMAND_ORDER_NAMESPACE,
        CertificateOrder.normalizeDomain(domain),
        CertificateOrder.ON_DEMAND_ORDERING,
      );
    } catch (err) {
      logger.error(err, { fullDomain: domain } as LogAttributes);
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
   * A budget of orders that several callers share, per 15-minute window -
   * the window the sweeps run on and GreenlockUtil.pickForThisRun picks in.
   *
   * Each sweep caps its own batch, but several sweeps run on every tick. A
   * budget they draw from together bounds what they order in a window
   * between them, however many of them have a backlog: the status page
   * sweeps share one, the dashboard sweeps another, the on-demand orders a
   * third. All of them, and the renewals, draw from the installation's
   * Let's Encrypt allowance as well (CertificateOrderBudget), which
   * GreenlockUtil.orderCert takes for every order.
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
          expiresInSeconds:
            CertificateOrder.ORDER_BUDGET_WINDOW_IN_MINUTES * 2 * 60,
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

  // One order from a project's on-demand budget of this window.
  @CaptureSpan()
  public static async takeOnDemandOrderSlot(data: {
    now: Date;
    projectId?: string | undefined;
  }): Promise<boolean> {
    return await CertificateOrder.takeOrderSlot({
      budget: `${CertificateOrder.ON_DEMAND_ORDER_BUDGET}-${data.projectId || "unknown-project"}`,
      maxPerWindow: CertificateOrder.ON_DEMAND_ORDERS_PER_PROJECT_PER_WINDOW,
      now: data.now,
    });
  }

  /*
   * The share of orders an order draws from besides the installation's
   * budget: a sweep's shared budget, a project's on-demand one, or none (a
   * reissue has a cooldown of its own). Asked by GreenlockUtil.orderCert
   * once the CNAME check has passed.
   */
  public static getOrderShare(data: {
    sweep?: { budget: string; maxPerWindow: number } | undefined;
    onDemand?: { projectId?: string | undefined } | undefined;
  }): (() => Promise<boolean>) | undefined {
    if (data.sweep) {
      const sweep: { budget: string; maxPerWindow: number } = data.sweep;

      return async (): Promise<boolean> => {
        return await CertificateOrder.takeOrderSlot({
          budget: sweep.budget,
          maxPerWindow: sweep.maxPerWindow,
          now: OneUptimeDate.getCurrentDate(),
        });
      };
    }

    if (data.onDemand) {
      const projectId: string | undefined = data.onDemand.projectId;

      return async (): Promise<boolean> => {
        return await CertificateOrder.takeOnDemandOrderSlot({
          now: OneUptimeDate.getCurrentDate(),
          projectId: projectId,
        });
      };
    }

    return undefined;
  }

  /*
   * An order somebody asked for through an API (order-ssl), for status page
   * and dashboard domains alike: at most one per domain per window, shared
   * with Check now. Answers with what the order did. Throws a 429 for a
   * click inside the window (with the last order's error, if it failed), for
   * an order of the name already running and for a used-up budget - after
   * giving the window back, as nothing was ordered - and rethrows a failed
   * order once it is remembered for the window.
   */
  @CaptureSpan()
  public static async orderOnDemand(data: {
    domain: string;
    order: () => Promise<CertificateOrderOutcome>;
  }): Promise<CertificateOrderOutcome> {
    const claim: OnDemandOrderClaim = await CertificateOrder.claimOnDemandOrder(
      data.domain,
    );

    if (!claim.mayOrder) {
      throw new TooManyRequestsException(
        claim.lastError
          ? `A certificate was ordered for this domain less than ${CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES} minutes ago, and the order failed: ${claim.lastError} Please try again later.`
          : `A certificate was ordered for this domain less than ${CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES} minutes ago. Please try again later.`,
      );
    }

    let outcome: CertificateOrderOutcome;

    try {
      outcome = await data.order();
    } catch (err) {
      await CertificateOrder.recordOnDemandOrderFailure(
        data.domain,
        err instanceof Exception && err.message
          ? err.message
          : "We could not order an SSL certificate for this domain.",
      );

      throw err;
    }

    if (
      outcome === CertificateOrderOutcome.NotOrderedNow ||
      outcome === CertificateOrderOutcome.LimitReached
    ) {
      await CertificateOrder.releaseOnDemandOrder(data.domain);

      throw new TooManyRequestsException(
        outcome === CertificateOrderOutcome.NotOrderedNow
          ? "A certificate for this domain is being ordered right now. Please try again in a few minutes."
          : "This installation has used up its new certificates from Let's Encrypt for the moment. Nothing was ordered: the certificate is ordered automatically shortly, or you can try again in 15 minutes.",
      );
    }

    return outcome;
  }

  public static normalizeDomain(domain: string): string {
    return CertificateOrderLock.normalizeDomain(domain);
  }

  @CaptureSpan()
  public static async orderIfMissing(data: {
    domain: string;
    // Called when the name has a certificate already, instead of ordering.
    recordAsOrdered: () => Promise<void>;
    /*
     * Orders and stores the certificate, with the name's lock held - pass
     * the lock on to GreenlockUtil.orderCert. What it returns is the
     * outcome; nothing means it ordered.
     */
    order: (
      lock: CertificateOrderLockHandle,
    ) => Promise<CertificateOrderOutcome | void>;
    /*
     * Order for a name whose certificate has expired too, rather than
     * leave it to the renewal run - for somebody who clicked Check now on
     * it.
     */
    renewIfExpired?: boolean | undefined;
  }): Promise<CertificateOrderOutcome> {
    const domain: string = CertificateOrder.normalizeDomain(data.domain);

    const logAttributes: LogAttributes = {
      fullDomain: domain,
    } as LogAttributes;

    const lock: CertificateOrderLockHandle | null =
      await CertificateOrderLock.tryLock(domain);

    if (!lock) {
      return CertificateOrderOutcome.NotOrderedNow;
    }

    try {
      const certificate: AcmeCertificate | undefined = (
        await GreenlockUtil.findCertificatesByDomain([domain])
      ).get(domain);

      const isUsable: boolean = Boolean(
        certificate &&
          (!data.renewIfExpired ||
            OneUptimeDate.isAfter(
              certificate.expiresAt as Date,
              OneUptimeDate.getCurrentDate(),
            )),
      );

      if (isUsable) {
        logger.debug(
          `${domain} already has a certificate: recording it as ordered instead of ordering another`,
          logAttributes,
        );

        await data.recordAsOrdered();

        return CertificateOrderOutcome.AlreadyIssued;
      }

      return (await data.order(lock)) || CertificateOrderOutcome.Ordered;
    } finally {
      await CertificateOrderLock.release(lock);
    }
  }

  /*
   * Where the certificates of these custom domains stand, by normalized
   * name: when each one's certificate expires, and why its last order
   * failed if no order since has succeeded. Two lookups for all of them -
   * the certificate table and Redis - for a domain list's Status column.
   */
  @CaptureSpan()
  public static async getCertificateStates(
    domains: Array<string>,
  ): Promise<Map<string, CustomDomainCertificateState>> {
    const names: Array<string> = Array.from(
      new Set<string>(
        domains
          .map((domain: string) => {
            return CertificateOrder.normalizeDomain(domain || "");
          })
          .filter((name: string) => {
            return name.length > 0;
          }),
      ),
    );

    const states: Map<string, CustomDomainCertificateState> = new Map<
      string,
      CustomDomainCertificateState
    >();

    if (names.length === 0) {
      return states;
    }

    const certificates: Map<string, AcmeCertificate> =
      await GreenlockUtil.findCertificatesByDomain(names);

    const failures: Map<string, CertificateOrderFailure> =
      await CertificateOrderFailures.get(names);

    for (const name of names) {
      const certificate: AcmeCertificate | undefined = certificates.get(name);
      const failure: CertificateOrderFailure | undefined = failures.get(name);

      states.set(name, {
        certificateExpiresAt: certificate?.expiresAt,
        lastOrderError: failure?.error,
        lastOrderFailedAt: failure?.failedAt,
      });
    }

    return states;
  }
}
