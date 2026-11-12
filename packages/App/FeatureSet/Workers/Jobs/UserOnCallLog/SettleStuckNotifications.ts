import RunCron from "../../Utils/Cron";
import {
  STUCK_NOTIFICATION_CHECK_JOB_NAME,
  settleStuckNotifications,
} from "Common/Server/Utils/OnCall/OnCallStuckNotifications";
import logger from "Common/Server/Utils/Logger";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Settles the on-call notifications that never got a result: one still
 * Sending 15 minutes after its page wrote it - its request to the
 * Notification service got no answer, and the service never wrote how it
 * went - says it may not have been sent (Error), unless a result or an
 * acknowledgement lands first.
 *
 * Everything that decides anything lives in
 * Common/Server/Utils/OnCall/OnCallStuckNotifications. This file only says
 * when it runs.
 *
 * Every five minutes: a notification is settled between 15 and 20 minutes
 * after it was written, and a run with none due is one read of a partial
 * index. Not on startup: what was due during a restart is read by the next
 * run.
 */
RunCron(
  STUCK_NOTIFICATION_CHECK_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
  },
  async () => {
    logger.debug(`Starting cron job: ${STUCK_NOTIFICATION_CHECK_JOB_NAME}`);

    await settleStuckNotifications();

    logger.debug(`Completed cron job: ${STUCK_NOTIFICATION_CHECK_JOB_NAME}`);
  },
);
