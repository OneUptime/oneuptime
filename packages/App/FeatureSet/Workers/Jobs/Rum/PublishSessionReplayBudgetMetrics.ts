import RunCron from "../../Utils/Cron";
import { SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY } from "../../../Telemetry/Config";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
 * One sweep at a time, and a sweep that stops before the next tick (issue
 * #8103).
 *
 * RunCron runs one copy of this job at a time across every worker replica
 * (CronLock), so two sweeps no longer interleave and post every point twice;
 * the job used to take a Redis lock of its own for that, from when RunCron
 * had no overlap guard. The queue gives the job four minutes, and the sweep
 * itself stops between pages after three and a half, so a slow sweep ends
 * before the next tick instead of racing it. Between pages it also checks
 * the run's deadline, which passes at the four-minute limit and as soon as
 * the run's lease is lost: another run may hold the lock then.
 */
const JOB_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_DEADLINE_SECONDS: number = 210;

RunCron(
  PUBLISH_SESSION_REPLAY_BUDGET_METRICS_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: SessionReplayBudgetSweepSummary =
        await SessionReplayBudgetMetrics.publishAll({
          dailyByteLimit: SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
          shouldContinue: (): boolean => {
            return !deadline.hasPassed();
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
    }
  },
);
