import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudTagWatcher from "Common/Server/Utils/CloudConnection/CloudTagWatcher";

/*
 * ------------------------------------------------------------------
 * Cloud:WatchCloudTags (#11012)
 *
 * Every 15 minutes, for each project with required tags: the resources
 * its cloud connections listed since that lack one become findings, the
 * open findings are read again (one that was tagged meanwhile is closed),
 * who created each is read from its account's change log, the people are
 * told - one email an hour by default - and an alert is raised where the
 * project asks; once a day each account's resources are counted
 * (CloudTagWatcher). The inventory lists every 30 minutes, so a new
 * resource is told within the hour it is made.
 *
 * runOnStartup is false: a deploy or a scale-up would otherwise run every
 * project at once, and an hour's email waits for the hour anyway.
 * ------------------------------------------------------------------
 */

export const WATCH_CLOUD_TAGS_JOB_NAME: string = "Cloud:WatchCloudTags";

RunCron(
  WATCH_CLOUD_TAGS_JOB_NAME,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 14 * 60 * 1000,
  },
  async (): Promise<void> => {
    try {
      const projects: number = await CloudTagWatcher.runAll(
        OneUptimeDate.getCurrentDate(),
      );

      if (projects > 0) {
        logger.debug(
          `${WATCH_CLOUD_TAGS_JOB_NAME}: watched ${projects} project(s) with required tags`,
        );
      }
    } catch (err) {
      logger.error(
        `${WATCH_CLOUD_TAGS_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
