import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import OneUptimeDate from "Common/Types/Date";
import KubernetesClusterComplianceSummary, {
  ComplianceSummaryRefreshResult,
} from "Common/Server/Utils/Kubernetes/KubernetesClusterComplianceSummary";

/*
 * ------------------------------------------------------------------
 * Kubernetes:RefreshComplianceSummaries (#9876)
 *
 * Runs every 5 minutes, the agent's default resourceSpecs interval: each
 * cluster that is due is scored against its hardening frameworks again and
 * its summary kept on its record, for Kubernetes' Compliance page, which
 * compares every cluster without scoring any. Due is a cluster never
 * scored, one whose agent reports and was scored over 15 minutes ago (its
 * snapshots have landed since), and any scored over an hour ago, so a
 * setting changed through the API or an accepted finding that expired shows
 * within the hour (KubernetesClusterComplianceSummary). Oldest first, at
 * most 100 a run, until the run's deadline; a cluster that fails is tried
 * again next run.
 * ------------------------------------------------------------------
 */

RunCron(
  "Kubernetes:RefreshComplianceSummaries",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()) => {
    try {
      const result: ComplianceSummaryRefreshResult =
        await KubernetesClusterComplianceSummary.refreshDueClusters({
          now: OneUptimeDate.getCurrentDate(),
          deadline,
        });

      if (result.refreshed > 0 || result.failed > 0 || result.left > 0) {
        logger.debug(
          `RefreshComplianceSummaries: scored ${result.refreshed} cluster(s), ${result.failed} failed, ${result.left} left for the next run`,
        );
      }
    } catch (err) {
      logger.error(
        `RefreshComplianceSummaries cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
