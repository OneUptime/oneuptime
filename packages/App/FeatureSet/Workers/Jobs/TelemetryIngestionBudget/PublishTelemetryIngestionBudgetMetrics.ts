import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
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
 * As the session replay budget sweep: the queue gives the job four minutes,
 * the lock outlives a crashed holder by at most that long, and the sweep
 * stops between pages after three and a half - so a slow sweep ends before
 * the next tick instead of racing it, and posts no point twice.
 */
const JOB_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_LOCK_REFRESH_INTERVAL_MS: number = 30 * 1000;
const SWEEP_DEADLINE_SECONDS: number = 210;
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";

RunCron(
  PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async () => {
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: SWEEP_LOCK_REFRESH_INTERVAL_MS,
        onLockLost: (err: Error): void => {
          logger.warn(
            `${PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME}: lost the sweep lock; the sweep stops at its next page.`,
          );
          logger.warn(err);
        },
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `${PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME}: a sweep is already running; skipping this tick.`,
        );
      } else {
        logger.warn(
          `${PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME}: could not take the sweep lock; skipping this tick.`,
        );
        logger.warn(err);
      }

      return;
    }

    try {
      const summary: TelemetryIngestionBudgetSweepSummary =
        await TelemetryIngestionBudgetMetrics.publishAll({
          shouldContinue: (): boolean => {
            return mutex.isAcquired;
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
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(
          `${PUBLISH_TELEMETRY_INGESTION_BUDGET_METRICS_JOB_NAME}: could not release the sweep lock.`,
        );
        logger.error(err);
      }
    }
  },
);
