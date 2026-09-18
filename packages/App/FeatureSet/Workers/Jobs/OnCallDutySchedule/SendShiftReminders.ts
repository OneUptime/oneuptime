import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import OnCallShiftReminderRunner, {
  SHIFT_REMINDER_JOB_NAME,
  SHIFT_REMINDER_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";

/*
 * "Your on-call shift on <Schedule> starts in 1 hour."
 *
 * Every five minutes, one sweep over every lead time users configured
 * (UserOnCallShiftReminder), sending each reminder exactly once. The body —
 * watermark window, lateness cap, claim -> send -> stamp through the
 * UserOnCallShiftReminderLog ledger, the cross-replica sweep lock — lives in
 * Common/Server/Utils/OnCall/OnCallShiftReminderRunner so it can be tested
 * without a queue; this file is the scheduling half.
 *
 * runOnStartup is false on purpose: reminders are user-facing side effects,
 * and the watermark means a boot never has to "catch up" by firing early.
 * The timeout is comfortably above one tick, and the sweep lock inside the
 * runner outlives it (QueueWorker.runJobWithTimeout races the body, it does
 * not cancel it).
 */
RunCron(
  SHIFT_REMINDER_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: SHIFT_REMINDER_JOB_TIMEOUT_MS,
  },
  async () => {
    logger.debug(`Starting cron job: ${SHIFT_REMINDER_JOB_NAME}`);

    await OnCallShiftReminderRunner.runSweepUnderLock();

    logger.debug(`Completed cron job: ${SHIFT_REMINDER_JOB_NAME}`);
  },
);
