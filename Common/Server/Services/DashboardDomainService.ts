import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import GreenlockUtil from "../Utils/Greenlock/Greenlock";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import DomainService from "./DomainService";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import API from "../../Utils/API";
import AcmeCertificate from "../../Models/DatabaseModels/AcmeCertificate";
import DomainModel from "../../Models/DatabaseModels/Domain";
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import AcmeCertificateService from "./AcmeCertificateService";
import Telemetry, { Span } from "../Utils/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DashboardCNameRecord } from "../EnvironmentConfig";
import Domain from "../Types/Domain";

export class Service extends DatabaseService<DashboardDomain> {
  public constructor() {
    super(DashboardDomain);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<DashboardDomain>,
  ): Promise<OnCreate<DashboardDomain>> {
    const domain: DomainModel | null = await DomainService.findOneBy({
      query: {
        _id:
          createBy.data.domainId?.toString() ||
          createBy.data.domain?._id ||
          "",
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

    let normalizedSubdomain: string =
      createBy.data.subdomain?.trim().toLowerCase() || "";

    if (normalizedSubdomain === "@") {
      normalizedSubdomain = "";
    }

    createBy.data.subdomain = normalizedSubdomain;

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
          );

          await GreenlockUtil.orderCert({
            domain: dashboardDomain.fullDomain as string,
            validateCname: async (fullDomain: string) => {
              return await this.isCnameValid(fullDomain);
            },
          });

          logger.debug(
            "SSL ordered for domain: " + dashboardDomain.fullDomain,
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

  @CaptureSpan()
  public async updateSslProvisioningStatusForAllDomains(): Promise<void> {
    const domains: Array<DashboardDomain> = await this.findBy({
      query: {
        isSslOrdered: true,
        isCustomCertificate: false,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const domain of domains) {
      await this.updateSslProvisioningStatus(domain);
    }
  }

  private async isSSLProvisioned(
    fulldomain: string,
    token: string,
  ): Promise<boolean> {
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(
            "https://" +
              fulldomain +
              "/dashboard-api/cname-verification/" +
              token,
          ),
        });

      if (result.isFailure()) {
        return false;
      }

      return true;
    } catch (err) {
      logger.error(err);
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
      logger.debug("Checking for CNAME " + fullDomain);

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
      );

      try {
        const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(
              "http://" +
                fullDomain +
                "/dashboard-api/cname-verification/" +
                token,
            ),
          });

        logger.debug("CNAME verification result");
        logger.debug(result);

        if (result.isSuccess()) {
          await this.updateCnameStatusForDashboardDomain({
            domain: fullDomain,
            cnameStatus: true,
          });

          return true;
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain);
        logger.debug(err);
      }

      try {
        const resultHttps: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(
              "https://" +
                fullDomain +
                "/dashboard-api/cname-verification/" +
                token,
            ),
          });

        logger.debug("CNAME verification result for https");
        logger.debug(resultHttps);

        if (resultHttps.isSuccess()) {
          await this.updateCnameStatusForDashboardDomain({
            domain: fullDomain,
            cnameStatus: true,
          });

          return true;
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain);
        logger.debug(err);
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
            );

            await this.updateCnameStatusForDashboardDomain({
              domain: fullDomain,
              cnameStatus: true,
            });

            return true;
          }

          logger.debug(
            `CNAME record for ${fullDomain} is ${cnameRecord} and it does not match the expected record: ${DashboardCNameRecord}`,
          );
        }
      } catch (err) {
        logger.debug("Failed checking for CNAME " + fullDomain);
        logger.debug(err);
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
      },
      props: {
        isRoot: true,
      },
    });

    if (!dashboardDomain) {
      throw new BadDataException("DomainModel not found");
    }

    logger.debug(
      `DashboardCerts:RemoveCerts - Checking CNAME ${dashboardDomain.fullDomain}`,
    );

    const isValid: boolean = await this.isSSLProvisioned(
      dashboardDomain.fullDomain!,
      dashboardDomain.cnameVerificationToken!,
    );

    if (!isValid) {
      const isCnameValid: boolean = await this.isCnameValid(
        dashboardDomain.fullDomain!,
      );

      await this.updateOneById({
        id: dashboardDomain.id!,
        data: {
          isSslProvisioned: false,
        },
        props: {
          isRoot: true,
        },
      });

      if (isCnameValid) {
        try {
          await this.orderCert(dashboardDomain);
        } catch (err) {
          logger.error(
            "Cannot order cert for domain: " + dashboardDomain.fullDomain,
          );
          logger.error(err);
        }
      }
    } else {
      await this.updateOneById({
        id: dashboardDomain.id!,
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
      name: "DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet",
      options: { attributes: {} },
      fn: async (span: Span): Promise<void> => {
        try {
          const domains: Array<DashboardDomain> = await this.findBy({
            query: {
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

          for (const domain of domains) {
            try {
              logger.debug("Ordering SSL for domain: " + domain.fullDomain);
              await this.orderCert(domain);
            } catch (e) {
              logger.error(e);
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

    for (const domain of domains) {
      try {
        await this.isCnameValid(domain.fullDomain as string);
      } catch (e) {
        logger.error(e);
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

        logger.debug(`DomainModel removed from greenlock: ${domain}`);
      },
    });
  }

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
          await this.orderCert(domain);
        } catch (err) {
          logger.error(
            "Cannot order cert for domain: " + domain.fullDomain,
          );
          logger.error(err);
        }
      }
    }
  }
}
export default new Service();
