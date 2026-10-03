import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import GreenlockUtil from "../Utils/Greenlock/Greenlock";
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
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import AcmeCertificateService from "./AcmeCertificateService";
import Telemetry, { Span } from "../Utils/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DashboardCNameRecord } from "../EnvironmentConfig";
import Domain from "../Types/Domain";
import OneUptimeDate from "../../Types/Date";
import CertificateReissueUtil from "../../Utils/CertificateReissue";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import QueryHelper from "../Types/Database/QueryHelper";
import ArrayUtil from "../../Utils/Array";

const DASHBOARD_DOMAIN_EGRESS_LABEL: string = "Dashboard domain";

export class Service extends DatabaseService<DashboardDomain> {
  /*
   * How many certificates one run of each sweep that orders them - first
   * orders, re-orders of a certificate that has gone missing, and renewals -
   * may order.
   *
   * Every order spends from the one Let's Encrypt account the whole
   * installation shares - 300 new orders per account per three hours - and
   * status page certificates, the larger fleet, are ordered and renewed from
   * it too. So even with all three sweeps full on every 15-minute run the
   * dashboard jobs order at most 15 certificates a run, 180 in three hours,
   * and a backlog - such as the first runs re-ordering every dashboard
   * certificate the status page renewal job used to delete - is worked off a
   * few domains per run rather than in one burst.
   */
  public static readonly ORDER_MAX_PER_RUN: number = 5;

  /*
   * How many domains the verification and provisioning sweeps check at once.
   * Each check is a bounded request out to a customer domain; the same
   * figure the status page provisioning sweep uses.
   */
  public static readonly DOMAIN_CHECK_CONCURRENCY: number = 10;

  public constructor() {
    super(DashboardDomain);
  }

  /*
   * Normalize a submitted subdomain and reject anything that is not a plain
   * DNS label chain.
   *
   * fullDomain is built as `${subdomain}.${baseDomain}` and then interpolated
   * into "https://" + fullDomain + "/dashboard-api/..." — and URL parsing
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
        `Subdomain ${normalized} is not valid. Use a plain subdomain such as "dashboard" — schemes, ports, paths and "/" are not allowed.`,
      );
    }

    return normalized;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<DashboardDomain>,
  ): Promise<OnUpdate<DashboardDomain>> {
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
    createBy: CreateBy<DashboardDomain>,
  ): Promise<OnCreate<DashboardDomain>> {
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
    deleteBy: DeleteBy<DashboardDomain>,
  ): Promise<OnDelete<DashboardDomain>> {
    const domains: Array<DashboardDomain> = await this.findBy({
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
    onDelete: OnDelete<DashboardDomain>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<DashboardDomain>> {
    for (const domain of onDelete.carryForward) {
      await this.removeDomainFromGreenlock(domain.fullDomain as string);
    }

    return onDelete;
  }

  @CaptureSpan()
  public async removeDomainFromGreenlock(domain: string): Promise<void> {
    await GreenlockUtil.removeDomain(domain);
  }

  @CaptureSpan()
  public async orderCert(dashboardDomain: DashboardDomain): Promise<void> {
    return Telemetry.startActiveSpan<Promise<void>>({
      name: "DashboardDomainService.orderCert",
      options: {
        attributes: {
          fullDomain: dashboardDomain.fullDomain,
          _id: dashboardDomain.id?.toString(),
        },
      },
      fn: async (span: Span): Promise<void> => {
        try {
          if (!dashboardDomain.fullDomain) {
            const fetchedDashboardDomain: DashboardDomain | null =
              await this.findOneBy({
                query: {
                  _id: dashboardDomain.id!.toString(),
                },
                select: {
                  _id: true,
                  fullDomain: true,
                },
                props: {
                  isRoot: true,
                },
              });

            if (!fetchedDashboardDomain) {
              throw new BadDataException("DomainModel not found");
            }

            dashboardDomain = fetchedDashboardDomain;
          }

          if (!dashboardDomain.fullDomain) {
            throw new BadDataException(
              "Unable to order certificate because domain is null",
            );
          }

          logger.debug(
            "Ordering SSL for domain: " + dashboardDomain.fullDomain,
            { fullDomain: dashboardDomain.fullDomain } as LogAttributes,
          );

          await GreenlockUtil.orderCert({
            domain: dashboardDomain.fullDomain as string,
            validateCname: async (fullDomain: string) => {
              return await this.isCnameValid(fullDomain);
            },
          });

          logger.debug(
            "SSL ordered for domain: " + dashboardDomain.fullDomain,
            { fullDomain: dashboardDomain.fullDomain } as LogAttributes,
          );

          await this.updateOneById({
            id: dashboardDomain.id!,
            data: {
              isSslOrdered: true,
            },
            props: {
              isRoot: true,
            },
          });

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

    const dashboardDomain: DashboardDomain | null = await this.findOneBy({
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

    if (!dashboardDomain) {
      throw new BadDataException("Domain not found.");
    }

    if (!dashboardDomain.fullDomain) {
      throw new BadDataException(
        "Unable to reissue certificate because domain is null",
      );
    }

    /*
     * Nothing to reissue: the certificate on a custom-certificate domain is
     * the one the customer uploaded, and we have no way to obtain another.
     */
    if (dashboardDomain.isCustomCertificate) {
      throw new BadDataException(
        "This domain uses a certificate you uploaded yourself, so there is no Let's Encrypt certificate to reissue. Please edit this domain and upload a new certificate instead.",
      );
    }

    if (!dashboardDomain.isCnameVerified) {
      throw new BadDataException(
        "CNAME is not verified. Please verify CNAME first before you reissue the SSL certificate.",
      );
    }

    /*
     * A domain that never ordered a certificate has nothing to reissue - the
     * dashboard shows "Order Free SSL" for it, which is the correct button.
     */
    if (!dashboardDomain.isSslOrdered) {
      throw new BadDataException(
        "No SSL certificate has been ordered for this domain yet. Please order one first.",
      );
    }

    /*
     * Claim the cooldown before ordering anything, and claim it by putting the
     * cooldown condition in the WHERE clause rather than in an `if` above the
     * write. Two clicks that arrive together both read a row that is not
     * cooling down; only the write can decide which one of them gets to spend
     * the CA's allowance.
     *
     * The stamp goes down BEFORE the order and is never rolled back on
     * failure. A rejected order still costs a validation attempt against the
     * shared account, and a domain whose order fails is exactly the domain
     * somebody presses again - so a failed attempt has to start the clock the
     * same way a successful one does.
     */
    const claimedRowCount: number = await this.updateOneBy({
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

    if (claimedRowCount === 0) {
      if (dashboardDomain.certificateReissueRequestedAt) {
        throw new TooManyRequestsException(
          CertificateReissueUtil.getCooldownMessage(
            dashboardDomain.certificateReissueRequestedAt,
            now,
          ),
        );
      }

      /*
       * The row matched the cooldown a moment ago and does not now: another
       * request claimed it in between, or the domain was deleted. Either way
       * the caller must not order.
       */
      throw new BadDataException(
        "Could not start a certificate reissue for this domain. Please refresh the page and try again.",
      );
    }

    logger.debug(
      "Reissuing SSL certificate for domain: " + dashboardDomain.fullDomain,
      { fullDomain: dashboardDomain.fullDomain } as LogAttributes,
    );

    await this.orderCert(dashboardDomain);
  }

  @CaptureSpan()
  public async updateSslProvisioningStatusForAllDomains(): Promise<void> {
    const domains: Array<DashboardDomain> = await this.findBy({
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
      async (domain: DashboardDomain): Promise<void> => {
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
            "/dashboard-api/cname-verification/" +
            token,
          targetLabel: DASHBOARD_DOMAIN_EGRESS_LABEL,
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
  public async updateCnameStatusForDashboardDomain(data: {
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
      logger.debug("Checking for CNAME " + fullDomain, {
        fullDomain,
      } as LogAttributes);

      const dashboardDomain: DashboardDomain | null = await this.findOneBy({
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

      if (!dashboardDomain) {
        return false;
      }

      const token: string = dashboardDomain.cnameVerificationToken!;

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
              "/dashboard-api/cname-verification/" +
              token,
            targetLabel: DASHBOARD_DOMAIN_EGRESS_LABEL,
          });

        logger.debug("CNAME verification result", {
          fullDomain,
        } as LogAttributes);
        logger.debug(result, { fullDomain } as LogAttributes);

        if (result.isSuccess()) {
          await this.updateCnameStatusForDashboardDomain({
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
        const resultHttps: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await Domain.getForDomainVerification({
            url:
              "https://" +
              fullDomain +
              "/dashboard-api/cname-verification/" +
              token,
            targetLabel: DASHBOARD_DOMAIN_EGRESS_LABEL,
          });

        logger.debug("CNAME verification result for https", {
          fullDomain,
        } as LogAttributes);
        logger.debug(resultHttps, { fullDomain } as LogAttributes);

        if (resultHttps.isSuccess()) {
          await this.updateCnameStatusForDashboardDomain({
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
        if (DashboardCNameRecord) {
          const cnameRecords: Array<string> = await Domain.getCnameRecords({
            domain: fullDomain,
          });

          let cnameRecord: string | undefined = undefined;
          if (cnameRecords.length > 0) {
            cnameRecord = cnameRecords[0];
          }

          if (!cnameRecord) {
            logger.debug(
              `No CNAME record found for ${fullDomain}. Expected record: ${DashboardCNameRecord}`,
              { fullDomain } as LogAttributes,
            );
            await this.updateCnameStatusForDashboardDomain({
              domain: fullDomain,
              cnameStatus: false,
            });
            return false;
          }

          if (
            cnameRecord &&
            cnameRecord.trim().toLocaleLowerCase() ===
              DashboardCNameRecord.trim().toLocaleLowerCase()
          ) {
            logger.debug(
              `CNAME record for ${fullDomain} matches the expected record: ${DashboardCNameRecord}`,
              { fullDomain } as LogAttributes,
            );

            await this.updateCnameStatusForDashboardDomain({
              domain: fullDomain,
              cnameStatus: true,
            });

            return true;
          }

          logger.debug(
            `CNAME record for ${fullDomain} is ${cnameRecord} and it does not match the expected record: ${DashboardCNameRecord}`,
            { fullDomain } as LogAttributes,
          );
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain, {
          fullDomain,
        } as LogAttributes);
        logger.debug(err, { fullDomain } as LogAttributes);
      }

      await this.updateCnameStatusForDashboardDomain({
        domain: fullDomain,
        cnameStatus: false,
      });

      return false;
    } catch (err) {
      logger.debug("Failed checking for CNAME " + fullDomain);
      logger.debug(err);

      await this.updateCnameStatusForDashboardDomain({
        domain: fullDomain,
        cnameStatus: false,
      });

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
    domain: DashboardDomain,
  ): Promise<void> {
    if (!domain.id) {
      throw new BadDataException("DomainModel ID is required");
    }

    const dashboardDomain: DashboardDomain | null = await this.findOneBy({
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

    if (!dashboardDomain) {
      throw new BadDataException("DomainModel not found");
    }

    logger.debug(
      `DashboardCerts:CheckSslProvisioningStatus - Checking ${dashboardDomain.fullDomain}`,
      { fullDomain: dashboardDomain.fullDomain } as LogAttributes,
    );

    const isProvisioned: boolean = await this.isSSLProvisioned(
      dashboardDomain.fullDomain!,
      dashboardDomain.cnameVerificationToken!,
    );

    if (!isProvisioned) {
      // isCnameValid also records the result on the domain.
      await this.isCnameValid(dashboardDomain.fullDomain!);
    }

    if (Boolean(dashboardDomain.isSslProvisioned) !== isProvisioned) {
      await this.updateOneById({
        id: dashboardDomain.id!,
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
   * The certificate each of these domains has in AcmeCertificate, if any,
   * looked up a chunk at a time. Where a name has more than one row, the one
   * that expires last.
   */
  private async findCertificatesByDomain(
    domains: Array<string>,
  ): Promise<Map<string, AcmeCertificate>> {
    const certificates: Map<string, AcmeCertificate> = new Map<
      string,
      AcmeCertificate
    >();

    const uniqueDomains: Array<string> = Array.from(
      new Set<string>(
        domains.filter((domain: string) => {
          return domain.length > 0;
        }),
      ),
    );

    for (
      let offset: number = 0;
      offset < uniqueDomains.length;
      offset += GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE
    ) {
      const chunk: Array<string> = uniqueDomains.slice(
        offset,
        offset + GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE,
      );

      const rows: Array<AcmeCertificate> = await AcmeCertificateService.findBy({
        query: {
          domain: QueryHelper.any(chunk),
        },
        select: {
          domain: true,
          expiresAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        if (!row.domain) {
          continue;
        }

        const existing: AcmeCertificate | undefined = certificates.get(
          row.domain,
        );

        if (
          !existing ||
          (row.expiresAt &&
            (!existing.expiresAt ||
              OneUptimeDate.isAfter(row.expiresAt, existing.expiresAt)))
        ) {
          certificates.set(row.domain, row);
        }
      }
    }

    return certificates;
  }

  /*
   * Order the first certificate for domains whose CNAME is verified.
   *
   * Only verified domains: verifyCnameWhoseCnameisNotVerified checks the
   * rest, and ordering one whose record is not in place would only fail the
   * CNAME check again.
   *
   * A domain that still has a certificate with weeks to run is only recorded
   * as ordered. That is the domain whose CNAME check failed for a moment -
   * which marks it unordered - and then passed again; ordering for it would
   * spend an order on a duplicate (Let's Encrypt allows five a week per
   * name). The rest are ordered at most ORDER_MAX_PER_RUN per run, taking
   * turns (GreenlockUtil.takeThisRunsTurn), so a domain whose order keeps
   * failing cannot hold a slot the others are waiting for.
   */
  @CaptureSpan()
  public async orderSSLForDomainsWhichAreNotOrderedYet(): Promise<void> {
    return Telemetry.startActiveSpan<Promise<void>>({
      name: "DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet",
      options: { attributes: {} },
      fn: async (span: Span): Promise<void> => {
        try {
          const domains: Array<DashboardDomain> = await this.findBy({
            query: {
              isCnameVerified: true,
              isSslOrdered: false,
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

          const now: Date = OneUptimeDate.getCurrentDate();

          const certificates: Map<string, AcmeCertificate> =
            await this.findCertificatesByDomain(
              domains.map((domain: DashboardDomain) => {
                return domain.fullDomain || "";
              }),
            );

          const domainsToOrder: Array<DashboardDomain> = [];

          for (const domain of domains) {
            if (!domain.fullDomain) {
              continue;
            }

            const certificate: AcmeCertificate | undefined = certificates.get(
              domain.fullDomain,
            );

            if (
              certificate &&
              !GreenlockUtil.isDueForRenewal(certificate, now)
            ) {
              try {
                await this.updateOneById({
                  id: domain.id!,
                  data: {
                    isSslOrdered: true,
                  },
                  props: {
                    isRoot: true,
                  },
                });
              } catch (e) {
                logger.error(e, {
                  fullDomain: domain.fullDomain,
                } as LogAttributes);
              }

              continue;
            }

            domainsToOrder.push(domain);
          }

          const batch: Array<DashboardDomain> = GreenlockUtil.takeThisRunsTurn({
            items: domainsToOrder,
            max: Service.ORDER_MAX_PER_RUN,
            now: now,
            getKey: (domain: DashboardDomain): string => {
              return domain.fullDomain || "";
            },
          });

          for (const domain of batch) {
            try {
              logger.debug("Ordering SSL for domain: " + domain.fullDomain, {
                fullDomain: domain.fullDomain,
              } as LogAttributes);
              await this.orderCert(domain);
            } catch (e) {
              logger.error(e, {
                fullDomain: domain.fullDomain,
              } as LogAttributes);
            }
          }

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

  @CaptureSpan()
  public async verifyCnameWhoseCnameisNotVerified(): Promise<void> {
    const domains: Array<DashboardDomain> = await this.findBy({
      query: {
        isCnameVerified: false,
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
      async (domain: DashboardDomain): Promise<void> => {
        try {
          // isCnameValid also records the result on the domain.
          await this.isCnameValid(domain.fullDomain as string);
        } catch (e) {
          logger.error(e, { fullDomain: domain.fullDomain } as LogAttributes);
        }
      },
    );
  }

  /*
   * Which of these certificate domains are dashboard domains that use our
   * Let's Encrypt certificate. The renewal run renews - and removes - only
   * the certificates this returns, so the certificates of status page domains
   * and of the primary host, which share the AcmeCertificate table, are
   * never mistaken for dashboard domains whose CNAME stopped validating.
   *
   * A domain serving a certificate its owner uploaded does not claim the
   * Let's Encrypt certificate it may have from before the switch: nginx
   * serves the uploaded one for that name, so renewing the old one would
   * only spend orders. Left unclaimed, it expires and is cleaned up. The
   * test is the one nginx's WriteCustomCertsToDisk uses: the switch is on and
   * both the certificate and its key are there.
   */
  @CaptureSpan()
  public async getOwnedDomains(domains: Array<string>): Promise<Array<string>> {
    if (domains.length === 0) {
      return [];
    }

    const dashboardDomains: Array<DashboardDomain> = await this.findBy({
      query: {
        fullDomain: QueryHelper.any(domains),
      },
      select: {
        fullDomain: true,
        isCustomCertificate: true,
        customCertificate: true,
        customCertificateKey: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return dashboardDomains
      .filter((dashboardDomain: DashboardDomain) => {
        const servesUploadedCertificate: boolean = Boolean(
          dashboardDomain.isCustomCertificate &&
            dashboardDomain.customCertificate &&
            dashboardDomain.customCertificateKey,
        );

        return (
          Boolean(dashboardDomain.fullDomain) && !servesUploadedCertificate
        );
      })
      .map((dashboardDomain: DashboardDomain) => {
        return dashboardDomain.fullDomain as string;
      });
  }

  @CaptureSpan()
  public async renewCertsWhichAreExpiringSoon(): Promise<void> {
    await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
      maxPerRun: Service.ORDER_MAX_PER_RUN,
      getOwnedDomains: async (domains: Array<string>) => {
        return await this.getOwnedDomains(domains);
      },
      validateCname: async (fullDomain: string) => {
        return await this.isCnameValid(fullDomain);
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
   * This is how dashboard domains recover from the status page renewal job,
   * which until it learned to check ownership deleted every dashboard
   * certificate that came due for renewal while the domain kept saying
   * "ordered" - nginx then served the stale copy on disk until it expired.
   * Domains take turns, for the same reason as the first-order sweep above.
   */
  @CaptureSpan()
  public async checkOrderStatus(): Promise<void> {
    const domains: Array<DashboardDomain> = await this.findBy({
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

    const fullDomains: Array<string> = domains
      .map((domain: DashboardDomain) => {
        return domain.fullDomain || "";
      })
      .filter((fullDomain: string) => {
        return fullDomain.length > 0;
      });

    if (fullDomains.length === 0) {
      return;
    }

    const certificates: Map<string, AcmeCertificate> =
      await this.findCertificatesByDomain(fullDomains);

    const domainsWithoutCertificate: Array<DashboardDomain> = domains.filter(
      (domain: DashboardDomain) => {
        return (
          Boolean(domain.fullDomain) &&
          !certificates.has(domain.fullDomain as string)
        );
      },
    );

    const batch: Array<DashboardDomain> = GreenlockUtil.takeThisRunsTurn({
      items: domainsWithoutCertificate,
      max: Service.ORDER_MAX_PER_RUN,
      now: OneUptimeDate.getCurrentDate(),
      getKey: (domain: DashboardDomain): string => {
        return domain.fullDomain || "";
      },
    });

    for (const domain of batch) {
      try {
        await this.orderCert(domain);
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
