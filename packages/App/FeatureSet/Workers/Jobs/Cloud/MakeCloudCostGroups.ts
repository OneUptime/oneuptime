import { EVERY_HOUR } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudCostViewSync from "Common/Server/Utils/CloudCost/CloudCostViewSync";

/*
 * ------------------------------------------------------------------
 * Cloud:MakeCloudCostGroups
 *
 * Once an hour, every cost view made per tag value or per owner team gets
 * the groups it is missing: a group for each new value its tag carries in
 * the costs, or for each team that has come to own cloud resources
 * (CloudCostViewSync). A view is given its groups when it is saved too;
 * this tick is for what changes without a save - costs read with a new
 * tag value, owners set by hand or by owner rules.
 * ------------------------------------------------------------------
 */

export const MAKE_CLOUD_COST_GROUPS_JOB_NAME: string =
  "Cloud:MakeCloudCostGroups";

RunCron(
  MAKE_CLOUD_COST_GROUPS_JOB_NAME,
  { schedule: EVERY_HOUR, runOnStartup: false },
  async (): Promise<void> => {
    try {
      const made: number = await CloudCostViewSync.makeGroupsForAllViews();

      if (made > 0) {
        logger.debug(
          `${MAKE_CLOUD_COST_GROUPS_JOB_NAME}: made ${made} cost group(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${MAKE_CLOUD_COST_GROUPS_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
