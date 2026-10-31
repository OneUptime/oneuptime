import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import GreenlockUtil from "../Utils/Greenlock/Greenlock";
import CertificateOrder, {
  CertificateOrderOutcome,
} from "../Utils/Greenlock/CertificateOrder";
import CustomDomainOrders from "../Utils/Greenlock/CustomDomainOrders";
import { CertificateOrderLockHandle } from "../Utils/Greenlock/CertificateOrderLock";
import { CertificateOrderReason } from "../Utils/Greenlock/CertificateOrderBudget";
import CertificateOrderFailures from "../Utils/Greenlock/CertificateOrderFailures";
import CertificateReissueOrder from "../Utils/Greenlock/CertificateReissueOrder";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import DomainService from "./DomainService";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import AcmeCertificate from "../../Models/DatabaseModels/AcmeCertificate";
import DomainModel from "../../Models/DatabaseModels/Domain";
import FormDomain from "../../Models/DatabaseModels/FormDomain";
import Telemetry, { Span } from "../Utils/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { FormCNameRecord } from "../EnvironmentConfig";
import Domain from "../Types/Domain";
import OneUptimeDate from "../../Types/Date";
import CertificateReissueUtil from "../../Utils/CertificateReissue";
import QueryHelper from "../Types/Database/QueryHelper";
import ArrayUtil from "../../Utils/Array";
import { CustomDomainVerificationResult } from "../../Types/CustomDomain/CustomDomainVerification";
import { CustomDomainCertificate } from "../../Types/CustomDomain/CustomDomainCertificates";
import { getFormCustomDomainVerificationUrl } from "../../Types/Form/FormCustomDomain";
import CustomDomainConflicts, {
  CustomDomainKind,
} from "../Utils/CustomDomain/CustomDomainConflicts";
import CertificateOwners, {
  CertificateOwner,
} from "../Utils/Greenlock/CertificateOwners";

const FORM_DOMAIN_EGRESS_LABEL: string = "Form domain";

/*
 * A form's own domains (FormDomain): adding one, its CNAME record and its
 * free certificate, and finding the form a domain answers with.
 *
 * The twin of StatusPageDomainService and DashboardDomainService, step for
 * step, so a form's domain is verified, ordered, provisioned, renewed and
 * reissued exactly as theirs are, through the same shared steps
 * (CustomDomainOrders, CertificateOrder, GreenlockUtil.orderCert) and from
 * the same Let's Encrypt allowance. CustomDomainCertificateLifecycle runs
 * every scenario of a domain's certificate for all three.
 *
 * What is the form's own:
 *
 *   - its CNAME record is FORM_CNAME_RECORD, else the status page one
 *     (FormCNameRecord): one ingress serves every custom domain;
 *   - the check that a domain reaches this installation fetches the form
 *     API's verification route on the domain
 *     (Types/Form/FormCustomDomain), which answers for form domains only;
 *   - a domain is refused when its name is in use anywhere on the
 *     installation (CustomDomainConflicts): a form's domain is found by its
 *     name alone;
 *   - the form, the domain and the subdomain are fixed once it is added;
 *   - getShareKeyOfFormOnDomain: which form a visit to a name opens.
 */
export class Service extends ProjectReferencesService<FormDomain> {
  /*
   * How many certificates the form domain sweeps may order: the first orders
   * and the re-orders of a certificate that has gone missing together, in
   * one 15-minute window (SWEEP_ORDER_BUDGET, CertificateOrder.takeOrderSlot)
   * - and, separately, how many the form domain renewal run renews per run.
   *
   * Every order spends from the one Let's Encrypt account the whole
   * installation shares - 300 new orders per account per three hours - with
   * the status page and dashboard certificates. These caps keep a backlog
   * worked off a few domains per run rather than in one burst, and none of
   * them can order beyond the installation's own budget for that account
   * (CertificateOrderBudget), which every order of every kind draws from.
   */
  public static readonly ORDER_MAX_PER_RUN: number = 5;

  // The budget the form domain ordering sweeps share (CertificateOrder.takeOrderSlot).
  public static readonly SWEEP_ORDER_BUDGET: string = "FormDomainSweeps";

  /*
   * How many domains the verification and provisioning sweeps check at once.
   * Each check is a bounded request out to a customer domain; the same
   * figure the status page provisioning sweep uses.
   */
  public static readonly DOMAIN_CHECK_CONCURRENCY: number = 10;

  public constructor() {
    super(FormDomain);
  }

  /*
   * Normalize a submitted subdomain and reject anything that is not a plain
   * DNS label chain.
   *
   * fullDomain is built as `${subdomain}.${baseDomain}` and then interpolated
   * into "https://" + fullDomain + "/api/form/custom-domain/..." — and URL
   * parsing treats everything before the first "/" as the host. Without this
   * check a subdomain of "169.254.169.254/latest/meta-data/#" hands an
   * attacker the host, the port and the path of a request the certificate
   * cron then makes unattended, every 15 minutes, from inside the cluster.
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
        `Subdomain ${normalized} is not valid. Use a plain subdomain such as "report" — schemes, ports, paths and "/" are not allowed.`,
      );
    }

    return normalized;
  }

  /*
   * The subdomain is fixed once the domain is added, as the form and the
   * domain are: the full domain is worked out on create and never again, so
   * a subdomain changed afterwards would change nothing - and a status page
   * or dashboard domain whose subdomain an API call changed kept serving its
   * old name. No caller may write it on an update (its column grants no
   * one), and an update OneUptime makes itself is held to the same rule.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<FormDomain>,
  ): Promise<OnUpdate<FormDomain>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.subdomain !== undefined) {
      throw new BadDataException(
        "A form domain's subdomain cannot be changed. Add the domain you want, then delete this one.",
      );
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<FormDomain>,
  ): Promise<OnCreate<FormDomain>> {
    await super.onBeforeCreate(createBy);

    /*
     * The form under either of its names (the two must agree), kept in the
     * ID column for the saved row. Whether the caller may read it, and that
     * it is a form of their project, the permission layer and the project
     * reference check have asked by now.
     */
    RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      ["formId", "form"],
      "Form",
    );

    /*
     * The domain under either of its names (the two must agree), kept in
     * the ID column for the saved row.
     */
    const domainId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      ["domainId", "domain"],
      "Domain",
    );

    const domain: DomainModel | null = await DomainService.findOneBy({
      query: {
        _id: domainId?.toString() || "",
      },
      select: { domain: true, isVerified: true },
      props: {
        isRoot: true,
      },
    });

    if (!domain?.isVerified) {
      throw new BadDataException(
        "This domain is not verified. Please verify it in Project Settings > Advanced > Domains.",
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

    /*
     * One name, one thing to show: a name a status page, a dashboard or
     * another form already has is refused, in any project
     * (CustomDomainConflicts).
     */
    await CustomDomainConflicts.assertNameIsFree({
      kind: CustomDomainKind.Form,
      fullDomain: createBy.data.fullDomain || "",
    });

    createBy.data.cnameVerificationToken = ObjectID.generate().toString();

    /*
     * A new domain starts unverified, with nothing ordered, provisioned or
     * reissued, whatever the request said: the sweeps and Check now find out.
     * Computed columns, so a create may carry them (a form that sends every
     * default); they are never what it asked for.
     */
    createBy.data.isCnameVerified = false;
    createBy.data.isSslOrdered = false;
    createBy.data.isSslProvisioned = false;
    delete (createBy.data as unknown as Record<string, unknown>)[
      "certificateReissueRequestedAt"
    ];

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
    deleteBy: DeleteBy<FormDomain>,
  ): Promise<OnDelete<FormDomain>> {
    // The domains the delete removes, and the delete held to them.
    const domains: Array<FormDomain> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, { fullDomain: true });

    return { deleteBy, carryForward: domains };
  }

  /*
   * A removed domain takes its certificate with it - unless something else
   * on the installation still claims the name (CertificateOwners): a status
   * page or dashboard domain of the same name, from before names were
   * refused when in use, or the installation's own host.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<FormDomain>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<FormDomain>> {
    for (const domain of onDelete.carryForward) {
      if (!domain.fullDomain) {
        continue;
      }

      if (await this.isNameClaimedByAnotherOwner(domain.fullDomain)) {
        continue;
      }

      await this.removeDomainFromGreenlock(domain.fullDomain);
    }

    return onDelete;
  }

  /*
   * Whether a certificate owner other than form domains claims this name.
   * When that cannot be read, the name is taken to be claimed: a certificate
   * left behind is cleaned up once it has long expired; one taken from a
   * live domain is an outage.
   */
  private async isNameClaimedByAnotherOwner(fullDomain: string): Promise<boolean> {
    const owners: Array<CertificateOwner> = CertificateOwners.getAll().filter(
      (owner: CertificateOwner): boolean => {
        return owner.name !== CertificateOwners.FORM_DOMAINS_OWNER_NAME;
      },
    );

    for (const owner of owners) {
      try {
        const owned: Array<string> = await owner.getOwnedDomains([fullDomain]);

        if (owned.length > 0) {
          return true;
        }
      } catch (err) {
        logger.error(err, { fullDomain: fullDomain } as LogAttributes);
        return true;
      }
    }

    return false;
  }

  @CaptureSpan()
  public async removeDomainFromGreenlock(domain: string): Promise<void> {
    await GreenlockUtil.removeDomain(domain);
  }

  /*
   * Whether this token is the verification token of the form domain of this
   * name - what the CNAME check fetches on the domain answers
   * (FormAPI, Types/Form/FormCustomDomain). A token is generated as a UUID,
   * so anything else is no token, and is not looked up.
   */
  @CaptureSpan()
  public async isVerificationTokenOfDomain(data: {
    hostname: string | null | undefined;
    token: unknown;
  }): Promise<boolean> {
    const name: string = (data.hostname || "").trim().toLowerCase();
    const token: string =
      typeof data.token === "string" ? data.token.trim().toLowerCase() : "";

    if (!name || !ObjectID.isValidUUID(token)) {
      return false;
    }

    const formDomain: FormDomain | null = await this.findOneBy({
      query: {
        fullDomain: name,
        cnameVerificationToken: token,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(formDomain);
  }

  /*
   * The share key of the form a visit to this name opens: the form domain of
   * exactly this name - lower case, without a port or a trailing dot, as
   * the request's own Host header says it (normalizeStatusPageRequestHost) -
   * whose project still has the parent domain verified. Null for any other
   * name: one no form has, a status page's or a dashboard's, a form domain
   * whose domain is no longer verified, or a lookup that failed.
   *
   * Only the key: everything else about the form - whether it is on, its
   * plan, its IP allowlist - is asked of the form by its key, exactly as for
   * a visit to its link (FormService.getPublicForm), so a form on its domain
   * is held to every rule its link is.
   */
  @CaptureSpan()
  public async getShareKeyOfFormOnDomain(
    hostname: string | null | undefined,
  ): Promise<string | null> {
    const name: string = (hostname || "").trim().toLowerCase();

    if (!name || !Domain.isValidDomain(name)) {
      return null;
    }

    try {
      const formDomain: FormDomain | null = await this.findOneBy({
        query: {
          fullDomain: name,
          domain: {
            isVerified: true,
          } as DomainModel,
        },
        select: {
          _id: true,
          form: {
            _id: true,
            shareKey: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      const shareKey: string | undefined = formDomain?.form?.shareKey
        ?.toString()
        .toLowerCase();

      return shareKey && ObjectID.isValidUUID(shareKey) ? shareKey : null;
    } catch (err) {
      logger.error(err, { fullDomain: name } as LogAttributes);
      return null;
    }
  }

  /*
   * The domain with its full name and whether it serves an uploaded
   * certificate, read once when the caller did not have them both.
   */
  private async getDomainToOrder(
    formDomain: FormDomain,
  ): Promise<FormDomain> {
    if (!formDomain.id) {
      throw new BadDataException(
        "Domain ID is required to order a certificate",
      );
    }

    if (
      formDomain.fullDomain &&
      formDomain.isCustomCertificate !== undefined
    ) {
      return formDomain;
    }

    const fetchedFormDomain: FormDomain | null = await this.findOneBy(
      {
        query: {
          _id: formDomain.id.toString(),
        },
        select: {
          _id: true,
          fullDomain: true,
          isCustomCertificate: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    if (!fetchedFormDomain) {
      throw new BadDataException("DomainModel not found");
    }

    if (!fetchedFormDomain.fullDomain) {
      throw new BadDataException(
        "Unable to order certificate because domain is null",
      );
    }

    return fetchedFormDomain;
  }

  /*
   * Order this domain's certificate and record it: a first certificate
   * (the default), or a reissue. GreenlockUtil.orderCert places it under the
   * name's order lock - the one handed in, or its own - and within the
   * installation's Let's Encrypt allowance; the outcome says whether it
   * ordered. A CNAME check that fails refuses the order and no longer
   * deletes the domain's certificate.
   */
  @CaptureSpan()
  public async orderCert(
    formDomain: FormDomain,
    options?: {
      reason?: CertificateOrderReason | undefined;
      // The name's order lock, when the caller holds it.
      lock?: CertificateOrderLockHandle | undefined;
      // The caller has just found the domain's CNAME record.
      cnameVerifiedJustNow?: boolean | undefined;
      /*
       * The caller's share of orders (CertificateOrder.getOrderShare),
       * asked once the CNAME check has passed.
       */
      mayOrder?: (() => Promise<boolean>) | undefined;
    },
  ): Promise<CertificateOrderOutcome> {
    return Telemetry.startActiveSpan<Promise<CertificateOrderOutcome>>({
      name: "FormDomainService.orderCert",
      options: {
        attributes: {
          fullDomain: formDomain.fullDomain,
          _id: formDomain.id?.toString(),
        },
      },
      fn: async (span: Span): Promise<CertificateOrderOutcome> => {
        try {
          const domainToOrder: FormDomain =
            await this.getDomainToOrder(formDomain);

          logger.debug("Ordering SSL for domain: " + domainToOrder.fullDomain, {
            fullDomain: domainToOrder.fullDomain,
          } as LogAttributes);

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
              mayOrder: options?.mayOrder,
            });

          if (outcome === CertificateOrderOutcome.Ordered) {
            logger.debug(
              "SSL ordered for domain: " + domainToOrder.fullDomain,
              { fullDomain: domainToOrder.fullDomain } as LogAttributes,
            );

            /*
             * Verified as well as ordered: Let's Encrypt has just fetched
             * its challenge from this domain, so the domain reaches us.
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
   * domains that are still verified (see StatusPageDomainService's twin).
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
   * Order this domain's free certificate unless it has one already, or one
   * is being ordered for it right now (CertificateOrder.orderIfMissing): the
   * one way a first certificate is ordered, whether by Check now, by the
   * form domain sweeps or by the order-ssl API, so a name is never ordered
   * twice. Never for a domain that serves a certificate its owner uploaded.
   * Throws what the order throws, so a caller can show why.
   */
  @CaptureSpan()
  public async orderCertIfMissing(
    formDomain: FormDomain,
    options?: {
      // An order of the sweeps: it draws from their shared window budget.
      fromSweep?: boolean | undefined;
      // An order somebody asked for: it draws from the on-demand budget.
      onDemand?: boolean | undefined;
      // The caller has just found the domain's CNAME record.
      cnameVerifiedJustNow?: boolean | undefined;
      // Order for an expired certificate too (Check now).
      renewIfExpired?: boolean | undefined;
    },
  ): Promise<CertificateOrderOutcome> {
    const domainToOrder: FormDomain =
      await this.getDomainToOrder(formDomain);

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
          mayOrder: CertificateOrder.getOrderShare({
            sweep: options?.fromSweep
              ? {
                  budget: Service.SWEEP_ORDER_BUDGET,
                  maxPerWindow: Service.ORDER_MAX_PER_RUN,
                }
              : undefined,
            onDemand: options?.onDemand
              ? { projectId: domainToOrder.projectId?.toString() }
              : undefined,
          }),
        });
      },
    });
  }

  /*
   * Called by verify-cname - the domain's Check now - once it has found the
   * domain's CNAME record: order the domain's free certificate now rather
   * than at the next run of the order sweep, and say what happens to its
   * certificate next. The same step as a status page domain's
   * (CustomDomainOrders.orderOnceCnameIsVerified): one on-demand order per
   * domain per 15 minutes, counted against the domain's project, under the
   * name's lock and within the installation's Let's Encrypt allowance; never
   * for an uploaded certificate; Issued only for a certificate that is there
   * and has not expired. Never rejects.
   */
  @CaptureSpan()
  public async orderCertOnceCnameIsVerified(
    formDomain: FormDomain,
    options?: { waitInMs?: number | undefined },
  ): Promise<CustomDomainVerificationResult> {
    return await CustomDomainOrders.orderOnceCnameIsVerified({
      domain: formDomain,
      waitInMs: options?.waitInMs,
      recordAsOrdered: async (): Promise<void> => {
        await this.recordCertificatesAsOrdered([formDomain.id!]);
      },
      orderIfMissing: async (): Promise<CertificateOrderOutcome> => {
        return await this.orderCertIfMissing(formDomain, {
          onDemand: true,
          // The route found the record a moment ago.
          cnameVerifiedJustNow: true,
          renewIfExpired: true,
        });
      },
    });
  }

  /*
   * Where the certificates of these domains stand, for the Custom Domains
   * page's Status column (CustomDomainCertificates): each one's expiry, and
   * its last failed order while no order since has succeeded.
   */
  @CaptureSpan()
  public async getCertificates(
    domains: Array<FormDomain>,
  ): Promise<Array<CustomDomainCertificate>> {
    return await CustomDomainOrders.getCertificates(domains);
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

    const formDomain: FormDomain | null = await this.findOneBy({
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

    if (!formDomain) {
      throw new BadDataException("Domain not found.");
    }

    if (!formDomain.fullDomain) {
      throw new BadDataException(
        "Unable to reissue certificate because domain is null",
      );
    }

    /*
     * Nothing to reissue: the certificate on a custom-certificate domain is
     * the one the customer uploaded, and we have no way to obtain another.
     */
    if (formDomain.isCustomCertificate) {
      throw new BadDataException(
        "This domain uses a certificate you uploaded yourself, so there is no Let's Encrypt certificate to reissue. Please edit this domain and upload a new certificate instead.",
      );
    }

    if (!formDomain.isCnameVerified) {
      throw new BadDataException(
        "CNAME is not verified. Please verify CNAME first before you reissue the SSL certificate.",
      );
    }

    /*
     * A domain that never ordered a certificate has nothing to reissue. Its
     * first certificate is ordered on its own once the CNAME is verified, and
     * the Custom Domains page shows Reissue SSL only after that.
     */
    if (!formDomain.isSslOrdered) {
      throw new BadDataException(
        "No SSL certificate has been ordered for this domain yet. One is ordered automatically once its CNAME record is verified.",
      );
    }

    await CertificateReissueOrder.reissue({
      domain: formDomain.fullDomain,
      now: now,
      lastReissueRequestedAt: formDomain.certificateReissueRequestedAt,
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
              formDomain.certificateReissueRequestedAt || null,
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
          "Reissuing SSL certificate for domain: " + formDomain.fullDomain,
          { fullDomain: formDomain.fullDomain } as LogAttributes,
        );

        return await this.orderCert(formDomain, {
          reason: CertificateOrderReason.Reissue,
          lock: lock,
        });
      },
    });
  }

  @CaptureSpan()
  public async updateSslProvisioningStatusForAllDomains(): Promise<void> {
    const domains: Array<FormDomain> = await this.findBy({
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

    await ArrayUtil.forEachWithConcurrency(
      domains,
      Service.DOMAIN_CHECK_CONCURRENCY,
      async (domain: FormDomain): Promise<void> => {
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
          url: getFormCustomDomainVerificationUrl({
            protocol: "https",
            fullDomain: fulldomain,
            token: token,
          }),
          targetLabel: FORM_DOMAIN_EGRESS_LABEL,
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
  public async updateCnameStatusForFormDomain(data: {
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
  public async isCnameValid(
    fullDomain: string,
    options?: {
      /*
       * Whether the answer is written to the domain row: verified, or
       * unverified, unordered and unprovisioned. The renewal run passes
       * false - a DNS blip while it renews must not reset a domain whose
       * certificate it keeps; the provisioning sweep still notices a
       * record that is really gone.
       */
      recordResult?: boolean | undefined;
    },
  ): Promise<boolean> {
    const recordResult: (cnameStatus: boolean) => Promise<void> = async (
      cnameStatus: boolean,
    ): Promise<void> => {
      if (options?.recordResult === false) {
        return;
      }

      await this.updateCnameStatusForFormDomain({
        domain: fullDomain,
        cnameStatus: cnameStatus,
      });
    };

    try {
      logger.debug("Checking for CNAME " + fullDomain, {
        fullDomain,
      } as LogAttributes);

      const formDomain: FormDomain | null = await this.findOneBy({
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

      if (!formDomain) {
        return false;
      }

      const token: string = formDomain.cnameVerificationToken!;

      logger.debug(
        "Checking for CNAME " + fullDomain + " with token " + token,
        { fullDomain } as LogAttributes,
      );

      try {
        const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await Domain.getForDomainVerification({
            url: getFormCustomDomainVerificationUrl({
              protocol: "http",
              fullDomain: fullDomain,
              token: token,
            }),
            targetLabel: FORM_DOMAIN_EGRESS_LABEL,
          });

        logger.debug("CNAME verification result", {
          fullDomain,
        } as LogAttributes);
        logger.debug(result, { fullDomain } as LogAttributes);

        if (result.isSuccess()) {
          await recordResult(true);

          return true;
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      try {
        const resultHttps: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await Domain.getForDomainVerification({
            url: getFormCustomDomainVerificationUrl({
              protocol: "https",
              fullDomain: fullDomain,
              token: token,
            }),
            targetLabel: FORM_DOMAIN_EGRESS_LABEL,
          });

        logger.debug("CNAME verification result for https", {
          fullDomain,
        } as LogAttributes);
        logger.debug(resultHttps, { fullDomain } as LogAttributes);

        if (resultHttps.isSuccess()) {
          await recordResult(true);

          return true;
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      try {
        if (FormCNameRecord) {
          const cnameRecords: Array<string> = await Domain.getCnameRecords({
            domain: fullDomain,
          });

          let cnameRecord: string | undefined = undefined;
          if (cnameRecords.length > 0) {
            cnameRecord = cnameRecords[0];
          }

          if (!cnameRecord) {
            logger.debug(
              `No CNAME record found for ${fullDomain}. Expected record: ${FormCNameRecord}`,
              { fullDomain } as LogAttributes,
            );
            await recordResult(false);
            return false;
          }

          if (
            cnameRecord &&
            cnameRecord.trim().toLocaleLowerCase() ===
              FormCNameRecord.trim().toLocaleLowerCase()
          ) {
            logger.debug(
              `CNAME record for ${fullDomain} matches the expected record: ${FormCNameRecord}`,
              { fullDomain } as LogAttributes,
            );

            await recordResult(true);

            return true;
          }

          logger.debug(
            `CNAME record for ${fullDomain} is ${cnameRecord} and it does not match the expected record: ${FormCNameRecord}`,
            { fullDomain } as LogAttributes,
          );
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      await recordResult(false);

      return false;
    } catch (err) {
      logger.debug("Failed checking for CNAME " + fullDomain);
      logger.debug(err);

      await recordResult(false);

      return false;
    }
  }

  /*
   * Record whether this domain's certificate is being served yet.
   *
   * Unlike the status page sweep this never orders a certificate. A probe
   * that fails right after an order is usually racing nginx, which writes
   * new certificates to disk every 15 minutes, and re-ordering then spends a
   * second order on the same name. The two cases that do need an order have
   * capped sweeps of their own: checkOrderStatus re-orders a certificate that
   * has gone missing, and the renewal run renews one that is about to expire.
   *
   * When the probe fails the CNAME is checked again, so a domain whose record
   * was removed goes back to asking for it. The result is written only when
   * it changes: this sweep visits every ordered domain every 15 minutes.
   */
  @CaptureSpan()
  public async updateSslProvisioningStatus(
    domain: FormDomain,
  ): Promise<void> {
    if (!domain.id) {
      throw new BadDataException("DomainModel ID is required");
    }

    const formDomain: FormDomain | null = await this.findOneBy({
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

    if (!formDomain) {
      throw new BadDataException("DomainModel not found");
    }

    logger.debug(
      `FormCerts:CheckSslProvisioningStatus - Checking ${formDomain.fullDomain}`,
      { fullDomain: formDomain.fullDomain } as LogAttributes,
    );

    const isProvisioned: boolean = await this.isSSLProvisioned(
      formDomain.fullDomain!,
      formDomain.cnameVerificationToken!,
    );

    if (!isProvisioned) {
      // isCnameValid also records the result on the domain.
      await this.isCnameValid(formDomain.fullDomain!);
    }

    if (Boolean(formDomain.isSslProvisioned) !== isProvisioned) {
      await this.updateOneById({
        id: formDomain.id!,
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
   * Order the first certificate of each of these domains, whose CNAME is
   * verified: at most ORDER_MAX_PER_RUN orders in a window between the
   * sweeps that order, picked afresh every run; a domain that has a
   * certificate already is only recorded as ordered, and one whose orders
   * keep failing waits longer after each failure
   * (CustomDomainOrders.orderForVerifiedDomainsWithoutOne, which the status
   * page sweeps share).
   */
  private async orderCertsForVerifiedDomainsWithoutOne(
    domains: Array<FormDomain>,
    options?: {
      // Every one of them was verified a moment ago, by this caller.
      cnameVerifiedJustNow?: boolean | undefined;
    },
  ): Promise<void> {
    await CustomDomainOrders.orderForVerifiedDomainsWithoutOne<FormDomain>(
      {
        domains: domains,
        maxPerRun: Service.ORDER_MAX_PER_RUN,
        recordAsOrdered: async (domainIds: Array<ObjectID>): Promise<void> => {
          await this.recordCertificatesAsOrdered(domainIds);
        },
        orderIfMissing: async (
          domain: FormDomain,
        ): Promise<CertificateOrderOutcome> => {
          return await this.orderCertIfMissing(domain, {
            fromSweep: true,
            cnameVerifiedJustNow: options?.cnameVerifiedJustNow,
          });
        },
      },
    );
  }

  /*
   * Order the first certificate for domains whose CNAME is verified.
   *
   * Only verified domains: verifyCnameWhoseCnameisNotVerified checks the
   * rest - and orders each one's certificate the moment it is verified, so
   * this sweep is the fallback for the rest - and ordering one whose record
   * is not in place would only fail the CNAME check again.
   *
   * A domain that already has a certificate is only recorded as ordered -
   * all of them in one write. That is the domain whose CNAME check failed
   * for a moment - which marks it unordered - and then passed again.
   * Ordering for it would spend an order on a duplicate (Let's Encrypt
   * allows five a week per name), and if its certificate is due, the renewal
   * run orders it in this same tick. The rest are ordered through
   * orderCertIfMissing, at most ORDER_MAX_PER_RUN in a window between the
   * sweeps that order, picked afresh every run
   * (GreenlockUtil.pickForThisRun), so a domain whose order keeps failing
   * cannot hold a slot the others are waiting for; it also waits longer
   * after each failure in a row (CertificateOrderFailures).
   */
  @CaptureSpan()
  public async orderSSLForDomainsWhichAreNotOrderedYet(): Promise<void> {
    return Telemetry.startActiveSpan<Promise<void>>({
      name: "FormDomainService.orderSSLForDomainsWhichAreNotOrderedYet",
      options: { attributes: {} },
      fn: async (span: Span): Promise<void> => {
        try {
          const domains: Array<FormDomain> = await this.findAllBy({
            query: {
              isCnameVerified: true,
              isSslOrdered: false,
              isCustomCertificate: false,
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
   * DOMAIN_CHECK_CONCURRENCY at a time, and order the certificate of each
   * one that is verified now straight away rather than at the next run of
   * the order sweep - as the status page sweep does. So a domain is served
   * on its own certificate within about 15 minutes of its record going live
   * - nginx writes new certificates every 15 minutes - whether or not
   * anyone clicked Check now.
   */
  @CaptureSpan()
  public async verifyCnameWhoseCnameisNotVerified(): Promise<void> {
    const domains: Array<FormDomain> = await this.findBy({
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

    const verifiedNow: Array<FormDomain> = [];

    await ArrayUtil.forEachWithConcurrency(
      domains,
      Service.DOMAIN_CHECK_CONCURRENCY,
      async (domain: FormDomain): Promise<void> => {
        try {
          // isCnameValid also records the result on the domain.
          const isVerified: boolean = await this.isCnameValid(
            domain.fullDomain as string,
          );

          if (isVerified && !domain.isCustomCertificate) {
            verifiedNow.push(domain);
          }
        } catch (e) {
          logger.error(e, { fullDomain: domain.fullDomain } as LogAttributes);
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
   * Which of these certificate domains are form domains. The renewal run
   * renews - and removes - only the certificates this returns, so the
   * certificates of status page and dashboard domains and of the primary
   * host, which share the AcmeCertificate table, are never mistaken for form
   * domains whose CNAME stopped validating.
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

    const formDomains: Array<FormDomain> = await this.findBy({
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

    return formDomains
      .map((formDomain: FormDomain) => {
        return formDomain.fullDomain || "";
      })
      .filter((fullDomain: string) => {
        return fullDomain.length > 0;
      });
  }

  @CaptureSpan()
  public async renewCertsWhichAreExpiringSoon(): Promise<void> {
    await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
      maxPerRun: Service.ORDER_MAX_PER_RUN,
      getOwnedDomains: async (domains: Array<string>) => {
        return await this.getOwnedDomains(domains);
      },
      /*
       * A check that writes nothing: a DNS blip while a certificate is
       * renewed must not mark the domain unverified and unordered while its
       * certificate keeps serving.
       */
      validateCname: async (fullDomain: string) => {
        return await this.isCnameValid(fullDomain, { recordResult: false });
      },
      notifyDomainRemoved: async (domain: string) => {
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
   * whose certificate is gone, at most ORDER_MAX_PER_RUN per run.
   *
   * A certificate can go missing while its domain keeps saying "ordered":
   * removed by hand, or by a renewal that found it expired. Without this,
   * nginx would serve the stale copy on disk until it expired, then nothing.
   * Domains are picked afresh every run, for the same reason as in the
   * first-order sweep above, and re-ordered through orderCertIfMissing, so a
   * re-order never races another order for the same name and shares the
   * sweeps' budget.
   */
  @CaptureSpan()
  public async checkOrderStatus(): Promise<void> {
    const domains: Array<FormDomain> = await this.findAllBy({
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

    const fullDomains: Array<string> = domains
      .map((domain: FormDomain) => {
        return domain.fullDomain || "";
      })
      .filter((fullDomain: string) => {
        return fullDomain.length > 0;
      });

    if (fullDomains.length === 0) {
      return;
    }

    const certificates: Map<string, AcmeCertificate> =
      await GreenlockUtil.findCertificatesByDomain(
        fullDomains.map((fullDomain: string) => {
          return CertificateOrder.normalizeDomain(fullDomain);
        }),
      );

    const now: Date = OneUptimeDate.getCurrentDate();

    const domainsWithoutCertificate: Array<FormDomain> =
      await CertificateOrderFailures.withoutThoseWaitingToRetry({
        items: domains.filter((domain: FormDomain) => {
          return (
            Boolean(domain.id) &&
            Boolean(domain.fullDomain) &&
            !certificates.has(
              CertificateOrder.normalizeDomain(domain.fullDomain as string),
            )
          );
        }),
        getDomain: (domain: FormDomain): string => {
          return domain.fullDomain as string;
        },
        now: now,
      });

    const batch: Array<FormDomain> = GreenlockUtil.pickForThisRun({
      items: domainsWithoutCertificate,
      max: Service.ORDER_MAX_PER_RUN,
      now: now,
      getKey: (domain: FormDomain): string => {
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
