import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import logger from "Common/Server/Utils/Logger";
import Telemetry, { Span } from "Common/Server/Utils/Telemetry";
import OneUptimeDate from "Common/Types/Date";

RunCron(
  "StatusPageCerts:RenewCerts",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_DAY,
    runOnStartup: true,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  async () => {
    logger.debug("Renewing Certs...");
    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
    logger.debug("Renew Completed...");
  },
);

RunCron(
  "StatusPageCerts:CheckSslProvisioningStatus",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
  },
  async () => {
    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();
  },
);

RunCron(
  "StatusPageCerts:OrderSSL",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
  },
  async () => {
    return await Telemetry.startActiveSpan<Promise<void>>({
      name: "StatusPageCerts:OrderSSL",
      options: {
        attributes: {
          schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
          runOnStartup: true,
          timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
        },
      },
      fn: async (span: Span): Promise<void> => {
        try {
          logger.debug("Ordering SSL for domains which are not ordered yet");

          await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();
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
  },
);

RunCron(
  "StatusPageCerts:VerifyCnameWhoseCnameisNotVerified",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
  },
  async () => {
    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();
  },
);

RunCron(
  "StatusPageCerts:CheckOrderStatus",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
  },
  async () => {
    // checks if the certificate exists for the domains that have ordered certificates, otherwise orders again,
    await StatusPageDomainService.checkOrderStatus();
  },
);
