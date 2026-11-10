import RunCron from "../../Utils/Cron";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import DiscoveredDeviceAgeOut, {
  AGE_OUT_TIME_BUDGET_MS,
  DiscoveredDeviceAgeOutSummary,
} from "Common/Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut";
import logger from "Common/Server/Utils/Logger";

/*
 * Removes discovered devices nothing has seen for as long as their project
 * keeps them (Network > Topology > Discovered Devices > More settings >
 * Unseen Devices, 30 days unless changed; issue #6389). Monitored and
 * classified devices, ones a person added or changed, and ones whose switch
 * has gone quiet stay: see DiscoveredDeviceAgeOut for what is removed, how,
 * and why.
 *
 * Hourly, a bounded amount of work a run: a project with a long backlog -
 * the first run after an upgrade, on a network that saw thousands of guest
 * devices - drains over a few runs. The timeout leaves the last statement
 * room to finish after the runner's own budget is spent.
 */
RunCron(
  "NetworkDeviceDiscovery:AgeOutDiscoveredDevices",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: AGE_OUT_TIME_BUDGET_MS + 2 * 60 * 1000,
  },
  async () => {
    try {
      const summary: DiscoveredDeviceAgeOutSummary =
        await DiscoveredDeviceAgeOut.run();

      if (summary.removed > 0 || summary.failedProjects > 0) {
        logger.info(
          `Discovered devices: removed ${summary.removed} not seen for their project's retention (${summary.unhidden} Hide from map preferences with them) across ${summary.projects} projects${summary.failedProjects > 0 ? `; ${summary.failedProjects} failed and are tried again next run` : ""}${summary.isCutShort ? "; the rest wait for the next run" : ""}.`,
        );
      }
    } catch (error) {
      logger.error(
        "Discovered devices: removing the devices no longer seen failed.",
      );
      logger.error(error);
    }
  },
);
