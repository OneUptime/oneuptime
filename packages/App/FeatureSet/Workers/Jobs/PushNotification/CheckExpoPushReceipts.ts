import RunCron from "../../Utils/Cron";
import ExpoPushReceiptService, {
  EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
  EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS,
} from "Common/Server/Services/ExpoPushReceiptService";
import logger from "Common/Server/Utils/Logger";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Reads the receipts of the mobile pushes Expo accepted, about 15 minutes
 * after each was sent, and acts on the ones that say a push was not
 * delivered: a phone Expo says is gone stops being paged, and the push log
 * and the page's on-call timeline row say the push did not arrive.
 *
 * Everything that decides anything lives in
 * Common/Server/Services/ExpoPushReceiptService (and the queue of pending
 * receipts, Common/Server/Infrastructure/ExpoPushReceiptQueue). This file
 * only says when it runs.
 *
 * ONE job, every five minutes, for every push: receipts are read in
 * requests of up to 300, never a job per push. A run with nothing due is one
 * Redis read. Five minutes is plenty: a receipt is not read before 15
 * minutes have passed, and what it finds - a phone that is gone - has already
 * cost the page it was about.
 *
 * Not on startup: nothing is late for want of a boot-time run; what was due
 * during a restart is read by the next run.
 */
RunCron(
  EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS,
  },
  async () => {
    logger.debug(`Starting cron job: ${EXPO_PUSH_RECEIPT_CHECK_JOB_NAME}`);

    await ExpoPushReceiptService.checkDueReceipts();

    logger.debug(`Completed cron job: ${EXPO_PUSH_RECEIPT_CHECK_JOB_NAME}`);
  },
);
