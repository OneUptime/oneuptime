import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import OnCallShiftReminderRunner, {
  SHIFT_REMINDER_LOG_RETENTION_DAYS,
  SHIFT_REMINDER_LOG_RETENTION_JOB_NAME,
  ShiftReminderRetentionStats,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";

/*
 * Retention for the shift-reminder ledger (UserOnCallShiftReminderLog).
 *
 * A ledger row only has to outlive the shift it de-duplicates; after that it
 * is bookkeeping. Rows whose SHIFT started more than
 * SHIFT_REMINDER_LOG_RETENTION_DAYS ago are deleted in small batches (the
 * DeleteOldTimeLogs pattern). Keyed on the shift start rather than the claim
 * time so a row can never be reaped while its shift is still ahead — leads
 * run up to two weeks, retention runs 30 days.
 *
 * Not gated on billing: the ledger is operational state, not an audit
 * record, and it is the same size problem on every install.
 */
RunCron(
  SHIFT_REMINDER_LOG_RETENTION_JOB_NAME,
  { schedule: EVERY_DAY, runOnStartup: false },
  async () => {
    logger.debug(`Starting cron job: ${SHIFT_REMINDER_LOG_RETENTION_JOB_NAME}`);

    const result: ShiftReminderRetentionStats =
      await OnCallShiftReminderRunner.deleteOldLogs({
        retentionDays: SHIFT_REMINDER_LOG_RETENTION_DAYS,
      });

    logger.debug(
      `Completed cron job: ${SHIFT_REMINDER_LOG_RETENTION_JOB_NAME} — deleted ${result.deleted} ledger rows for shifts before ${result.cutoff.toISOString()}.`,
    );
  },
);
