import {
  IsBillingEnabled,
  LetsEncryptAccountKey,
  LetsEncryptNotificationEmail,
} from "../../../Server/EnvironmentConfig";
import AcmeCertificateService from "../../Services/AcmeCertificateService";
import AcmeChallengeService from "../../Services/AcmeChallengeService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ServerException from "../../../Types/Exception/ServerException";
import Text from "../../../Types/Text";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import AcmeChallenge from "../../../Models/DatabaseModels/AcmeChallenge";
import acme from "acme-client";
import { Challenge } from "acme-client/types/rfc8555";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class GreenlockUtil {
  @CaptureSpan()
  public static async renewAllCertsWhichAreExpiringSoon(data: {
    validateCname: (domain: string) => Promise<boolean>;
    notifyDomainRemoved: (domain: string) => Promise<void>;
  }): Promise<void> {
    try {
      logger.debug("Renewing all certificates");

      // get all certificates which are expiring soon

      const certificates: AcmeCertificate[] =
        await AcmeCertificateService.findBy({
          query: {
            expiresAt: QueryHelper.lessThanEqualTo(
              OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                40, // 40 days before expiry
              ),
            ),
          },
          limit: LIMIT_MAX,
          skip: 0,
          select: {
            domain: true,
          },
          sort: {
            expiresAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

      logger.debug(
        `Found ${certificates.length} certificates which are expiring soon`,
      );

      // order certificate for each domain

      for (const certificate of certificates) {
        if (!certificate.domain) {
          continue;
        }

        logger.debug(`Renewing certificate for domain: ${certificate.domain}`);

        try {
          //validate cname
          const isValidCname: boolean = await data.validateCname(
            certificate.domain,
          );

          if (!isValidCname) {
            logger.debug(
              `CNAME is not valid for domain: ${certificate.domain}`,
            );

            // if cname is not valid then remove the domain
            await GreenlockUtil.removeDomain(certificate.domain);
            await data.notifyDomainRemoved(certificate.domain);

            logger.error(
              `Cname is not valid for domain: ${certificate.domain}`,
            );
          } else {
            logger.debug(`CNAME is valid for domain: ${certificate.domain}`);

            await GreenlockUtil.orderCert({
              domain: certificate.domain,
              validateCname: data.validateCname,
            });

            logger.debug(
              `Certificate renewed for domain: ${certificate.domain}`,
            );
          }
        } catch (e) {
          logger.error(
            `Error renewing certificate for domain: ${certificate.domain}`,
          );
          logger.error(e);
        }
      }
    } catch (e) {
      logger.error("Error renewing all certificates");
      logger.error(e);

      throw e;
    }
  }

  @CaptureSpan()
  public static async removeDomain(domain: string): Promise<void> {
    try {
      // remove certificate for this domain.
      await AcmeCertificateService.deleteBy({
        query: {
          domain: domain,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(`Error removing domain: ${domain}`);
      throw err;
    }
  }

  @CaptureSpan()
  public static async orderCert(data: {
    domain: string;
    validateCname: (domain: string) => Promise<boolean>;
  }): Promise<void> {
    try {
      logger.debug(
        `GreenlockUtil - Ordering certificate for domain: ${data.domain}`,
      );

      let { domain } = data;

      domain = domain.trim().toLowerCase();

      const acmeAccountKeyInBase64: string = LetsEncryptAccountKey;

      if (!acmeAccountKeyInBase64) {
        throw new ServerException(
          "No lets encrypt account key found in environment variables. Please add one.",
        );
      }

      let acmeAccountKey: string = Buffer.from(
        acmeAccountKeyInBase64,
        "base64",
      ).toString();

      acmeAccountKey = Text.replaceAll(acmeAccountKey, "\\n", "\n");

      //validate cname

      logger.debug(`Validating cname for domain: ${domain}`);

      const isValidCname: boolean = await data.validateCname(domain);

      if (!isValidCname) {
        logger.debug(`CNAME is not valid for domain: ${domain}`);
        logger.debug(`Removing domain: ${domain}`);

        await GreenlockUtil.removeDomain(domain);
        logger.error(`Cname is not valid for domain: ${domain}`);
        throw new BadDataException("Cname is not valid for domain " + domain);
      }

      logger.debug(`Cname is valid for domain: ${domain}`);

      const client: acme.Client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey: acmeAccountKey,
      });

      const [certificateKey, certificateRequest] = await acme.crypto.createCsr({
        commonName: domain,
      });

      logger.debug(`Ordering certificate for domain: ${domain}`);

      const certificate: string = await client.auto({
        csr: certificateRequest,
        email: LetsEncryptNotificationEmail.toString(),
        termsOfServiceAgreed: true,
        challengePriority: ["http-01"], // only http-01 challenge is supported by oneuptime
        challengeCreateFn: async (
          authz: acme.Authorization,
          challenge: Challenge,
          keyAuthorization: string,
        ) => {
          // Satisfy challenge here
          /* http-01 */
          if (challenge.type === "http-01") {
            logger.debug(
              `Creating challenge for domain: ${authz.identifier.value}`,
            );

            const acmeChallenge: AcmeChallenge = new AcmeChallenge();
            acmeChallenge.challenge = keyAuthorization;
            acmeChallenge.token = challenge.token;
            acmeChallenge.domain = authz.identifier.value;

            await AcmeChallengeService.create({
              data: acmeChallenge,
              props: {
                isRoot: true,
              },
            });

            logger.debug(
              `Challenge created for domain: ${authz.identifier.value}`,
            );
          }
        },
        challengeRemoveFn: async (
          authz: acme.Authorization,
          challenge: Challenge,
        ) => {
          // Clean up challenge here

          logger.debug(
            `Removing challenge for domain: ${authz.identifier.value}`,
          );

          if (challenge.type === "http-01") {
            await AcmeChallengeService.deleteBy({
              query: {
                domain: authz.identifier.value,
              },
              limit: 1,
              skip: 0,
              props: {
                isRoot: true,
              },
            });
          }

          logger.debug(
            `Challenge removed for domain: ${authz.identifier.value}`,
          );
        },
      });

      logger.debug(`Certificate ordered for domain: ${domain}`);

      // get expires at date from certificate
      const cert: acme.CertificateInfo =
        acme.crypto.readCertificateInfo(certificate);
      const issuedAt: Date = cert.notBefore;
      const expiresAt: Date = cert.notAfter;

      logger.debug(`Certificate expires at: ${expiresAt}`);
      logger.debug(`Certificate issued at: ${issuedAt}`);

      // check if the certificate is already in the database.
      const existingCertificate: AcmeCertificate | null =
        await AcmeCertificateService.findOneBy({
          query: {
            domain: domain,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (existingCertificate) {
        logger.debug(`Updating certificate for domain: ${domain}`);

        // update the certificate
        await AcmeCertificateService.updateBy({
          query: {
            domain: domain,
          },
          limit: 1,
          skip: 0,
          data: {
            certificate: certificate.toString(),
            certificateKey: certificateKey.toString(),
            issuedAt: issuedAt,
            expiresAt: expiresAt,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug(`Certificate updated for domain: ${domain}`);
      } else {
        logger.debug(`Creating certificate for domain: ${domain}`);
        // create the certificate
        const acmeCertificate: AcmeCertificate = new AcmeCertificate();

        acmeCertificate.domain = domain;
        acmeCertificate.certificate = certificate.toString();
        acmeCertificate.certificateKey = certificateKey.toString();
        acmeCertificate.issuedAt = issuedAt;
        acmeCertificate.expiresAt = expiresAt;

        await AcmeCertificateService.create({
          data: acmeCertificate,
          props: {
            isRoot: true,
          },
        });

        logger.debug(`Certificate created for domain: ${domain}`);
      }
    } catch (e) {
      logger.error(`Error ordering certificate for domain: ${data.domain}`);

      if (e instanceof Exception) {
        throw e;
      }

      if (IsBillingEnabled) {
        throw new ServerException(
          `Unable to order certificate for ${data.domain}. Please contact support at support@oneuptime.com for more information.`,
        );
      } else {
        throw new ServerException(
          `Unable to order certificate for ${data.domain}. Please make sure that your server can be accessed publicly over port 80 (HTTP) and port 443 (HTTPS). If the problem persists, please refer to server logs for more information. Please also set up LOG_LEVEL=DEBUG to get more detailed server logs.`,
        );
      }
    }
  }
}
