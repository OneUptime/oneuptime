import {
  IsBillingEnabled,
  LetsEncryptAccountKey,
  LetsEncryptNotificationEmail,
} from "../../../Server/EnvironmentConfig";
import AcmeCertificateService from "../../Services/AcmeCertificateService";
import AcmeChallengeService from "../../Services/AcmeChallengeService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ServerException from "../../../Types/Exception/ServerException";
import Text from "../../../Types/Text";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import AcmeChallenge from "../../../Models/DatabaseModels/AcmeChallenge";
import ArrayUtil from "../../../Utils/Array";
import acme from "acme-client";
import { Challenge } from "acme-client/types/rfc8555";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class GreenlockUtil {
  /*
   * How early a certificate is renewed, as a range rather than a single value.
   *
   * Let's Encrypt issues for 90 days, so every domain ordered on the same day
   * expires on the same day. Renewing them all at one fixed lead time keeps
   * that batch together for every cycle that follows, and a single bad day -
   * an upstream outage, a rate limit, a run that does not finish - then expires
   * the whole batch at once instead of one domain.
   *
   * Spreading the lead time across a range pulls the batch apart: domains that
   * expire on the same day come due days apart, and having been renewed days
   * apart they expire days apart next cycle too. The offset is derived from the
   * domain name so it is stable - a domain must not drift in and out of
   * eligibility between two runs, which would leave it renewed by neither.
   */
  public static readonly RENEW_LEAD_TIME_MAX_IN_DAYS: number = 40;
  public static readonly RENEW_LEAD_TIME_MIN_IN_DAYS: number = 25;

  /*
   * A run renews at most this many domains, at most this many at a time.
   *
   * Both bound how much of a backlog is dispatched at once. Let's Encrypt
   * allows 300 new orders per account per three hours, and the reactive
   * provisioning sweep spends from the same allowance, so a run that tried to
   * clear a large backlog in one pass would spend the account's budget and get
   * the renewals behind it refused. At the schedule this job runs on the cap
   * still clears far more per day than one sequential daily pass ever did,
   * while leaving room under the limit.
   */
  public static readonly RENEW_MAX_PER_RUN: number = 10;
  public static readonly RENEW_CONCURRENCY: number = 5;

  /*
   * Stable per-domain lead time, somewhere in the range above. Same domain,
   * same answer, on every run and every replica.
   */
  public static getRenewalLeadTimeInDays(domain: string): number {
    const spanInDays: number =
      GreenlockUtil.RENEW_LEAD_TIME_MAX_IN_DAYS -
      GreenlockUtil.RENEW_LEAD_TIME_MIN_IN_DAYS;

    let hash: number = 0;

    for (let i: number = 0; i < domain.length; i++) {
      hash = (hash * 31 + domain.charCodeAt(i)) % 1000003;
    }

    return (
      GreenlockUtil.RENEW_LEAD_TIME_MIN_IN_DAYS + (hash % (spanInDays + 1))
    );
  }

  @CaptureSpan()
  public static async renewAllCertsWhichAreExpiringSoon(data: {
    validateCname: (domain: string) => Promise<boolean>;
    notifyDomainRemoved: (domain: string) => Promise<void>;
  }): Promise<void> {
    try {
      logger.debug("Renewing all certificates");

      /*
       * Read the widest window any domain's lead time can make it due in, then
       * keep only the domains whose own lead time has actually been reached.
       */
      const certificates: AcmeCertificate[] =
        await AcmeCertificateService.findBy({
          query: {
            expiresAt: QueryHelper.lessThanEqualTo(
              OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                GreenlockUtil.RENEW_LEAD_TIME_MAX_IN_DAYS,
              ),
            ),
          },
          limit: LIMIT_MAX,
          skip: 0,
          select: {
            domain: true,
            expiresAt: true,
          },
          sort: {
            expiresAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

      const now: Date = OneUptimeDate.getCurrentDate();

      const dueCertificates: AcmeCertificate[] = certificates.filter(
        (certificate: AcmeCertificate) => {
          if (!certificate.domain || !certificate.expiresAt) {
            return false;
          }

          const renewAt: Date = OneUptimeDate.addRemoveDays(
            certificate.expiresAt,
            -GreenlockUtil.getRenewalLeadTimeInDays(certificate.domain),
          );

          return !OneUptimeDate.isAfter(renewAt, now);
        },
      );

      /*
       * Still sorted by expiry, so a run that cannot take the whole backlog
       * spends itself on the domains closest to expiring and leaves the rest -
       * which by construction still have weeks of lead time - to the next run.
       */
      const batch: AcmeCertificate[] = dueCertificates.slice(
        0,
        GreenlockUtil.RENEW_MAX_PER_RUN,
      );

      logger.debug(
        `Found ${dueCertificates.length} certificates due for renewal, renewing ${batch.length} in this run`,
        {
          dueCount: dueCertificates.length,
          batchCount: batch.length,
        },
      );

      await ArrayUtil.forEachWithConcurrency(
        batch,
        GreenlockUtil.RENEW_CONCURRENCY,
        async (certificate: AcmeCertificate): Promise<void> => {
          await GreenlockUtil.renewCertForDomain({
            domain: certificate.domain as string,
            validateCname: data.validateCname,
            notifyDomainRemoved: data.notifyDomainRemoved,
          });
        },
      );
    } catch (e) {
      logger.error("Error renewing all certificates");
      logger.error(e);

      throw e;
    }
  }

  /*
   * Renew one domain. Never throws: one domain that cannot be renewed - a CNAME
   * that no longer points here, a challenge the CA would not accept - must not
   * take down the rest of the run with it.
   */
  private static async renewCertForDomain(data: {
    domain: string;
    validateCname: (domain: string) => Promise<boolean>;
    notifyDomainRemoved: (domain: string) => Promise<void>;
  }): Promise<void> {
    const { domain } = data;

    const certLogAttributes: LogAttributes = {
      domain: domain,
    };

    logger.debug(
      `Renewing certificate for domain: ${domain}`,
      certLogAttributes,
    );

    try {
      //validate cname
      const isValidCname: boolean = await data.validateCname(domain);

      if (!isValidCname) {
        logger.debug(
          `CNAME is not valid for domain: ${domain}`,
          certLogAttributes,
        );

        // if cname is not valid then remove the domain
        await GreenlockUtil.removeDomain(domain);
        await data.notifyDomainRemoved(domain);

        logger.error(
          `Cname is not valid for domain: ${domain}`,
          certLogAttributes,
        );
      } else {
        logger.debug(`CNAME is valid for domain: ${domain}`, certLogAttributes);

        await GreenlockUtil.orderCert({
          domain: domain,
          validateCname: data.validateCname,
        });

        logger.debug(
          `Certificate renewed for domain: ${domain}`,
          certLogAttributes,
        );
      }
    } catch (e) {
      logger.error(
        `Error renewing certificate for domain: ${domain}`,
        certLogAttributes,
      );
      logger.error(e, certLogAttributes);
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
      logger.error(`Error removing domain: ${domain}`, { domain });
      throw err;
    }
  }

  @CaptureSpan()
  public static async orderCert(data: {
    domain: string;
    validateCname: (domain: string) => Promise<boolean>;
  }): Promise<void> {
    const orderLogAttributes: LogAttributes = {
      domain: data.domain,
    };

    try {
      logger.debug(
        `GreenlockUtil - Ordering certificate for domain: ${data.domain}`,
        orderLogAttributes,
      );

      let { domain } = data;

      domain = domain.trim().toLowerCase();
      orderLogAttributes["domain"] = domain;

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

      logger.debug(
        `Validating cname for domain: ${domain}`,
        orderLogAttributes,
      );

      const isValidCname: boolean = await data.validateCname(domain);

      if (!isValidCname) {
        logger.debug(
          `CNAME is not valid for domain: ${domain}`,
          orderLogAttributes,
        );
        logger.debug(`Removing domain: ${domain}`, orderLogAttributes);

        await GreenlockUtil.removeDomain(domain);
        logger.error(
          `Cname is not valid for domain: ${domain}`,
          orderLogAttributes,
        );
        throw new BadDataException("Cname is not valid for domain " + domain);
      }

      logger.debug(`Cname is valid for domain: ${domain}`, orderLogAttributes);

      const client: acme.Client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey: acmeAccountKey,
      });

      const [certificateKey, certificateRequest] = await acme.crypto.createCsr({
        commonName: domain,
      });

      logger.debug(
        `Ordering certificate for domain: ${domain}`,
        orderLogAttributes,
      );

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
              orderLogAttributes,
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
              orderLogAttributes,
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
            orderLogAttributes,
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
            orderLogAttributes,
          );
        },
      });

      logger.debug(
        `Certificate ordered for domain: ${domain}`,
        orderLogAttributes,
      );

      // get expires at date from certificate
      const cert: acme.CertificateInfo =
        acme.crypto.readCertificateInfo(certificate);
      const issuedAt: Date = cert.notBefore;
      const expiresAt: Date = cert.notAfter;

      logger.debug(`Certificate expires at: ${expiresAt}`, orderLogAttributes);
      logger.debug(`Certificate issued at: ${issuedAt}`, orderLogAttributes);

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
        logger.debug(
          `Updating certificate for domain: ${domain}`,
          orderLogAttributes,
        );

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

        logger.debug(
          `Certificate updated for domain: ${domain}`,
          orderLogAttributes,
        );
      } else {
        logger.debug(
          `Creating certificate for domain: ${domain}`,
          orderLogAttributes,
        );
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

        logger.debug(
          `Certificate created for domain: ${domain}`,
          orderLogAttributes,
        );
      }
    } catch (e) {
      logger.error(
        `Error ordering certificate for domain: ${data.domain}`,
        orderLogAttributes,
      );
      logger.error(e, orderLogAttributes);

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
