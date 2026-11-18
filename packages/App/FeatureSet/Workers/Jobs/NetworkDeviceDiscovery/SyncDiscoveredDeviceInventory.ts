import RunCron from "../../Utils/Cron";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import DiscoveredDeviceInventorySync, {
  DiscoveredDeviceInventorySyncSummary,
  INVENTORY_SYNC_TIME_BUDGET_MS,
} from "Common/Server/Utils/NetworkDevice/DiscoveredDeviceInventorySync";
import logger from "Common/Server/Utils/Logger";

/*
 * Copies what the Discovered Devices list knows about a device - the maker
 * its MAC address names, what its controller calls it - onto the monitored
 * device it is matched to, so its Vendor / Model and inventory are not empty
 * (issue #9305). Never replaces anything saved on the device: see
 * DiscoveredDeviceInventorySync for what is written, and when.
 *
 * Hourly, a bounded amount of work a run. The first run after an upgrade
 * fills in every device imported before this, and a large installation
 * drains over a few runs, each carrying on where the last stopped. The
 * timeout leaves the last statement room to finish after the run's own
 * budget is spent.
 */
RunCron(
  "NetworkDeviceDiscovery:SyncDiscoveredDeviceInventory",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: INVENTORY_SYNC_TIME_BUDGET_MS + 2 * 60 * 1000,
  },
  async () => {
    try {
      const summary: DiscoveredDeviceInventorySyncSummary =
        await DiscoveredDeviceInventorySync.run();

      if (summary.updatedDevices > 0 || summary.failedProjects > 0) {
        logger.info(
          `Discovered devices: updated what ${summary.updatedDevices} monitored devices know from the Discovered Devices list across ${summary.projects} projects${summary.failedProjects > 0 ? `; ${summary.failedProjects} failed and are tried again next run` : ""}${summary.isCutShort ? "; the rest wait for the next run" : ""}.`,
        );
      }
    } catch (error) {
      logger.error(
        "Discovered devices: copying what the list knows onto monitored devices failed.",
      );
      logger.error(error);
    }
  },
);
