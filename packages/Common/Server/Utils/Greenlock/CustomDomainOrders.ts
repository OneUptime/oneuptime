import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import GreenlockUtil from "./Greenlock";
import CertificateOrder, {
  CertificateOrderOutcome,
  CustomDomainCertificateState,
  OnDemandOrderClaim,
} from "./CertificateOrder";
import CertificateOrderFailures from "./CertificateOrderFailures";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../Types/Date";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import CustomDomainVerification, {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../../Types/CustomDomain/CustomDomainVerification";
import { CustomDomainCertificate } from "../../../Types/CustomDomain/CustomDomainCertificates";

// What these read of a custom domain's row, a status page's or a dashboard's.
export interface CustomDomainToOrder {
  id?: ObjectID | null | undefined;
  fullDomain?: string | undefined;
  isCustomCertificate?: boolean | undefined;
  isSslOrdered?: boolean | undefined;
}

/*
 * What a custom domain's free certificate goes through, whichever kind of
 * custom domain it is: a status page's (StatusPageDomainService) or a
 * dashboard's (DashboardDomainService). The two used to keep their own copy
 * of each step, and drifted apart - the dashboard one kept an "Order Free
 * SSL" button and a Check now that only checked - so the steps that do not
 * depend on the domain's table are here, once:
 *
 *   - orderOnceCnameIsVerified: Check now, once the record is found;
 *   - orderForVerifiedDomainsWithoutOne: the sweeps' first orders;
 *   - getCertificates: what the Custom Domains page's Status column reads.
 *
 * What does depend on the table - reading a domain, recording it as ordered,
 * the order itself with the name's lock and the caller's share of orders
 * (each service's orderCertIfMissing) - the service hands in.
 */
export default class CustomDomainOrders {
  /*
   * Called by verify-cname once it has found the domain's CNAME record:
   * order the domain's free certificate now rather than at the next run of
   * the order sweep, and say what happens to its certificate next.
   *
   * Issued only for a certificate that is in the certificate table and has
   * not expired. isSslOrdered alone says neither: the certificate can have
   * gone missing since (the CheckOrderStatus sweep re-orders those), or
   * expired while its renewals failed. A missing certificate is ordered
   * now, and so is an expired one - somebody who has just fixed what kept the
   * renewals failing should not wait for the renewal run.
   *
   * Whoever asked has just clicked Check now, so this waits for the order
   * for at most waitInMs - an order usually takes a few seconds - and an
   * order that takes longer carries on after the answer. An order that
   * fails is logged and reported, and the sweeps order the certificate
   * again; the record being found is what Check now asked about. Never
   * rejects.
   */
  @CaptureSpan()
  public static async orderOnceCnameIsVerified(data: {
    domain: CustomDomainToOrder;
    /*
     * Records the domain as ordered: it was verified again after a blip,
     * with its certificate still good.
     */
    recordAsOrdered: () => Promise<void>;
    /*
     * The domain's first-order door - its service's orderCertIfMissing - on
     * demand, for a record found a moment ago, and for an expired
     * certificate too.
     */
    orderIfMissing: () => Promise<CertificateOrderOutcome>;
    waitInMs?: number | undefined;
  }): Promise<CustomDomainVerificationResult> {
    const domain: CustomDomainToOrder = data.domain;

    // Served with the certificate its owner uploaded: nothing to order.
    if (domain.isCustomCertificate) {
      return {
        certificateStatus: CustomDomainCertificateStatus.Uploaded,
      };
    }

    const name: string = CertificateOrder.normalizeDomain(
      domain.fullDomain || "",
    );

    const certificate: AcmeCertificate | undefined = (
      await GreenlockUtil.findCertificatesByDomain([name])
    ).get(name);

    if (
      certificate &&
      OneUptimeDate.isAfter(
        certificate.expiresAt as Date,
        OneUptimeDate.getCurrentDate(),
      )
    ) {
      if (!domain.isSslOrdered && domain.id) {
        // Verified again after a blip, with its certificate still good.
        await data.recordAsOrdered();
      }

      return {
        certificateStatus: CustomDomainCertificateStatus.Issued,
      };
    }

    /*
     * One on-demand order per domain per window
     * (CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES): a click within
     * it reports how the last order went, and the sweeps keep retrying.
     */
    const claim: OnDemandOrderClaim =
      await CertificateOrder.claimOnDemandOrder(name);

    if (!claim.mayOrder) {
      return claim.lastError
        ? {
            certificateStatus: CustomDomainCertificateStatus.Failed,
            certificateError: claim.lastError,
          }
        : {
            certificateStatus: CustomDomainCertificateStatus.Issuing,
          };
    }

    let ordering: Promise<CertificateOrderOutcome>;

    try {
      ordering = data.orderIfMissing();
    } catch (err) {
      // Reported like an order that failed: this never rejects.
      ordering = Promise.reject(err);
    }

    const order: Promise<CustomDomainVerificationResult> = ordering.then(
      (outcome: CertificateOrderOutcome): CustomDomainVerificationResult => {
        /*
         * Nothing was ordered - another order of the name is running, or
         * this window's orders are used up - so the click does not keep
         * the window: the next one may try again. The sweeps order it
         * meanwhile.
         */
        if (
          outcome === CertificateOrderOutcome.NotOrderedNow ||
          outcome === CertificateOrderOutcome.LimitReached
        ) {
          void CertificateOrder.releaseOnDemandOrder(name);
        }

        return {
          certificateStatus:
            outcome === CertificateOrderOutcome.AlreadyIssued
              ? CustomDomainCertificateStatus.Issued
              : CustomDomainCertificateStatus.Issuing,
        };
      },
      (err: unknown): CustomDomainVerificationResult => {
        logger.error("Cannot order cert for domain: " + domain.fullDomain, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);
        logger.error(err, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);

        const certificateError: string =
          err instanceof Exception && err.message
            ? err.message
            : "We could not order an SSL certificate for this domain.";

        // Not awaited by the answer; it never throws.
        void CertificateOrder.recordOnDemandOrderFailure(
          name,
          certificateError,
        );

        return {
          certificateStatus: CustomDomainCertificateStatus.Failed,
          certificateError: certificateError,
        };
      },
    );

    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const stillOrdering: Promise<CustomDomainVerificationResult> =
      new Promise<CustomDomainVerificationResult>(
        (resolve: (result: CustomDomainVerificationResult) => void) => {
          timer = setTimeout(() => {
            resolve({
              certificateStatus: CustomDomainCertificateStatus.Issuing,
            });
          }, data.waitInMs ?? CustomDomainVerification.ORDER_WAIT_IN_MS);
        },
      );

    try {
      return await Promise.race([order, stillOrdering]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /*
   * Order the first certificate of each of these domains, whose CNAME is
   * verified: at most maxPerRun orders, picked afresh every run
   * (GreenlockUtil.pickForThisRun), so a domain whose order keeps failing
   * cannot hold a slot the others are waiting for.
   *
   * A domain that already has a certificate is only recorded as ordered -
   * all of them in one write - and that does not use up an order slot. It
   * is the domain whose CNAME check failed for a moment - which marks it
   * unordered - and then passed again; its certificate is still good.
   * Ordering it again spent an order on a duplicate (Let's Encrypt allows
   * five a week per name). If the certificate is due, the renewal run
   * renews it.
   *
   * A domain whose last orders failed waits longer after each failure in a
   * row (CertificateOrderFailures) instead of being ordered on every run:
   * each failed order counts against the account all the same. One domain
   * whose order fails never stops the rest.
   */
  @CaptureSpan()
  public static async orderForVerifiedDomainsWithoutOne<
    TDomain extends CustomDomainToOrder,
  >(data: {
    domains: Array<TDomain>;
    maxPerRun: number;
    // One write that records all of these as ordered.
    recordAsOrdered: (domainIds: Array<ObjectID>) => Promise<void>;
    // The domain's first-order door: its service's orderCertIfMissing.
    orderIfMissing: (domain: TDomain) => Promise<CertificateOrderOutcome>;
  }): Promise<void> {
    const domainsWithName: Array<TDomain> = data.domains.filter(
      (domain: TDomain) => {
        return (
          Boolean(domain.id) &&
          Boolean(domain.fullDomain) &&
          !domain.isCustomCertificate
        );
      },
    );

    if (domainsWithName.length === 0) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const certificates: Map<string, AcmeCertificate> =
      await GreenlockUtil.findCertificatesByDomain(
        domainsWithName.map((domain: TDomain) => {
          return CertificateOrder.normalizeDomain(domain.fullDomain as string);
        }),
      );

    const hasCertificate: (domain: TDomain) => boolean = (
      domain: TDomain,
    ): boolean => {
      return certificates.has(
        CertificateOrder.normalizeDomain(domain.fullDomain as string),
      );
    };

    const domainsToRecord: Array<TDomain> = domainsWithName.filter(
      (domain: TDomain) => {
        return hasCertificate(domain) && !domain.isSslOrdered;
      },
    );

    try {
      await data.recordAsOrdered(
        domainsToRecord.map((domain: TDomain) => {
          return domain.id!;
        }),
      );
    } catch (err) {
      // The next run records them; the orders below still go ahead.
      logger.error(err);
    }

    const domainsToOrder: Array<TDomain> =
      await CertificateOrderFailures.withoutThoseWaitingToRetry({
        items: domainsWithName.filter((domain: TDomain) => {
          return !hasCertificate(domain);
        }),
        getDomain: (domain: TDomain): string => {
          return domain.fullDomain as string;
        },
        now: now,
      });

    const batch: Array<TDomain> = GreenlockUtil.pickForThisRun({
      items: domainsToOrder,
      max: data.maxPerRun,
      now: now,
      getKey: (domain: TDomain): string => {
        return domain.fullDomain || "";
      },
    });

    for (const domain of batch) {
      try {
        logger.debug("Ordering SSL for domain: " + domain.fullDomain, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);

        await data.orderIfMissing(domain);
      } catch (err) {
        // one domain whose order fails must not stop the rest.
        logger.error("Cannot order cert for domain: " + domain.fullDomain, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);
        logger.error(err, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);
      }
    }
  }

  /*
   * Where the certificates of these domains stand, for the Custom Domains
   * page's Status column (CustomDomainCertificates): each one's expiry, and
   * its last failed order while no order since has succeeded.
   */
  @CaptureSpan()
  public static async getCertificates(
    domains: Array<CustomDomainToOrder>,
  ): Promise<Array<CustomDomainCertificate>> {
    const states: Map<string, CustomDomainCertificateState> =
      await CertificateOrder.getCertificateStates(
        domains.map((domain: CustomDomainToOrder) => {
          return domain.fullDomain || "";
        }),
      );

    return domains
      .filter((domain: CustomDomainToOrder) => {
        return Boolean(domain.id) && Boolean(domain.fullDomain);
      })
      .map((domain: CustomDomainToOrder): CustomDomainCertificate => {
        const state: CustomDomainCertificateState | undefined = states.get(
          CertificateOrder.normalizeDomain(domain.fullDomain as string),
        );

        return {
          domainId: domain.id!.toString(),
          expiresAt: state?.certificateExpiresAt,
          lastOrderError: state?.lastOrderError,
          lastOrderFailedAt: state?.lastOrderFailedAt,
        };
      });
  }
}
