import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import logger from "Common/Server/Utils/Logger";
import Telemetry, { Span } from "Common/Server/Utils/Telemetry";
import OneUptimeDate from "Common/Types/Date";

/*
 * Renewal runs on the same fifteen minute cadence as the rest of this file, not
 * once a day.
 *
 * A daily run renews at most one run's worth of domains per day. Once the fleet
 * grew past that, the backlog stopped draining: every day the run spent itself
 * on the domains already at the edge of expiry and never reached the ones
 * behind them, so certificates were effectively renewed only once they had
 * already expired and the provisioning sweep noticed the status page was
 * serving a dead certificate. Renewing on a short cycle, with each run taking a
 * bounded batch, keeps the queue drained and puts renewal back ahead of expiry.
 */
RunCron(
  "StatusPageCerts:RenewCerts",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  async () => {
    logger.debug("Renewing Certs...", { service: "workers" });
    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
    logger.debug("Renew Completed...", { service: "workers" });
  },
);

RunCron(
  "StatusPageCerts:CheckSslProvisioningStatus",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // Checking provisioning status may require multiple external API calls (DNS + CA) and can exceed default 5m.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  async () => {
    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();
  },
);

RunCron(
  "StatusPageCerts:OrderSSL",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // Ordering SSL can involve domain validation challenges and upstream rate limits; allow more time.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  async () => {
    return await Telemetry.startActiveSpan<Promise<void>>({
      name: "StatusPageCerts.OrderSSL",
      options: {
        attributes: {
          schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
          runOnStartup: false,
          timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
        },
      },
      fn: async (span: Span): Promise<void> => {
        try {
          logger.debug("Ordering SSL for domains which are not ordered yet", {
            service: "workers",
          });

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
    runOnStartup: false,
  },
  async () => {
    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();
  },
);

RunCron(
  "StatusPageCerts:CheckOrderStatus",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // checks if the certificate exists for the domains that have ordered certificates, otherwise orders again,
    await StatusPageDomainService.checkOrderStatus();
  },
);
