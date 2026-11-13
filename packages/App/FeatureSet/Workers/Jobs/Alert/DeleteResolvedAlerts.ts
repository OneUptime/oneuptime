import RunCron from "../../Utils/Cron";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import ResolvedRecordRetention, {
  RETENTION_TIME_BUDGET_MS,
  ResolvedRecordRetentionSummary,
} from "Common/Server/Utils/Retention/ResolvedRecordRetention";
import { ResolvedRecordKind } from "Common/Types/Retention/ResolvedRecordRetention";
import logger from "Common/Server/Utils/Logger";

/*
 * Deletes the resolved alerts a project no longer keeps (Alerts -> Settings
 * -> Data Retention; Never unless a Project Owner or Admin picks a length;
 * issue #6903), with everything they carry, and then their episodes once
 * nothing in them is left. Unresolved alerts, ones resolved within the
 * retention, ones in an episode still open and ones linked to an incident
 * stay: see ResolvedRecordRetention for what is deleted, how, and why.
 *
 * Hourly, a bounded amount of work a run: a project that turns retention on
 * with years of alerts drains over a few runs. The timeout leaves the last
 * delete room to finish after the run's own budget is spent.
 */
RunCron(
  "Alert:DeleteResolvedAlerts",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: RETENTION_TIME_BUDGET_MS + 2 * 60 * 1000,
  },
  async () => {
    try {
      const summary: ResolvedRecordRetentionSummary =
        await ResolvedRecordRetention.run({
          kind: ResolvedRecordKind.Alert,
        });

      if (
        summary.records > 0 ||
        summary.episodes > 0 ||
        summary.failedProjects > 0
      ) {
        logger.info(
          `Alert retention: deleted ${summary.records} resolved alerts and ${summary.episodes} episodes kept past their project's retention, across ${summary.projects} projects${summary.failedProjects > 0 ? `; ${summary.failedProjects} failed and are tried again next run` : ""}${summary.isCutShort ? "; the rest wait for the next run" : ""}.`,
        );
      }
    } catch (error) {
      logger.error(
        "Alert retention: deleting the resolved alerts projects no longer keep failed.",
      );
      logger.error(error);
    }
  },
);
