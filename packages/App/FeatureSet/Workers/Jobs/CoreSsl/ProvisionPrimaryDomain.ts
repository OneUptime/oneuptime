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

      await GreenlockUtil.orderCert({
        domain: hostnameOnly,
        validateCname: async () => {
          return true;
        },
      });

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
