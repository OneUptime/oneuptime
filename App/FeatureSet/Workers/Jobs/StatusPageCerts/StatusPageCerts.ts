import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import logger from "Common/Server/Utils/Logger";
import Telemetry, { Span } from "Common/Server/Utils/Telemetry";

RunCron(
  "StatusPageCerts:RenewCerts",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_DAY,
    runOnStartup: true,
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
  },
  async () => {
    const span: Span = Telemetry.startSpan({
      name: "StatusPageCerts:OrderSSL",
      attributes: {
        jobName: "StatusPageCerts:OrderSSL",
      },
    });

    try {
      await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

      Telemetry.endSpan(span);
    } catch (err) {
      logger.error(err);

      Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
        span,
        exception: err,
      });

      throw err;
    }
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
