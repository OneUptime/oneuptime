import GlobalCache from "../../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";

// Why a certificate is ordered, which decides what the order may spend.
export enum CertificateOrderReason {
  // A certificate that is serving comes due for renewal, or has expired.
  Renewal = "Renewal",
  // The installation's own host, ordered and renewed by CoreSSL.
  PrimaryHost = "PrimaryHost",
  // A custom domain's first certificate, or one that has gone missing.
  FirstCertificate = "FirstCertificate",
  // A brand new certificate somebody asked for (Reissue SSL).
  Reissue = "Reissue",
}

/*
 * The Let's Encrypt allowance of the whole installation, shared by every
 * order: status page and dashboard domains, first orders, re-orders,
 * reissues, Check now, the order APIs, the renewal runs and the primary host.
 *
 * Every certificate this installation orders comes from one Let's Encrypt
 * account (LETSENCRYPT_ACCOUNT_KEY), and Let's Encrypt allows an account
 * 300 new orders per three hours, renewals included. Each sweep and run has
 * a cap of its own, but those caps add up: with backlogs, the status page
 * and dashboard sweeps and renewals could ask for more than 400 orders in
 * three hours, and once the account is refused, everybody's renewals are
 * refused with it. So GreenlockUtil.orderCert takes one unit from this
 * budget for every order it places, whoever asked, and orders nothing when
 * there is none left. A window is 15 minutes, the schedule the sweeps run
 * on; the next window has a new budget.
 *
 * Renewals come first. They keep a domain that is served today served
 * tomorrow, so they may use the whole window, while new certificates - first
 * orders, re-orders of a missing one, reissues - may only use part of it: a
 * flood of new domains, or someone clicking Check now on many of them, can
 * never leave the renewals without orders. The primary host counts as a
 * renewal: it is the installation itself.
 *
 * One counter holds both limits (GlobalCache.incrementIfBelow), and a
 * refused request adds nothing to it, so new certificates refused at their
 * limit do not use up what renewals still may take.
 */
export default class CertificateOrderBudget {
  public static readonly NAMESPACE: string = "LetsEncryptAccountOrderBudget";

  public static readonly WINDOW_IN_MINUTES: number = 15;

  // Let's Encrypt's limit for one account, renewals included.
  public static readonly LETS_ENCRYPT_ORDERS_PER_THREE_HOURS: number = 300;

  /*
   * Orders of any kind in one window. Any three hours overlap at most 13
   * windows, so at most 260 orders: under Let's Encrypt's 300, with room for
   * the orders a clock that is a little off puts in a neighbouring window.
   */
  public static readonly ORDERS_PER_WINDOW: number = 20;

  /*
   * Of those, how many may be new certificates. Whatever they take, 8 orders
   * per window stay for renewals and the primary host - more than 750 a day.
   */
  public static readonly NEW_CERTIFICATE_ORDERS_PER_WINDOW: number = 12;

  public static getLimit(reason: CertificateOrderReason): number {
    switch (reason) {
      case CertificateOrderReason.Renewal:
      case CertificateOrderReason.PrimaryHost:
        return CertificateOrderBudget.ORDERS_PER_WINDOW;
      case CertificateOrderReason.FirstCertificate:
      case CertificateOrderReason.Reissue:
      default:
        return CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW;
    }
  }

  // The 15-minute window a moment falls in; the same on every replica.
  public static getWindowIndex(now: Date): number {
    return Math.floor(
      now.getTime() /
        OneUptimeDate.convertMinutesToMilliseconds(
          CertificateOrderBudget.WINDOW_IN_MINUTES,
        ),
    );
  }

  /*
   * Takes one order from this window's budget: true when the order may be
   * placed. A taken order is not given back, even if the order fails - a
   * failed order still counted against the account. Without Redis nothing
   * is taken, and nothing is ordered.
   */
  @CaptureSpan()
  public static async takeSlot(data: {
    reason: CertificateOrderReason;
    now: Date;
    // For the log line.
    domain?: string | undefined;
  }): Promise<boolean> {
    const limit: number = CertificateOrderBudget.getLimit(data.reason);

    try {
      const taken: number | null = await GlobalCache.incrementIfBelow(
        CertificateOrderBudget.NAMESPACE,
        `window-${CertificateOrderBudget.getWindowIndex(data.now)}`,
        {
          limit: limit,
          // Two windows: long enough for every replica's clock.
          expiresInSeconds: CertificateOrderBudget.WINDOW_IN_MINUTES * 2 * 60,
        },
      );

      if (taken === null) {
        logger.warn(
          `Not ordering a certificate${data.domain ? ` for ${data.domain}` : ""} now: this installation's Let's Encrypt orders for this 15-minute window are used up (${limit} for a ${data.reason} order). It is tried again in a later window.`,
          { fullDomain: data.domain } as LogAttributes,
        );

        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        "Could not read this installation's Let's Encrypt order budget: not ordering now",
        { fullDomain: data.domain } as LogAttributes,
      );
      logger.error(err, { fullDomain: data.domain } as LogAttributes);

      return false;
    }
  }
}
