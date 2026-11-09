import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import TelemetryUsageMeter, {
  TelemetryUsageMeterSummary,
} from "Common/Server/Utils/TelemetryUsage/TelemetryUsageMeter";
import logger from "Common/Server/Utils/Logger";

/*
 * Counts every project's telemetry usage where billing is off - Community
 * Edition and every self-hosted install - so Project Settings > Telemetry &
 * APM > Usage and the Admin Dashboard show what each project and service
 * sends (TelemetryUsageMeter). Daily, when OneUptime Cloud's billing run
 * stages the same usage, so a day is counted the same way on every install:
 * once it has ended in UTC, with the night for late telemetry to arrive.
 *
 * Where billing is on, the Enterprise billing job stages usage instead
 * (MeteredPlan:ReportTelemetryMeteredPlan), and this one does nothing.
 *
 * The name and schedule are forever: RunCron replaces a repeatable only when
 * both match, so renaming this job or changing its cadence leaves the old
 * repeatable firing until a startup migration removes it.
 */
export const METER_TELEMETRY_USAGE_JOB_NAME: string =
  "TelemetryUsage:MeterTelemetryUsage";

/*
 * A run stops starting new work after two hours and leaves the rest to the
 * next one; the queue gives it a quarter of an hour more, and the lock lasts
 * as long, refreshed every 30 seconds so a run that lost it stops at its next
 * signal. runJobWithTimeout cannot stop a run (a Promise.race), so the
 * deadline is what ends a long one before the next.
 */
export const METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES: number = 120;
const JOB_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(
  METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES + 15,
);
const LOCK_REFRESH_INTERVAL_MS: number = 30 * 1000;
const LOCK_NAMESPACE: string = "Workers.Cron";

RunCron(
  METER_TELEMETRY_USAGE_JOB_NAME,
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async () => {
    if (IsBillingEnabled) {
      logger.debug(
        `${METER_TELEMETRY_USAGE_JOB_NAME}: billing is on, and billing stages telemetry usage. Skipping.`,
      );
      return;
    }

    // Never queue behind a run in flight: two would scan the same days.
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: METER_TELEMETRY_USAGE_JOB_NAME,
        namespace: LOCK_NAMESPACE,
        lockTimeout: JOB_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: LOCK_REFRESH_INTERVAL_MS,
        onLockLost: (err: Error): void => {
          logger.warn(
            `${METER_TELEMETRY_USAGE_JOB_NAME}: lost the run's lock; the run stops at its next signal.`,
          );
          logger.warn(err);
        },
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `${METER_TELEMETRY_USAGE_JOB_NAME}: a run is already counting usage; skipping this one.`,
        );
      } else {
        logger.warn(
          `${METER_TELEMETRY_USAGE_JOB_NAME}: could not take the run's lock; skipping this one.`,
        );
        logger.warn(err);
      }

      return;
    }

    try {
      const summary: TelemetryUsageMeterSummary =
        await TelemetryUsageMeter.meterAllProjects({
          deadline: OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            METER_TELEMETRY_USAGE_DEADLINE_IN_MINUTES,
          ),
          shouldContinue: (): boolean => {
            return mutex.isAcquired;
          },
        });

      logger.debug(
        `${METER_TELEMETRY_USAGE_JOB_NAME}: ${summary.stopReason}, ${summary.projectsMetered} project(s) counted, ${summary.failures} failure(s) left for the next run.`,
      );
    } catch (err) {
      logger.error(`${METER_TELEMETRY_USAGE_JOB_NAME}: the run failed.`);
      logger.error(err);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // A failed release only means the lock expires on its own timeout.
        logger.error(
          `${METER_TELEMETRY_USAGE_JOB_NAME}: could not release the run's lock.`,
        );
        logger.error(err);
      }
    }
  },
);
