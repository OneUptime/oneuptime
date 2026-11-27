import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import OneUptimeDate from "Common/Types/Date";
import SecurityUserErasure from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import logger from "Common/Server/Utils/Logger";

/*
 * Security Events' erasure requests (#10908), carried out: each minute,
 * every open request is moved on as far as it can go - started once every
 * process refuses the person's tokens, checked done once ClickHouse has
 * applied what it was told and a last read of the project's Detection
 * Findings finds nothing to change (SecurityUserErasure says how). A
 * request is usually Completed a quarter of an hour after it is filed. The
 * run stops between requests, and between pages of a project's Detection
 * Findings, when its time runs out: the request keeps where the read got to
 * (#11160), and a later run carries on from there.
 */
RunCron(
  "SecurityEvents:EraseUsers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      await SecurityUserErasure.processOpenRequests(
        OneUptimeDate.getCurrentDate(),
        deadline,
      );
    } catch (error) {
      logger.error(
        "SecurityEvents:EraseUsers: could not read the open erasure requests.",
      );
      logger.error(error);
    }
  },
);
