import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import GreenlockUtil from "Common/Server/Utils/Greenlock/Greenlock";
import CertificateOwners from "Common/Server/Utils/Greenlock/CertificateOwners";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

/*
 * Deletes certificates that expired more than a month ago and that no status
 * page domain, dashboard domain or the primary host claims.
 *
 * Each owner's renewal run touches only its own certificates, so nothing
 * else ever removes one whose owner is gone - a project, status page,
 * dashboard or parent domain deleted through the database's ON DELETE
 * CASCADE skips the hook that would have removed it. (Before the renewal runs
 * checked ownership, the status page run deleted such leftovers as a side
 * effect of deleting everybody else's certificates too.) An expired
 * certificate serves nobody, so this can never take a working domain down.
 */
RunCron(
  "Certificates:RemoveExpiredUnownedCertificates",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  async () => {
    const removedCount: number =
      await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
        owners: CertificateOwners.getAll(),
      });

    logger.debug(
      `Certificates:RemoveExpiredUnownedCertificates - removed ${removedCount} certificates nobody owns`,
      { service: "workers" },
    );
  },
);
