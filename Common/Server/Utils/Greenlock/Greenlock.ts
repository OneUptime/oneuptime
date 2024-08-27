import {
  LetsEncryptAccountKey,
  LetsEncryptNotificationEmail,
} from "../../../Server/EnvironmentConfig";
import AcmeCertificateService from "../../Services/AcmeCertificateService";
import AcmeChallengeService from "../../Services/AcmeChallengeService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import Text from "Common/Types/Text";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";
import AcmeChallenge from "Common/Models/DatabaseModels/AcmeChallenge";
import acme from "acme-client";
import { Challenge } from "acme-client/types/rfc8555";
import Telemetry, { Span } from "../Telemetry";

export default class GreenlockUtil {
  public static async renewAllCertsWhichAreExpiringSoon(data: {
    validateCname: (domain: string) => Promise<boolean>;
    notifyDomainRemoved: (domain: string) => Promise<void>;
  }): Promise<void> {
    logger.debug("Renewing all certificates");

    // get all certificates which are expiring soon

    const certificates: AcmeCertificate[] = await AcmeCertificateService.findBy(
      {
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
      },
    );

    // order certificate for each domain

    for (const certificate of certificates) {
      if (!certificate.domain) {
        continue;
      }

      try {
        //validate cname
        const isValidCname: boolean = await data.validateCname(
          certificate.domain,
        );

        if (!isValidCname) {
          // if cname is not valid then remove the domain
          await GreenlockUtil.removeDomain(certificate.domain);
          await data.notifyDomainRemoved(certificate.domain);
        } else {
          await GreenlockUtil.orderCert({
            domain: certificate.domain,
            validateCname: data.validateCname,
          });
        }
      } catch (e) {
        logger.error(
          `Error renewing certificate for domain: ${certificate.domain}`,
        );
        logger.error(e);
      }
    }
  }

  public static async removeDomain(domain: string): Promise<void> {
    const span: Span = Telemetry.startSpan({
      name: "GreenlockUtil.removeDomain",
      attributes: {
        domain: domain,
      },
    });

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

      Telemetry.endSpan(span);
    } catch (err) {
      logger.error(`Error removing domain: ${domain}`);

      Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
        span,
        exception: err,
      });

      throw err;
    }
  }

  public static async orderCert(data: {
    domain: string;
    validateCname: (domain: string) => Promise<boolean>;
  }): Promise<void> {
    const span: Span = Telemetry.startSpan({
      name: "GreenlockUtil.orderCert",
      attributes: {
        domain: data.domain,
      },
    });

    try {
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

      const isValidCname: boolean = await data.validateCname(domain);

      if (!isValidCname) {
        await GreenlockUtil.removeDomain(domain);
        logger.error(`Cname is not valid for domain: ${domain}`);
        throw new BadDataException("Cname is not valid for domain " + domain);
      }

      const client: acme.Client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey: acmeAccountKey,
      });

      const [certificateKey, certificateRequest] = await acme.crypto.createCsr({
        commonName: domain,
      });

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
          }
        },
        challengeRemoveFn: async (
          authz: acme.Authorization,
          challenge: Challenge,
        ) => {
          // Clean up challenge here

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
        },
      });

      // get expires at date from certificate
      const cert: acme.CertificateInfo =
        acme.crypto.readCertificateInfo(certificate);
      const issuedAt: Date = cert.notBefore;
      const expiresAt: Date = cert.notAfter;

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
      } else {
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
      }

      Telemetry.endSpan(span);
    } catch (e) {
      logger.error(`Error ordering certificate for domain: ${data.domain}`);

      Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
        span,
        exception: e,
      });

      if (e instanceof Exception) {
        throw e;
      }

      throw new ServerException(
        `Unable to order certificate for ${data.domain}. Please contact support at support@oneuptime.com for more information.`,
      );
    }
  }
}
