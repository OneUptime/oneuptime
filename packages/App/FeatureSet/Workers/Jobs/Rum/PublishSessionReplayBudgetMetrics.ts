import RunCron from "../../Utils/Cron";
import { SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY } from "../../../Telemetry/Config";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import SessionReplayBudgetMetrics, {
  SessionReplayBudgetSweepSummary,
} from "Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics";
import logger from "Common/Server/Utils/Logger";

/*
 * Publishes the session replay storage budgets - the project's daily limit
 * and each application's monthly budget - as the
 * oneuptime.rum.session.replay.budget.* gauges that Metrics monitors (and
 * the RUM application's one-click budget alerts) watch. Every five minutes:
 * SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES, which the alert templates'
 * 15-minute window is built on.
 *
 * The name and schedule are forever. RunCron replaces a repeatable only when
 * both match, so renaming this job or changing its cadence leaves the old
 * repeatable firing in Redis until a startup migration removes it.
 */
export const PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME: string =
  "Rum:PublishSessionReplayBudgetMetrics";

/*
 * The queue gives the job four minutes, the lock outlives a crashed holder by
 * at most that long, and the sweep itself stops between pages after three and
 * a half - so a slow sweep ends before the next tick instead of racing it.
 * The job timeout alone cannot do that: runJobWithTimeout is a Promise.race
 * that does not cancel the sweep.
 */
const JOB_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_DEADLINE_SECONDS: number = 210;
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";

RunCron(
  PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async () => {
    /*
     * acquireAttemptsLimit: 1 - never queue behind a sweep in flight; the
     * next tick is five minutes away anyway. Two interleaved sweeps would
     * post every point twice.
     */
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `${PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME}: a sweep is already running; skipping this tick.`,
        );
      } else {
        // Anything else is Redis itself failing - not worth hiding at debug.
        logger.warn(
          `${PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME}: could not take the sweep lock; skipping this tick.`,
        );
        logger.warn(err);
      }

      return;
    }

    try {
      const summary: SessionReplayBudgetSweepSummary =
        await SessionReplayBudgetMetrics.publishAll({
          dailyByteLimit: SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
          shouldContinue: (): boolean => {
            return mutex.isAcquired;
          },
          deadline: OneUptimeDate.addRemoveSeconds(
            OneUptimeDate.getCurrentDate(),
            SWEEP_DEADLINE_SECONDS,
          ),
        });

      logger.debug(
        `${PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME}: ${summary.stopReason}, ${summary.rowsWritten} row(s) for ${summary.applicationsScanned} application(s).`,
      );
    } catch (err) {
      // publishAll reports its own failures; this is the last line of defence.
      logger.error(
        `${PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME}: the sweep failed.`,
      );
      logger.error(err);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // A failed release only means the lock expires on its own timeout.
        logger.error(
          `${PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME}: could not release the sweep lock.`,
        );
        logger.error(err);
      }
    }
  },
);
