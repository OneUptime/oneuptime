import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import HostService from "Common/Server/Services/HostService";

/*
 * Host:CleanupStaleHosts
 *
 * Runs every 5 minutes. Single responsibility: flip a Host's
 * otelCollectorStatus to "disconnected" once its lastSeenAt is older
 * than the staleness threshold. Discovery and last-seen pings happen
 * inline on the ingest path; we only need a sweeper to handle the
 * "no telemetry has arrived recently" case.
 */
RunCron(
  "Host:CleanupStaleHosts",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      await HostService.markDisconnectedHosts();
    } catch (err) {
      logger.error(
        `Host:CleanupStaleHosts cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
