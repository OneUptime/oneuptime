import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
 * UserOnCallShiftReminderLog ledger — lives in
 * Common/Server/Utils/OnCall/OnCallShiftReminderRunner so it can be tested
 * without a queue; this file is the scheduling half.
 *
 * runOnStartup is false on purpose: reminders are user-facing side effects,
 * and the watermark means a boot never has to "catch up" by firing early.
 * The timeout is comfortably above one tick. RunCron runs one sweep at a time
 * (CronLock) and hands it the run's deadline, which passes at the timeout or
 * when the run's lease is lost; the sweep stops between projects once it has
 * and holds the watermark, so the next tick re-covers the window (issue
 * #8103). The runner takes no lock of its own: the ledger already makes each
 * reminder exactly-once.
 */
RunCron(
  SHIFT_REMINDER_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: SHIFT_REMINDER_JOB_TIMEOUT_MS,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    logger.debug(`Starting cron job: ${SHIFT_REMINDER_JOB_NAME}`);

    await OnCallShiftReminderRunner.runSweep({ deadline: deadline });

    logger.debug(`Completed cron job: ${SHIFT_REMINDER_JOB_NAME}`);
  },
);
