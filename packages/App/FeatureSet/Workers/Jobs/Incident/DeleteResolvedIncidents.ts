import RunCron from "../../Utils/Cron";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ResolvedRecordRetention, {
  RETENTION_TIME_BUDGET_MS,
  ResolvedRecordRetentionSummary,
} from "Common/Server/Utils/Retention/ResolvedRecordRetention";
import { ResolvedRecordKind } from "Common/Types/Retention/ResolvedRecordRetention";
import logger from "Common/Server/Utils/Logger";

/*
 * Deletes the resolved incidents a project no longer keeps (Incidents ->
 * Settings -> Data Retention; Never unless a Project Owner or Admin picks a
 * length; issue #6903), with everything they carry, and then their episodes
 * once nothing in them is left. Unresolved incidents, ones resolved within
 * the retention, ones in an episode still open and - unless the project
 * turned it off - ones with a completed postmortem stay: see
 * ResolvedRecordRetention for what is deleted, how, and why.
 *
 * Hourly, a bounded amount of work a run: a project that turns retention on
 * with years of incidents drains over a few runs, and a run cut short is
 * carried on by the next one from where it stopped (issue #8896). The
 * timeout leaves the last delete room to finish after the run's own budget
 * is spent.
 */
RunCron(
  "Incident:DeleteResolvedIncidents",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: RETENTION_TIME_BUDGET_MS + 2 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: ResolvedRecordRetentionSummary =
        await ResolvedRecordRetention.run({
          kind: ResolvedRecordKind.Incident,
          deadline: deadline,
        });

      if (
        summary.records > 0 ||
        summary.episodes > 0 ||
        summary.failedProjects > 0 ||
        summary.isCutShort
      ) {
        logger.info(
          `Incident retention: deleted ${summary.records} resolved incidents and ${summary.episodes} episodes kept past their project's retention, across ${summary.projects} projects${summary.failedProjects > 0 ? `; ${summary.failedProjects} failed and are tried again on their next turn` : ""}${summary.isCutShort ? "; the run was cut short, and the next one starts where it stopped" : ""}.`,
        );
      }
    } catch (error) {
      logger.error(
        "Incident retention: deleting the resolved incidents projects no longer keep failed.",
      );
      logger.error(error);
    }
  },
);
