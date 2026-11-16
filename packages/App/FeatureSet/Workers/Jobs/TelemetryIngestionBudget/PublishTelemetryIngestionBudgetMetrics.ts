import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import TelemetryIngestionBudgetMetrics, {
  TelemetryIngestionBudgetSweepSummary,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetMetrics";
import logger from "Common/Server/Utils/Logger";

/*
 * Publishes every budgeted project's (and ingestion key's) telemetry
 * ingestion budget for the day as the oneuptime.telemetry.budget.* gauges
 * that Metrics monitors watch, and emails project owners the day's warning
 * and used-up notices (TelemetryIngestionBudgetMetrics). Every five minutes:
 * TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES.
 *
 * The name and schedule are forever. RunCron replaces a repeatable only when
 * both match, so renaming this job or changing its cadence leaves the old
 * repeatable firing in Redis until a startup migration removes it.
 */
export const PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME: string =
  "TelemetryIngestionBudget:PublishTelemetryIngestionBudgetMetrics";

/*
 * One sweep at a time, and a sweep that stops before the next tick, as the
 * session replay budget sweep (issue #8103).
 *
 * RunCron runs one copy of this job at a time across every worker replica
 * (CronLock), so two sweeps no longer interleave and post every point
 * twice; the job used to take a Redis lock of its own for that, from when
 * RunCron had no overlap guard. Its emails need no lock either: each notice
 * is claimed in Redis before it is sent, so one sweep alone sends it
 * (TelemetryIngestionBudgetMetrics.sendNotices). The queue gives the job
 * four minutes, and the sweep stops between pages after three and a half,
 * or as soon as the run's deadline passes - its time limit, or its lease
 * lost, when another run may hold the lock.
 */
const JOB_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_DEADLINE_SECONDS: number = 210;

RunCron(
  PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: TelemetryIngestionBudgetSweepSummary =
        await TelemetryIngestionBudgetMetrics.publishAll({
          shouldContinue: (): boolean => {
            return !deadline.hasPassed();
          },
          deadline: OneUptimeDate.addRemoveSeconds(
            OneUptimeDate.getCurrentDate(),
            SWEEP_DEADLINE_SECONDS,
          ),
        });

      logger.debug(
        `${PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME}: ${summary.stopReason}, ${summary.rowsWritten} row(s) for ${summary.scopesScanned} scope(s), ${summary.noticesSent} notice(s).`,
      );
    } catch (err) {
      logger.error(
        `${PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME}: the sweep failed.`,
      );
      logger.error(err);
    }
  },
);
