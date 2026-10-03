import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import GreenlockUtil from "../Utils/Greenlock/Greenlock";
import CertificateOrder, {
  CertificateOrderOutcome,
  CustomDomainCertificateState,
  OnDemandOrderClaim,
} from "../Utils/Greenlock/CertificateOrder";
import { CertificateOrderLockHandle } from "../Utils/Greenlock/CertificateOrderLock";
import { CertificateOrderReason } from "../Utils/Greenlock/CertificateOrderBudget";
import CertificateOrderFailures from "../Utils/Greenlock/CertificateOrderFailures";
import CertificateReissueOrder from "../Utils/Greenlock/CertificateReissueOrder";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import DomainService from "./DomainService";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import AcmeCertificate from "../../Models/DatabaseModels/AcmeCertificate";
import DomainModel from "../../Models/DatabaseModels/Domain";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import Telemetry, { Span } from "../Utils/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { StatusPageCNameRecord } from "../EnvironmentConfig";
import Domain from "../Types/Domain";
import ArrayUtil from "../../Utils/Array";
import OneUptimeDate from "../../Types/Date";
import CertificateReissueUtil from "../../Utils/CertificateReissue";
import QueryHelper from "../Types/Database/QueryHelper";
import Exception from "../../Types/Exception/Exception";
import CustomDomainVerification, {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../Types/StatusPage/CustomDomainVerification";
import { CustomDomainCertificate } from "../../Types/StatusPage/CustomDomainCertificates";

const STATUS_PAGE_DOMAIN_EGRESS_LABEL: string = "Status page domain";

export class Service extends DatabaseService<StatusPageDomain> {
  /*
   * How many status pages the provisioning sweep checks at once. Each check is
   * one bounded request out to a customer domain, so this is about not letting
   * the sweep's length grow with the size of the fleet, rather than about local
   * work. Kept modest so a sweep cannot look like a burst of traffic to any
   * shared infrastructure sitting in front of those domains.
   */
  public static readonly SSL_PROVISIONING_CHECK_CONCURRENCY: number = 10;

  /*
   * How many certificates the sweeps that order them may order in one
   * 15-minute window, between them: the order for the domains the CNAME
   * sweep has just verified, the order sweep for every verified domain still
   * without a certificate, and the re-order of a certificate that has gone
   * missing. They draw from one budget (CertificateOrder.takeOrderSlot,
   * SWEEP_ORDER_BUDGET), and each picks its batch afresh every run
   * (GreenlockUtil.pickForThisRun), so a domain whose order keeps failing -
   * a CAA record that leaves Let's Encrypt out, a name it has paused -
   * cannot hold a slot the others are waiting for, and waits longer after
   * each failed order (CertificateOrderFailures). Check now is not counted
   * here: it has a window of its own per domain
   * (CertificateOrder.claimOnDemandOrder) and the on-demand budget.
   *
   * Every order spends from the one Let's Encrypt account the whole
   * installation shares, 300 new orders per three hours, renewals included.
   * Whatever these caps allow, no order is placed beyond the installation's
   * own budget for that account (CertificateOrderBudget), which every order
   * of every kind draws from. In a steady state these sweeps order a few
   * certificates a day: a domain whose owner clicks Check now is ordered by
   * that request. The cap is for a backlog, such as the domains the order
   * sweep used to retry every 15 minutes without any limit, which is now
   * worked off a few domains a run the way the dashboard sweeps
   * (DashboardDomainService.ORDER_MAX_PER_RUN) and renewals
   * (GreenlockUtil.RENEW_MAX_PER_RUN) are.
   */
  public static readonly ORDER_MAX_PER_RUN: number = 5;

  // The budget the ordering sweeps share (CertificateOrder.takeOrderSlot).
  public static readonly SWEEP_ORDER_BUDGET: string = "StatusPageDomainSweeps";

  public constructor() {
    super(StatusPageDomain);
  }

  /*
   * Normalize a submitted subdomain and reject anything that is not a plain
   * DNS label chain.
   *
   * fullDomain is built as `${subdomain}.${baseDomain}` and then interpolated
   * into "https://" + fullDomain + "/status-page-api/..." — and URL parsing
   * treats everything before the first "/" as the host. Without this check a
   * subdomain of "169.254.169.254/latest/meta-data/#" hands an attacker the
   * host, the port and the path of a request the certificate cron then makes
   * unattended, every 15 minutes, from inside the cluster.
   */
  private static normalizeAndValidateSubdomain(
    subdomain: string | undefined,
  ): string {
    const normalized: string = subdomain?.trim().toLowerCase() || "";

    // "@" is the documented way to ask for the root domain.
    if (normalized === "" || normalized === "@") {
      return "";
    }

    if (!Domain.isValidSubdomain(normalized)) {
      throw new BadDataException(
        `Subdomain ${normalized} is not valid. Use a plain subdomain such as "status" — schemes, ports, paths and "/" are not allowed.`,
      );
    }

    return normalized;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<StatusPageDomain>,
  ): Promise<OnUpdate<StatusPageDomain>> {
    /*
     * Create-time validation alone leaves the value editable afterwards —
     * subdomain is ProjectMember-updatable.
     */
    if (updateBy.data.subdomain !== undefined) {
      updateBy.data.subdomain = Service.normalizeAndValidateSubdomain(
        updateBy.data.subdomain as string,
      );
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<StatusPageDomain>,
  ): Promise<OnCreate<StatusPageDomain>> {
    const domain: DomainModel | null = await DomainService.findOneBy({
      query: {
        _id:
          createBy.data.domainId?.toString() || createBy.data.domain?._id || "",
      },
      select: { domain: true, isVerified: true },
      props: {
        isRoot: true,
      },
    });

    if (!domain?.isVerified) {
      throw new BadDataException(
        "This domain is not verified. Please verify it by going to Settings > Domains",
      );
    }

    createBy.data.subdomain = Service.normalizeAndValidateSubdomain(
      createBy.data.subdomain,
    );

    const normalizedSubdomain: string = createBy.data.subdomain;

    if (domain) {
      const baseDomain: string =
        domain.domain?.toString().toLowerCase().trim() || "";

      if (!baseDomain) {
        throw new BadDataException("Please select a valid domain.");
      }

      createBy.data.fullDomain = normalizedSubdomain
        ? `${normalizedSubdomain}.${baseDomain}`
        : baseDomain;
    }

    createBy.data.cnameVerificationToken = ObjectID.generate().toString();

    if (createBy.data.isCustomCertificate) {
      if (
        !createBy.data.customCertificate ||
        !createBy.data.customCertificateKey
      ) {
        throw new BadDataException(
          "Custom certificate or private key is missing",
        );
      }
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<StatusPageDomain>,
  ): Promise<OnDelete<StatusPageDomain>> {
    const domains: Array<StatusPageDomain> = await this.findBy({
      query: {
        ...deleteBy.query,
      },
      skip: 0,
      limit: LIMIT_MAX,
      select: { fullDomain: true },
      props: {
        isRoot: true,
      },
    });

    return { deleteBy, carryForward: domains };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<StatusPageDomain>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<StatusPageDomain>> {
    for (const domain of onDelete.carryForward) {
      await this.removeDomainFromGreenlock(domain.fullDomain as string);
    }

    return onDelete;
  }

  @CaptureSpan()
  public async removeDomainFromGreenlock(domain: string): Promise<void> {
    await GreenlockUtil.removeDomain(domain);
  }

  /*
   * The domain with its full name and whether it serves an uploaded
   * certificate, read once when the caller did not have them both.
   */
  private async getDomainToOrder(
    statusPageDomain: StatusPageDomain,
  ): Promise<StatusPageDomain> {
    if (!statusPageDomain.id) {
      throw new BadDataException(
        "Domain ID is required to order a certificate",
      );
    }

    if (
      statusPageDomain.fullDomain &&
      statusPageDomain.isCustomCertificate !== undefined
    ) {
      return statusPageDomain;
    }

    const fetchedStatusPageDomain: StatusPageDomain | null =
      await this.findOneBy({
        query: {
          _id: statusPageDomain.id.toString(),
        },
        select: {
          _id: true,
          fullDomain: true,
          isCustomCertificate: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!fetchedStatusPageDomain) {
      throw new BadDataException("DomainModel not found");
    }

    if (!fetchedStatusPageDomain.fullDomain) {
      throw new BadDataException(
        "Unable to order certificate because domain is null",
      );
    }

    return fetchedStatusPageDomain;
  }

  /*
   * Order this domain's certificate and record it: a first certificate
   * (the default), or a reissue. GreenlockUtil.orderCert places it under the
   * name's order lock - the one handed in, or its own - and within the
   * installation's Let's Encrypt allowance; the outcome says whether it
   * ordered.
   */
  @CaptureSpan()
  public async orderCert(
    statusPageDomain: StatusPageDomain,
    options?: {
      reason?: CertificateOrderReason | undefined;
      // The name's order lock, when the caller holds it.
      lock?: CertificateOrderLockHandle | undefined;
      /*
       * The caller has just found the domain's CNAME record: the order
       * does not check it again (see GreenlockUtil.orderCert).
       */
      cnameVerifiedJustNow?: boolean | undefined;
    },
  ): Promise<CertificateOrderOutcome> {
    return Telemetry.startActiveSpan<Promise<CertificateOrderOutcome>>({
      name: "StatusPageDomainService.orderCert",
      options: {
        attributes: {
          fullDomain: statusPageDomain.fullDomain,
          _id: statusPageDomain.id?.toString(),
        },
      },
      fn: async (span: Span): Promise<CertificateOrderOutcome> => {
        try {
          const domainToOrder: StatusPageDomain =
            await this.getDomainToOrder(statusPageDomain);

          logger.debug(
            "Ordering SSL for domain: " + domainToOrder.fullDomain,
            { fullDomain: domainToOrder.fullDomain } as LogAttributes,
          );

          const outcome: CertificateOrderOutcome =
            await GreenlockUtil.orderCert({
              domain: domainToOrder.fullDomain as string,
              reason:
                options?.reason || CertificateOrderReason.FirstCertificate,
              validateCname: options?.cnameVerifiedJustNow
                ? null
                : async (fullDomain: string) => {
                    return await this.isCnameValid(fullDomain);
                  },
              lock: options?.lock,
            });

          if (outcome === CertificateOrderOutcome.Ordered) {
            logger.debug(
              "SSL ordered for domain: " + domainToOrder.fullDomain,
              { fullDomain: domainToOrder.fullDomain } as LogAttributes,
            );

            /*
             * Verified as well as ordered: Let's Encrypt has just fetched
             * its challenge from this domain, so the domain reaches us. A
             * CNAME sweep that saw a DNS blip while the order ran - and
             * marked the domain unverified and unordered - would otherwise
             * leave it "ordered" but "waiting for DNS", with a certificate
             * the dialog had just called verified.
             */
            await this.updateOneById({
              id: domainToOrder.id!,
              data: {
                isCnameVerified: true,
                isSslOrdered: true,
              },
              props: {
                isRoot: true,
              },
            });
          }

          Telemetry.endSpan(span);

          return outcome;
        } catch (err) {
          Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
            span,
            exception: err,
          });

          throw err;
        }
      },
    });
  }

  /*
   * Records these domains as ordered: they have a certificate, ordered
   * before, so nothing is ordered. One write for all of them, and only on
   * domains that are still verified - a CNAME check that failed meanwhile
   * marked a domain unverified and unordered, and marking it ordered again
   * would leave it ordered but "waiting for DNS". The next CNAME check that
   * passes records it again.
   */
  private async recordCertificatesAsOrdered(
    domainIds: Array<ObjectID>,
  ): Promise<void> {
    if (domainIds.length === 0) {
      return;
    }

    await this.updateBy({
      query: {
        _id: QueryHelper.any(
          domainIds.map((id: ObjectID) => {
            return id.toString();
          }),
        ),
        isCnameVerified: true,
        isSslOrdered: false,
      },
      data: {
        isSslOrdered: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Reissue this domain's Let's Encrypt certificate because a customer asked
   * for it, rather than because it is close to expiring.
   *
   * Every order spends from a Let's Encrypt account that is shared by the
   * whole installation - including by the cron that keeps everybody else's
   * certificates alive - so this is throttled to one request per domain per
   * CertificateReissueUtil.COOLDOWN_IN_HOURS.
   *
   * Throws with a customer-readable reason for every refusal, so the API layer
   * can hand the message straight back without classifying the failure:
   * BadDataException for a domain that is not eligible at all, and
   * TooManyRequestsException (429) for one that is simply too soon.
   */
  @CaptureSpan()
  public async reissueCert(domainId: ObjectID): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const statusPageDomain: StatusPageDomain | null = await this.findOneBy({
      query: {
        _id: domainId.toString(),
      },
      select: {
        _id: true,
        fullDomain: true,
        isCnameVerified: true,
        isSslOrdered: true,
        isCustomCertificate: true,
        certificateReissueRequestedAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPageDomain) {
      throw new BadDataException("Domain not found.");
    }

    if (!statusPageDomain.fullDomain) {
      throw new BadDataException(
        "Unable to reissue certificate because domain is null",
      );
    }

    /*
     * Nothing to reissue: the certificate on a custom-certificate domain is
     * the one the customer uploaded, and we have no way to obtain another.
     */
    if (statusPageDomain.isCustomCertificate) {
      throw new BadDataException(
        "This domain uses a certificate you uploaded yourself, so there is no Let's Encrypt certificate to reissue. Please edit this domain and upload a new certificate instead.",
      );
    }

    if (!statusPageDomain.isCnameVerified) {
      throw new BadDataException(
        "CNAME is not verified. Please verify CNAME first before you reissue the SSL certificate.",
      );
    }

    /*
     * A domain that never ordered a certificate has nothing to reissue. Its
     * first certificate is ordered on its own once the CNAME is verified, and
     * the dashboard shows Reissue SSL only after that.
     */
    if (!statusPageDomain.isSslOrdered) {
      throw new BadDataException(
        "No SSL certificate has been ordered for this domain yet. One is ordered automatically once its CNAME record is verified.",
      );
    }

    await CertificateReissueOrder.reissue({
      domain: statusPageDomain.fullDomain,
      now: now,
      lastReissueRequestedAt: statusPageDomain.certificateReissueRequestedAt,
      claimCooldown: async (): Promise<number> => {
        /*
         * Claim the cooldown before ordering anything, and claim it by
         * putting the cooldown condition in the WHERE clause rather than in
         * an `if` above the write. Two clicks that arrive together both read
         * a row that is not cooling down; only the write can decide which
         * one of them gets to spend the CA's allowance.
         */
        return await this.updateOneBy({
          query: {
            _id: domainId.toString(),
            certificateReissueRequestedAt: QueryHelper.lessThanEqualToOrNull(
              CertificateReissueUtil.getCooldownCutoff(now),
            ),
          },
          data: {
            certificateReissueRequestedAt: now,
          },
          props: {
            isRoot: true,
          },
        });
      },
      giveCooldownBack: async (): Promise<void> => {
        await this.updateOneBy({
          query: {
            _id: domainId.toString(),
            certificateReissueRequestedAt: now,
          },
          data: {
            certificateReissueRequestedAt:
              statusPageDomain.certificateReissueRequestedAt || null,
          } as never,
          props: {
            isRoot: true,
          },
        });
      },
      order: async (
        lock: CertificateOrderLockHandle,
      ): Promise<CertificateOrderOutcome> => {
        logger.debug(
          "Reissuing SSL certificate for domain: " +
            statusPageDomain.fullDomain,
          { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
        );

        return await this.orderCert(statusPageDomain, {
          reason: CertificateOrderReason.Reissue,
          lock: lock,
        });
      },
    });
  }

  /*
   * Order this domain's free certificate unless it has one already, or one
   * is being ordered for it right now (CertificateOrder.orderIfMissing): the
   * one way a first certificate is ordered, whether by Check now, by the
   * order sweeps or by the order-ssl API.
   *
   * Never for a domain that serves a certificate its owner uploaded. Throws
   * what the order throws, so a caller can show why.
   */
  @CaptureSpan()
  public async orderCertIfMissing(
    statusPageDomain: StatusPageDomain,
    options?: {
      // An order of the sweeps: it draws from their shared window budget.
      fromSweep?: boolean | undefined;
      /*
       * An order somebody asked for (Check now, the order API): it draws
       * from the on-demand budget (CertificateOrder.ON_DEMAND_ORDER_BUDGET).
       */
      onDemand?: boolean | undefined;
      // The caller has just found the domain's CNAME record.
      cnameVerifiedJustNow?: boolean | undefined;
      // Order for an expired certificate too (Check now).
      renewIfExpired?: boolean | undefined;
    },
  ): Promise<CertificateOrderOutcome> {
    const domainToOrder: StatusPageDomain =
      await this.getDomainToOrder(statusPageDomain);

    // The sweeps never order for one either: it serves the upload.
    if (domainToOrder.isCustomCertificate) {
      throw new BadDataException(
        "This domain uses a certificate you uploaded, so there is no free SSL certificate to order for it.",
      );
    }

    const domainId: ObjectID = domainToOrder.id!;

    return await CertificateOrder.orderIfMissing({
      domain: domainToOrder.fullDomain as string,
      renewIfExpired: options?.renewIfExpired,
      recordAsOrdered: async (): Promise<void> => {
        await this.recordCertificatesAsOrdered([domainId]);
      },
      order: async (
        lock: CertificateOrderLockHandle,
      ): Promise<CertificateOrderOutcome> => {
        return await this.orderCert(domainToOrder, {
          reason: CertificateOrderReason.FirstCertificate,
          lock: lock,
          cnameVerifiedJustNow: options?.cnameVerifiedJustNow,
        });
      },
      mayOrder: options?.fromSweep
        ? async (): Promise<boolean> => {
            return await CertificateOrder.takeOrderSlot({
              budget: Service.SWEEP_ORDER_BUDGET,
              maxPerWindow: Service.ORDER_MAX_PER_RUN,
              now: OneUptimeDate.getCurrentDate(),
            });
          }
        : options?.onDemand
          ? async (): Promise<boolean> => {
              return await CertificateOrder.takeOnDemandOrderSlot(
                OneUptimeDate.getCurrentDate(),
              );
            }
          : undefined,
    });
  }

  /*
   * Called by verify-cname once it has found the domain's CNAME record:
   * order the domain's free certificate now rather than at the next run of
   * the order sweep, and say what happens to its certificate next.
   *
   * Issued only for a certificate that is in the certificate table and has
   * not expired. isSslOrdered alone says neither: the certificate can have
   * gone missing since (CheckOrderStatus re-orders those), or expired while
   * its renewals failed. A missing certificate is ordered now, and so is an
   * expired one - somebody who has just fixed what kept the renewals failing
   * should not wait for the renewal run.
   *
   * Whoever asked has just clicked Check now, so this waits for the order
   * for at most waitInMs - an order usually takes a few seconds - and an
   * order that takes longer carries on after the answer. An order that
   * fails is logged and reported, and the sweeps order the certificate
   * again; the record being found is what Check now asked about.
   */
  @CaptureSpan()
  public async orderCertOnceCnameIsVerified(
    statusPageDomain: StatusPageDomain,
    options?: { waitInMs?: number | undefined },
  ): Promise<CustomDomainVerificationResult> {
    // Served with the certificate its owner uploaded: nothing to order.
    if (statusPageDomain.isCustomCertificate) {
      return {
        certificateStatus: CustomDomainCertificateStatus.Uploaded,
      };
    }

    const name: string = CertificateOrder.normalizeDomain(
      statusPageDomain.fullDomain || "",
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
      if (!statusPageDomain.isSslOrdered && statusPageDomain.id) {
        // Verified again after a blip, with its certificate still good.
        await this.recordCertificatesAsOrdered([statusPageDomain.id]);
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

    const order: Promise<CustomDomainVerificationResult> =
      this.orderCertIfMissing(statusPageDomain, {
        onDemand: true,
        // The route found the record a moment ago.
        cnameVerifiedJustNow: true,
        renewIfExpired: true,
      }).then(
        (outcome: CertificateOrderOutcome): CustomDomainVerificationResult => {
          return {
            certificateStatus:
              outcome === CertificateOrderOutcome.AlreadyIssued
                ? CustomDomainCertificateStatus.Issued
                : CustomDomainCertificateStatus.Issuing,
          };
        },
        (err: unknown): CustomDomainVerificationResult => {
          logger.error(
            "Cannot order cert for domain: " + statusPageDomain.fullDomain,
            { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
          );
          logger.error(err, {
            fullDomain: statusPageDomain.fullDomain,
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
          }, options?.waitInMs ?? CustomDomainVerification.ORDER_WAIT_IN_MS);
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
   * verified: at most ORDER_MAX_PER_RUN orders, picked afresh every run.
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
   * each failed order counts against the account all the same.
   */
  private async orderCertsForVerifiedDomainsWithoutOne(
    domains: Array<StatusPageDomain>,
    options?: {
      // Every one of them was verified a moment ago, by this caller.
      cnameVerifiedJustNow?: boolean | undefined;
    },
  ): Promise<void> {
    const domainsWithName: Array<StatusPageDomain> = domains.filter(
      (domain: StatusPageDomain) => {
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
        domainsWithName.map((domain: StatusPageDomain) => {
          return CertificateOrder.normalizeDomain(domain.fullDomain as string);
        }),
      );

    const hasCertificate: (domain: StatusPageDomain) => boolean = (
      domain: StatusPageDomain,
    ): boolean => {
      return certificates.has(
        CertificateOrder.normalizeDomain(domain.fullDomain as string),
      );
    };

    const domainsToRecord: Array<StatusPageDomain> = domainsWithName.filter(
      (domain: StatusPageDomain) => {
        return hasCertificate(domain) && !domain.isSslOrdered;
      },
    );

    try {
      await this.recordCertificatesAsOrdered(
        domainsToRecord.map((domain: StatusPageDomain) => {
          return domain.id!;
        }),
      );
    } catch (err) {
      // The next run records them; the orders below still go ahead.
      logger.error(err);
    }

    const domainsToOrder: Array<StatusPageDomain> =
      await CertificateOrderFailures.withoutThoseWaitingToRetry({
        items: domainsWithName.filter((domain: StatusPageDomain) => {
          return !hasCertificate(domain);
        }),
        getDomain: (domain: StatusPageDomain): string => {
          return domain.fullDomain as string;
        },
        now: now,
      });

    const batch: Array<StatusPageDomain> = GreenlockUtil.pickForThisRun({
      items: domainsToOrder,
      max: Service.ORDER_MAX_PER_RUN,
      now: now,
      getKey: (domain: StatusPageDomain): string => {
        return domain.fullDomain || "";
      },
    });

    for (const domain of batch) {
      try {
        logger.debug("Ordering SSL for domain: " + domain.fullDomain, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);

        await this.orderCertIfMissing(domain, {
          fromSweep: true,
          cnameVerifiedJustNow: options?.cnameVerifiedJustNow,
        });
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
  public async getCertificates(
    domains: Array<StatusPageDomain>,
  ): Promise<Array<CustomDomainCertificate>> {
    const states: Map<string, CustomDomainCertificateState> =
      await CertificateOrder.getCertificateStates(
        domains.map((domain: StatusPageDomain) => {
          return domain.fullDomain || "";
        }),
      );

    return domains
      .filter((domain: StatusPageDomain) => {
        return Boolean(domain.id) && Boolean(domain.fullDomain);
      })
      .map((domain: StatusPageDomain): CustomDomainCertificate => {
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

  @CaptureSpan()
  public async updateSslProvisioningStatusForAllDomains(): Promise<void> {
    const domains: Array<StatusPageDomain> = await this.findBy({
      query: {
        isSslOrdered: true,
        isCustomCertificate: false,
      },
      select: {
        _id: true,
        fullDomain: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * Each domain costs a request out to the customer's status page, so walking
     * the fleet one at a time makes the sweep as long as the fleet is slow.
     * That length is the delay before an expired certificate is noticed and
     * reordered, so it is the outage a customer sees when renewal has not
     * already happened - it must stay well inside the sweep's own interval.
     */
    await ArrayUtil.forEachWithConcurrency(
      domains,
      Service.SSL_PROVISIONING_CHECK_CONCURRENCY,
      async (domain: StatusPageDomain): Promise<void> => {
        try {
          await this.updateSslProvisioningStatus(domain);
        } catch (err) {
          // one unreachable domain must not end the sweep for the rest.
          logger.error(err, {
            fullDomain: domain.fullDomain,
          } as LogAttributes);
        }
      },
    );
  }

  private async isSSLProvisioned(
    fulldomain: string,
    token: string,
  ): Promise<boolean> {
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await Domain.getForDomainVerification({
          url:
            "https://" +
            fulldomain +
            "/status-page-api/cname-verification/" +
            token,
          targetLabel: STATUS_PAGE_DOMAIN_EGRESS_LABEL,
        });

      if (result.isFailure()) {
        return false;
      }

      return true;
    } catch (err) {
      logger.error(err, { fullDomain: fulldomain } as LogAttributes);
      return false;
    }
  }

  @CaptureSpan()
  public async updateCnameStatusForStatusPageDomain(data: {
    domain: string;
    cnameStatus: boolean;
  }): Promise<void> {
    if (!data.cnameStatus) {
      await this.updateOneBy({
        query: {
          fullDomain: data.domain,
        },
        data: {
          isCnameVerified: false,
          isSslOrdered: false,
          isSslProvisioned: false,
        },
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneBy({
        query: {
          fullDomain: data.domain,
        },
        data: {
          isCnameVerified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async isCnameValid(fullDomain: string): Promise<boolean> {
    try {
      // get the token from the domain.

      logger.debug("Checking for CNAME " + fullDomain, {
        fullDomain,
      } as LogAttributes);

      const statusPageDomain: StatusPageDomain | null = await this.findOneBy({
        query: {
          fullDomain: fullDomain,
        },
        select: {
          _id: true,
          cnameVerificationToken: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!statusPageDomain) {
        return false;
      }

      const token: string = statusPageDomain.cnameVerificationToken!;

      logger.debug(
        "Checking for CNAME " + fullDomain + " with token " + token,
        { fullDomain } as LogAttributes,
      );

      try {
        const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await Domain.getForDomainVerification({
            url:
              "http://" +
              fullDomain +
              "/status-page-api/cname-verification/" +
              token,
            targetLabel: STATUS_PAGE_DOMAIN_EGRESS_LABEL,
          });

        logger.debug("CNAME verification result", {
          fullDomain,
        } as LogAttributes);
        logger.debug(result, { fullDomain } as LogAttributes);

        if (result.isSuccess()) {
          await this.updateCnameStatusForStatusPageDomain({
            domain: fullDomain,
            cnameStatus: true,
          });

          return true;
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      // try with https

      try {
        const resultHttps: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await Domain.getForDomainVerification({
            url:
              "https://" +
              fullDomain +
              "/status-page-api/cname-verification/" +
              token,
            targetLabel: STATUS_PAGE_DOMAIN_EGRESS_LABEL,
          });

        logger.debug("CNAME verification result for https", {
          fullDomain,
        } as LogAttributes);
        logger.debug(resultHttps, { fullDomain } as LogAttributes);

        if (resultHttps.isSuccess()) {
          await this.updateCnameStatusForStatusPageDomain({
            domain: fullDomain,
            cnameStatus: true,
          });

          return true;
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      try {
        if (StatusPageCNameRecord) {
          // check if cname record is set and if it matches StatusPageCNameRecord

          const cnameRecords: Array<string> = await Domain.getCnameRecords({
            domain: fullDomain,
          });

          let cnameRecord: string | undefined = undefined;
          if (cnameRecords.length > 0) {
            cnameRecord = cnameRecords[0]; // take the first record.
          }

          if (!cnameRecord) {
            logger.debug(
              `No CNAME record found for ${fullDomain}. Expected record: ${StatusPageCNameRecord}`,
              { fullDomain } as LogAttributes,
            );
            await this.updateCnameStatusForStatusPageDomain({
              domain: fullDomain,
              cnameStatus: false,
            });
            return false;
          }

          if (
            cnameRecord &&
            cnameRecord.trim().toLocaleLowerCase() ===
              StatusPageCNameRecord.trim().toLocaleLowerCase()
          ) {
            logger.debug(
              `CNAME record for ${fullDomain} matches the expected record: ${StatusPageCNameRecord}`,
              { fullDomain } as LogAttributes,
            );

            await this.updateCnameStatusForStatusPageDomain({
              domain: fullDomain,
              cnameStatus: true,
            });

            return true;
          }

          logger.debug(
            `CNAME record for ${fullDomain} is ${cnameRecord} and it does not match the expected record: ${StatusPageCNameRecord}`,
            { fullDomain } as LogAttributes,
          );
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      await this.updateCnameStatusForStatusPageDomain({
        domain: fullDomain,
        cnameStatus: false,
      });

      return false;
    } catch (err) {
      logger.debug("Failed checking for CNAME " + fullDomain, {
        fullDomain,
      } as LogAttributes);
      logger.debug(err, { fullDomain } as LogAttributes);

      await this.updateCnameStatusForStatusPageDomain({
        domain: fullDomain,
        cnameStatus: false,
      });

      return false;
    }
  }

  /*
   * Record whether this domain's certificate is being served yet.
   *
   * This never orders a certificate. It used to re-order whenever the HTTPS
   * probe failed while the CNAME still checked out - and right after an
   * order the probe fails as a rule, because nginx writes new certificates
   * to disk every 15 minutes, so a new domain was ordered twice. The
   * re-order could also delete a working certificate: it checks the CNAME
   * once more, and GreenlockUtil.orderCert removes the name's certificate
   * when that check fails, so a moment's DNS trouble between the two checks
   * took the domain off HTTPS. The two cases that do need an order have
   * capped sweeps of their own: checkOrderStatus re-orders a certificate
   * that has gone missing, and the renewal run renews one that is about to
   * expire or has expired.
   *
   * When the probe fails the CNAME is checked again, so a domain whose
   * record was removed goes back to asking for it. The result is written
   * only when it changes: this sweep visits every ordered domain every 15
   * minutes.
   */
  @CaptureSpan()
  public async updateSslProvisioningStatus(
    domain: StatusPageDomain,
  ): Promise<void> {
    if (!domain.id) {
      throw new BadDataException("DomainModel ID is required");
    }

    const statusPageDomain: StatusPageDomain | null = await this.findOneBy({
      query: {
        _id: domain.id?.toString(),
      },
      select: {
        _id: true,
        fullDomain: true,
        cnameVerificationToken: true,
        isSslProvisioned: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPageDomain) {
      throw new BadDataException("DomainModel not found");
    }

    logger.debug(
      `StatusPageCerts:CheckSslProvisioningStatus - Checking ${statusPageDomain.fullDomain}`,
      { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
    );

    const isProvisioned: boolean = await this.isSSLProvisioned(
      statusPageDomain.fullDomain!,
      statusPageDomain.cnameVerificationToken!,
    );

    if (!isProvisioned) {
      // isCnameValid also records the result on the domain.
      await this.isCnameValid(statusPageDomain.fullDomain!);
    }

    if (Boolean(statusPageDomain.isSslProvisioned) !== isProvisioned) {
      await this.updateOneById({
        id: statusPageDomain.id!,
        data: {
          isSslProvisioned: isProvisioned,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  /*
   * Order the first certificate of every verified domain that has none yet,
   * at most ORDER_MAX_PER_RUN per run (orderCertsForVerifiedDomainsWithoutOne).
   *
   * Only verified domains. This sweep used to try every domain not marked
   * ordered, verified or not, and without a limit: for a domain whose record
   * was not in place that was one more failed CNAME check every 15 minutes,
   * and for one whose check failed for a moment it was a duplicate order -
   * or, if the check failed again during the order, the deletion of its
   * working certificate. verifyCnameWhoseCnameisNotVerified checks the
   * unverified domains, and orders each one's certificate the moment it is
   * verified; this sweep is the fallback for the rest.
   */
  @CaptureSpan()
  public async orderSSLForDomainsWhichAreNotOrderedYet(): Promise<void> {
    return Telemetry.startActiveSpan<Promise<void>>({
      name: "StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet",
      options: { attributes: {} },
      fn: async (span: Span): Promise<void> => {
        try {
          const domains: Array<StatusPageDomain> = await this.findAllBy({
            query: {
              isCnameVerified: true,
              isSslOrdered: false,
              isCustomCertificate: false, // only order for non custom certificates.
            },
            select: {
              _id: true,
              fullDomain: true,
              isSslOrdered: true,
              isCustomCertificate: true,
            },
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          await this.orderCertsForVerifiedDomainsWithoutOne(domains);

          Telemetry.endSpan(span);
        } catch (err) {
          Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
            span,
            exception: err,
          });

          throw err;
        }
      },
    });
  }

  /*
   * Check every domain whose CNAME is not verified yet, at most
   * SSL_PROVISIONING_CHECK_CONCURRENCY at a time, and order the certificate
   * of each one that is verified now straight away rather than at the next
   * run of the order sweep. So a domain is served on its own certificate
   * within about 15 minutes of its record going live - nginx writes new
   * certificates every 15 minutes - whether or not anyone clicked Check now.
   */
  @CaptureSpan()
  public async verifyCnameWhoseCnameisNotVerified(): Promise<void> {
    const domains: Array<StatusPageDomain> = await this.findBy({
      query: {
        isCnameVerified: false,
      },
      select: {
        _id: true,
        fullDomain: true,
        isCustomCertificate: true,
        isSslOrdered: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const verifiedNow: Array<StatusPageDomain> = [];

    await ArrayUtil.forEachWithConcurrency(
      domains,
      Service.SSL_PROVISIONING_CHECK_CONCURRENCY,
      async (domain: StatusPageDomain): Promise<void> => {
        try {
          // isCnameValid also records the result on the domain.
          const isVerified: boolean = await this.isCnameValid(
            domain.fullDomain as string,
          );

          if (isVerified && !domain.isCustomCertificate) {
            verifiedNow.push(domain);
          }
        } catch (e) {
          logger.error(e, {
            fullDomain: domain.fullDomain as string,
          } as LogAttributes);
        }
      },
    );

    try {
      /*
       * Each was verified by this run a moment ago, so the orders do not
       * check the CNAME again.
       */
      await this.orderCertsForVerifiedDomainsWithoutOne(verifiedNow, {
        cnameVerifiedJustNow: true,
      });
    } catch (e) {
      // The order sweep orders them on its next run.
      logger.error(e);
    }
  }

  /*
   * Which of these certificate domains are status page domains. The renewal
   * run renews - and removes - only the certificates this returns, so the
   * certificates of dashboard domains and of the primary host, which share
   * the AcmeCertificate table, are never mistaken for status page domains
   * whose CNAME stopped validating.
   *
   * A domain serving a certificate its owner uploaded still claims its
   * Let's Encrypt certificate, which stays renewed meanwhile: nginx serves
   * the uploaded one for that name (AcmeWriteCertificates leaves it alone),
   * and switching back is then instant, on every nginx replica, including
   * ones that start with an empty certificate directory.
   */
  @CaptureSpan()
  public async getOwnedDomains(domains: Array<string>): Promise<Array<string>> {
    if (domains.length === 0) {
      return [];
    }

    const statusPageDomains: Array<StatusPageDomain> = await this.findBy({
      query: {
        fullDomain: QueryHelper.any(domains),
      },
      select: {
        fullDomain: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return statusPageDomains
      .map((statusPageDomain: StatusPageDomain) => {
        return statusPageDomain.fullDomain || "";
      })
      .filter((fullDomain: string) => {
        return fullDomain.length > 0;
      });
  }

  @CaptureSpan()
  public async renewCertsWhichAreExpiringSoon(): Promise<void> {
    await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
      getOwnedDomains: async (domains: Array<string>) => {
        return await this.getOwnedDomains(domains);
      },
      validateCname: async (fullDomain: string) => {
        return await this.isCnameValid(fullDomain);
      },
      notifyDomainRemoved: async (domain: string) => {
        // mark the domain as not ordered.
        await this.updateOneBy({
          query: {
            fullDomain: domain,
          },
          data: {
            isSslOrdered: false,
            isSslProvisioned: false,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug(`DomainModel removed from greenlock: ${domain}`, {
          fullDomain: domain,
        } as LogAttributes);
      },
    });
  }

  /*
   * Re-order the certificate of a domain that says it has one ordered but
   * whose certificate is gone, at most ORDER_MAX_PER_RUN per run, picked
   * afresh every run. It used to look the certificates up one domain at a
   * time and re-order every missing one in the same run, without a limit.
   *
   * The re-order goes through orderCertIfMissing like every first order, so
   * it never races one that Check now or the order sweep is placing. A
   * domain whose last re-orders failed waits longer after each failure
   * (CertificateOrderFailures).
   */
  @CaptureSpan()
  public async checkOrderStatus(): Promise<void> {
    const domains: Array<StatusPageDomain> = await this.findAllBy({
      query: {
        isSslOrdered: true,
        isCustomCertificate: false,
      },
      select: {
        _id: true,
        fullDomain: true,
        isCustomCertificate: true,
      },
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const domainsWithName: Array<StatusPageDomain> = domains.filter(
      (domain: StatusPageDomain) => {
        return Boolean(domain.id) && Boolean(domain.fullDomain);
      },
    );

    if (domainsWithName.length === 0) {
      return;
    }

    const certificates: Map<string, AcmeCertificate> =
      await GreenlockUtil.findCertificatesByDomain(
        domainsWithName.map((domain: StatusPageDomain) => {
          return CertificateOrder.normalizeDomain(domain.fullDomain as string);
        }),
      );

    const now: Date = OneUptimeDate.getCurrentDate();

    const domainsWithoutCertificate: Array<StatusPageDomain> =
      await CertificateOrderFailures.withoutThoseWaitingToRetry({
        items: domainsWithName.filter((domain: StatusPageDomain) => {
          return !certificates.has(
            CertificateOrder.normalizeDomain(domain.fullDomain as string),
          );
        }),
        getDomain: (domain: StatusPageDomain): string => {
          return domain.fullDomain as string;
        },
        now: now,
      });

    const batch: Array<StatusPageDomain> = GreenlockUtil.pickForThisRun({
      items: domainsWithoutCertificate,
      max: Service.ORDER_MAX_PER_RUN,
      now: now,
      getKey: (domain: StatusPageDomain): string => {
        return domain.fullDomain || "";
      },
    });

    for (const domain of batch) {
      try {
        await this.orderCertIfMissing(domain, { fromSweep: true });
      } catch (err) {
        logger.error("Cannot order cert for domain: " + domain.fullDomain, {
          fullDomain: domain.fullDomain,
        } as LogAttributes);
        logger.error(err, { fullDomain: domain.fullDomain } as LogAttributes);
      }
    }
  }
}
export default new Service();
