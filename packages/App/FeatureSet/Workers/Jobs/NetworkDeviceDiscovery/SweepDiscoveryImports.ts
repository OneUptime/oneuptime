import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DiscoveryImportRunner from "Common/Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import logger from "Common/Server/Utils/Logger";

/*
 * The backstop of discovery imports. An import runs inside a queue job, so a
 * worker that dies mid-way (a deploy, an out-of-memory kill) would leave it
 * Running for ever, and a job that never ran would leave one Queued. Every
 * minute this picks up an import that has gone quiet where it stopped - its
 * finished hosts are never touched again - and fails one that cannot go on,
 * with a sentence saying what was kept and how to try the rest again.
 */
RunCron(
  "NetworkDeviceDiscovery:SweepDiscoveryImports",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      await DiscoveryImportRunner.sweep();
    } catch (error) {
      logger.error("Discovery import: the sweep of stalled imports failed.");
      logger.error(error);
    }
  },
);
