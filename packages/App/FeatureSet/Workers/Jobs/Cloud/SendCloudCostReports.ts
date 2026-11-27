import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudCostReportSchedule from "Common/Server/Utils/CloudCost/CloudCostReportSchedule";

/*
 * ------------------------------------------------------------------
 * Cloud:SendCloudCostReports (#11009)
 *
 * Every minute, the enabled cloud cost reports whose next send has come
 * are sent (CloudCostReportSchedule.sendDue): each is claimed by moving its
 * next send on in one statement, so two replicas never send it twice, then
 * read for each person it goes to and sent - by email through their own
 * notification settings, to addresses outside the project and to Slack and
 * Microsoft Teams channels - and what became of each is kept on the report.
 * ------------------------------------------------------------------
 */

export const SEND_CLOUD_COST_REPORTS_JOB_NAME: string =
  "Cloud:SendCloudCostReports";

RunCron(
  SEND_CLOUD_COST_REPORTS_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      const sent: number = await CloudCostReportSchedule.sendDue();

      if (sent > 0) {
        logger.debug(
          `${SEND_CLOUD_COST_REPORTS_JOB_NAME}: sent ${sent} cloud cost report(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${SEND_CLOUD_COST_REPORTS_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
