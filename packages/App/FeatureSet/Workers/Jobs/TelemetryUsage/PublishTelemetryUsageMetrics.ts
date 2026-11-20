import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import TelemetryUsageMetrics, {
  TelemetryUsageSweepSummary,
} from "Common/Server/Utils/Telemetry/TelemetryUsageMetrics";
import logger from "Common/Server/Utils/Logger";

/*
 * Publishes the telemetry usage of every project that asks for it as the
 * oneuptime.telemetry.usage.bytes metric (TelemetryUsageMetrics, issue
 * #6355): each finished five-minute bucket the telemetry worker counted,
 * per signal and resource. Every five minutes:
 * TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES.
 *
 * The name and schedule are forever. RunCron replaces a repeatable only when
 * both match, so renaming this job or changing its cadence leaves the old
 * repeatable firing in Redis until a startup migration removes it.
 *
 * One sweep at a time across every worker replica (RunCron's CronLock), so
 * a bucket is written once: each is forgotten once written. The queue gives
 * the job four minutes, and the sweep stops between pages after three and a
 * half, or as soon as the run's deadline passes; the next tick picks up what
 * is left, as a bucket is kept for an hour.
 */
export const PUBLISH_TELEMETRY_USAGE_METRICS_JOB_NAME: string =
  "TelemetryUsage:PublishTelemetryUsageMetrics";

const JOB_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(4);
const SWEEP_DEADLINE_SECONDS: number = 210;

RunCron(
  PUBLISH_TELEMETRY_USAGE_METRICS_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: TelemetryUsageSweepSummary =
        await TelemetryUsageMetrics.publishAll({
          shouldContinue: (): boolean => {
            return !deadline.hasPassed();
          },
          deadline: OneUptimeDate.addRemoveSeconds(
            OneUptimeDate.getCurrentDate(),
            SWEEP_DEADLINE_SECONDS,
          ),
        });

      logger.debug(
        `${PUBLISH_TELEMETRY_USAGE_METRICS_JOB_NAME}: ${summary.stopReason}, ${summary.rowsWritten} row(s) for ${summary.projectsScanned} project(s) in ${summary.bucketsRead} bucket(s).`,
      );
    } catch (err) {
      logger.error(
        `${PUBLISH_TELEMETRY_USAGE_METRICS_JOB_NAME}: the sweep failed.`,
      );
      logger.error(err);
    }
  },
);
