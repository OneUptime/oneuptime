import RunCron from "../../Utils/Cron";
import {
  STUCK_NOTIFICATION_CHECK_JOB_NAME,
  runStuckNotificationCheck,
} from "Common/Server/Utils/OnCall/OnCallStuckNotifications";
import logger from "Common/Server/Utils/Logger";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Settles the on-call notifications that never got a result: one still
 * Sending 15 minutes after its page wrote it - its request to the
 * Notification service got no answer, and the service never wrote how it
 * went - says it may not have been sent (Error), unless a result or an
 * acknowledgement lands first. However long ago it was written: one the
 * check did not reach within its day's look-back, because the workers were
 * down or the queue stalled for longer than that, is settled by the same
 * run, straight to the table (issue #7290).
 *
 * Everything that decides anything lives in
 * Common/Server/Utils/OnCall/OnCallStuckNotifications (runStuckNotificationCheck).
 * This file only says when it runs.
 *
 * Every five minutes: a notification is settled between 15 and 20 minutes
 * after it was written, and a run with none due is two reads of a partial
 * index that holds only the notifications still Sending. Not on startup:
 * what was due during a restart is read by the next run.
 */
RunCron(
  STUCK_NOTIFICATION_CHECK_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
  },
  async () => {
    logger.debug(`Starting cron job: ${STUCK_NOTIFICATION_CHECK_JOB_NAME}`);

    await runStuckNotificationCheck();

    logger.debug(`Completed cron job: ${STUCK_NOTIFICATION_CHECK_JOB_NAME}`);
  },
);
