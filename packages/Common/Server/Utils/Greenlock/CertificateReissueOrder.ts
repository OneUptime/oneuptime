import CertificateOrderLock, {
  CertificateOrderLockHandle,
} from "./CertificateOrderLock";
import { CertificateOrderOutcome } from "./CertificateOrderOutcome";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CertificateReissueUtil from "../../../Utils/CertificateReissue";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";

/*
 * Reissue SSL - a brand new certificate a customer asked for - for status
 * page and dashboard domains alike, once the domain's own service has found
 * it eligible.
 *
 * In this order:
 *   1. The name's order lock (CertificateOrderLock). A reissue used to order
 *      without it, so it could run beside Check now, a sweep or a renewal
 *      ordering the same name: two orders, and two http-01 challenges whose
 *      clean-up removes each other's challenge rows. A reissue that finds
 *      the lock taken is refused, and its cooldown is not touched.
 *   2. The cooldown, claimed by a conditional write. It is never given back
 *      when the order fails: a rejected order still costs a validation
 *      against the shared account, and a domain whose order fails is exactly
 *      the one somebody presses again.
 *   3. The order, under the lock. When the installation's Let's Encrypt
 *      allowance for the window is used up (CertificateOrderBudget), nothing
 *      is ordered, so the cooldown is given back and the customer is told to
 *      try again shortly.
 */
export default class CertificateReissueOrder {
  @CaptureSpan()
  public static async reissue(data: {
    domain: string;
    now: Date;
    // When the domain was last reissued, for the cooldown message.
    lastReissueRequestedAt?: Date | undefined;
    // The conditional write that claims the cooldown: rows written.
    claimCooldown: () => Promise<number>;
    // Undoes that write: nothing was ordered.
    giveCooldownBack: () => Promise<void>;
    // Orders the certificate with the lock held.
    order: (lock: CertificateOrderLockHandle) => Promise<CertificateOrderOutcome>;
  }): Promise<void> {
    const lock: CertificateOrderLockHandle | null =
      await CertificateOrderLock.tryLock(data.domain);

    if (!lock) {
      throw new TooManyRequestsException(
        "A certificate for this domain is being ordered right now. Please try again in a few minutes.",
      );
    }

    try {
      const claimedRowCount: number = await data.claimCooldown();

      if (claimedRowCount === 0) {
        if (data.lastReissueRequestedAt) {
          throw new TooManyRequestsException(
            CertificateReissueUtil.getCooldownMessage(
              data.lastReissueRequestedAt,
              data.now,
            ),
          );
        }

        /*
         * The row matched the cooldown a moment ago and does not now:
         * another request claimed it in between, or the domain was deleted.
         * Either way the caller must not order.
         */
        throw new BadDataException(
          "Could not start a certificate reissue for this domain. Please refresh the page and try again.",
        );
      }

      const outcome: CertificateOrderOutcome = await data.order(lock);

      if (outcome === CertificateOrderOutcome.Ordered) {
        return;
      }

      // Nothing was ordered, so the customer's reissue was not spent.
      try {
        await data.giveCooldownBack();
      } catch (err) {
        logger.error(err, { fullDomain: data.domain } as LogAttributes);
      }

      throw new TooManyRequestsException(
        "This installation has used up its new certificates from Let's Encrypt for the moment. Nothing was ordered, and this does not count as your reissue. Please try again in 15 minutes.",
      );
    } finally {
      await CertificateOrderLock.release(lock);
    }
  }
}
