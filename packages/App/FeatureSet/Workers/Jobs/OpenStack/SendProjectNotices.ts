import logger from "Common/Server/Utils/Logger";
import OpenStackProjectNoticeSender from "Common/Server/Utils/OpenStack/OpenStackProjectNoticeSender";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";

/*
 * ------------------------------------------------------------------
 * OpenStack:SendProjectNotices
 *
 * Every minute: what a project asked to hear about, sent to whoever an operator has seen and turned on,
 * and what is over, said to whoever was told it began. See OpenStackProjectNoticeSender for what it holds
 * to. Nothing here runs until a notice has been turned on.
 * ------------------------------------------------------------------
 */

RunCron(
  "OpenStack:SendProjectNotices",
  { schedule: EVERY_MINUTE, runOnStartup: false, timeoutInMS: 10 * 60 * 1000 },
  async () => {
    try {
      await OpenStackProjectNoticeSender.run();
    } catch (error) {
      logger.error(
        `OpenStack project notices did not finish: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);
