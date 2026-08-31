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
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import AcmeCertificateService from "./AcmeCertificateService";
import Telemetry, { Span } from "../Utils/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { StatusPageCNameRecord } from "../EnvironmentConfig";
import Domain from "../Types/Domain";
import ArrayUtil from "../../Utils/Array";
import OneUptimeDate from "../../Types/Date";
import CertificateReissueUtil from "../../Utils/CertificateReissue";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import QueryHelper from "../Types/Database/QueryHelper";

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

  @CaptureSpan()
  public async orderCert(statusPageDomain: StatusPageDomain): Promise<void> {
    return Telemetry.startActiveSpan<Promise<void>>({
      name: "StatusPageDomainService.orderCert",
      options: {
        attributes: {
          fullDomain: statusPageDomain.fullDomain,
          _id: statusPageDomain.id?.toString(),
        },
      },
      fn: async (span: Span): Promise<void> => {
        try {
          if (!statusPageDomain.fullDomain) {
            const fetchedStatusPageDomain: StatusPageDomain | null =
              await this.findOneBy({
                query: {
                  _id: statusPageDomain.id!.toString(),
                },
                select: {
                  _id: true,
                  fullDomain: true,
                },
                props: {
                  isRoot: true,
                },
              });

            if (!fetchedStatusPageDomain) {
              throw new BadDataException("DomainModel not found");
            }

            statusPageDomain = fetchedStatusPageDomain;
          }

          if (!statusPageDomain.fullDomain) {
            throw new BadDataException(
              "Unable to order certificate because domain is null",
            );
          }

          logger.debug(
            "Ordering SSL for domain: " + statusPageDomain.fullDomain,
            { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
          );

          await GreenlockUtil.orderCert({
            domain: statusPageDomain.fullDomain as string,
            validateCname: async (fullDomain: string) => {
              return await this.isCnameValid(fullDomain);
            },
          });

          logger.debug(
            "SSL ordered for domain: " + statusPageDomain.fullDomain,
            { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
          );

          // update the order.
          await this.updateOneById({
            id: statusPageDomain.id!,
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
     * A domain that never ordered a certificate has nothing to reissue - the
     * dashboard shows "Order Free SSL" for it, which is the correct button.
     */
    if (!statusPageDomain.isSslOrdered) {
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
      if (statusPageDomain.certificateReissueRequestedAt) {
        throw new TooManyRequestsException(
          CertificateReissueUtil.getCooldownMessage(
            statusPageDomain.certificateReissueRequestedAt,
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
      "Reissuing SSL certificate for domain: " + statusPageDomain.fullDomain,
      { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
    );

    await this.orderCert(statusPageDomain);
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
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPageDomain) {
      throw new BadDataException("DomainModel not found");
    }

    logger.debug(
      `StatusPageCerts:RemoveCerts - Checking CNAME ${statusPageDomain.fullDomain}`,
      { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
    );

    // Check CNAME validation and if that fails. Remove certs from Greenlock.
    const isValid: boolean = await this.isSSLProvisioned(
      statusPageDomain.fullDomain!,
      statusPageDomain.cnameVerificationToken!,
    );

    if (!isValid) {
      // check if cname is valid.

      const isCnameValid: boolean = await this.isCnameValid(
        statusPageDomain.fullDomain!,
      );

      await this.updateOneById({
        id: statusPageDomain.id!,
        data: {
          isSslProvisioned: false,
        },
        props: {
          isRoot: true,
        },
      });

      if (isCnameValid) {
        try {
          // if cname is valid then order cert again.
          await this.orderCert(statusPageDomain);
        } catch (err) {
          logger.error(
            "Cannot order cert for domain: " + statusPageDomain.fullDomain,
            { fullDomain: statusPageDomain.fullDomain } as LogAttributes,
          );
          logger.error(err, {
            fullDomain: statusPageDomain.fullDomain,
          } as LogAttributes);
        }
      }
    } else {
      await this.updateOneById({
        id: statusPageDomain.id!,
        data: {
          isSslProvisioned: true,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async orderSSLForDomainsWhichAreNotOrderedYet(): Promise<void> {
    return Telemetry.startActiveSpan<Promise<void>>({
      name: "StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet",
      options: { attributes: {} },
      fn: async (span: Span): Promise<void> => {
        try {
          const domains: Array<StatusPageDomain> = await this.findBy({
            query: {
              isSslOrdered: false,
              isCustomCertificate: false, // only order for non custom certificates.
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

          for (const domain of domains) {
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
    const domains: Array<StatusPageDomain> = await this.findBy({
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

    for (const domain of domains) {
      try {
        await this.isCnameValid(domain.fullDomain as string); // this will also upate the status.
      } catch (e) {
        logger.error(e, {
          fullDomain: domain.fullDomain as string,
        } as LogAttributes);
      }
    }
  }

  @CaptureSpan()
  public async renewCertsWhichAreExpiringSoon(): Promise<void> {
    await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
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

  @CaptureSpan()
  public async checkOrderStatus(): Promise<void> {
    const domains: Array<StatusPageDomain> = await this.findBy({
      query: {
        isSslOrdered: true,
        isCustomCertificate: false,
      },
      select: {
        _id: true,
        fullDomain: true,
        cnameVerificationToken: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const domain of domains) {
      if (!domain.fullDomain) {
        continue;
      }

      //check if cert exists in AcmeCertificate.
      const acmeCert: AcmeCertificate | null =
        await AcmeCertificateService.findOneBy({
          query: {
            domain: domain.fullDomain,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!acmeCert) {
        try {
          // order cert again.
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
}
export default new Service();
