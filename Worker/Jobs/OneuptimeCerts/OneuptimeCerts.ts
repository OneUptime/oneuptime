import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import {
  EnableSslProvisioningForOneuptime,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import OneuptimeSslCertificateService from "Common/Server/Services/OneuptimeSslCertificateService";
import logger from "Common/Server/Utils/Logger";

RunCron(
  "OneuptimeCerts:EnsureProvisioned",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_DAY,
    runOnStartup: true,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  async () => {
    if (!EnableSslProvisioningForOneuptime) {
      logger.debug(
        "ENABLE_SSL_PROVIONING_FOR_ONEUPTIME is disabled. Skipping OneUptime certificate provisioning run.",
      );
      return;
    }

    await OneuptimeSslCertificateService.ensureCertificateProvisioned();
  },
);
