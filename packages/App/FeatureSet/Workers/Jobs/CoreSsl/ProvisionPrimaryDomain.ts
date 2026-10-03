import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import {
  Host,
  ProvisionSsl,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import Domain from "Common/Types/Domain";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import GreenlockUtil from "Common/Server/Utils/Greenlock/Greenlock";
import { CertificateOrderReason } from "Common/Server/Utils/Greenlock/CertificateOrderBudget";
import { CertificateOrderOutcome } from "Common/Server/Utils/Greenlock/CertificateOrderOutcome";
import OneUptimeDate from "Common/Types/Date";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";

const JOB_NAME: string = "CoreSSL:EnsurePrimaryHostCertificate";

RunCron(
  JOB_NAME,
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_DAY,
    runOnStartup: true,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  async () => {
    if (!ProvisionSsl) {
      logger.debug(`${JOB_NAME}: provisioning disabled. Skipping execution.`);
      return;
    }

    const normalizedHost: string = Host.trim().toLowerCase();
    const hostnameOnly: string = normalizedHost.split(":")[0] || "";

    if (!hostnameOnly) {
      logger.warn(
        `${JOB_NAME}: HOST environment variable is empty. Unable to provision SSL.`,
      );
      return;
    }

    if (!Domain.isValidDomain(hostnameOnly)) {
      logger.warn(
        `${JOB_NAME}: HOST "${hostnameOnly}" is not a valid domain. Skipping SSL provisioning.`,
      );
      return;
    }

    try {
      const existingCertificate: AcmeCertificate | null =
        await AcmeCertificateService.findOneBy({
          query: {
            domain: hostnameOnly,
          },
          select: {
            _id: true,
            expiresAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (existingCertificate?.expiresAt) {
        const renewalCheckDate: Date = OneUptimeDate.addRemoveDays(
          OneUptimeDate.getCurrentDate(),
          30,
        );

        if (existingCertificate.expiresAt > renewalCheckDate) {
          logger.debug(
            `${JOB_NAME}: existing certificate for ${hostnameOnly} is valid until ${existingCertificate.expiresAt.toISOString()}.`,
          );
          return;
        }
      }

      logger.debug(
        `${JOB_NAME}: ordering or renewing certificate for ${hostnameOnly}.`,
      );

      /*
       * The installation's own host: there is no CNAME to check. Like every
       * order, it takes the name's order lock and one unit of the
       * installation's Let's Encrypt budget, with a renewal's priority: the
       * installation's own certificate comes before new custom domains.
       */
      const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
        domain: hostnameOnly,
        reason: CertificateOrderReason.PrimaryHost,
        validateCname: null,
      });

      if (outcome === CertificateOrderOutcome.NotOrderedNow) {
        logger.debug(
          `${JOB_NAME}: another worker is ordering the certificate for ${hostnameOnly} right now.`,
        );
        return;
      }

      if (outcome === CertificateOrderOutcome.LimitReached) {
        logger.warn(
          `${JOB_NAME}: not ordering the certificate for ${hostnameOnly} now: this installation's Let's Encrypt orders for the next few minutes are used up. The next run orders it.`,
        );
        return;
      }

      logger.info(
        `${JOB_NAME}: certificate successfully issued or renewed for ${hostnameOnly}.`,
      );
    } catch (err) {
      logger.error(`${JOB_NAME}: failed to provision SSL for ${hostnameOnly}.`);
      logger.error(err);
      throw err;
    }
  },
);
