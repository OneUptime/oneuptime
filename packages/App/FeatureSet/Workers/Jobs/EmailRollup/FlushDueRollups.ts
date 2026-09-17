import RunCron from "../../Utils/Cron";
import {
  ROLLUP_JOB_NAME,
  ROLLUP_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/EmailRollup/EmailRollupConstants";
import EmailRollupFlushRunner from "Common/Server/Utils/EmailRollup/EmailRollupFlushRunner";
import logger from "Common/Server/Utils/Logger";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * The scheduling half of the owner-email burst rollup.
 *
 * Everything that decides anything - the due-item scan, the exactly-once
 * epoch claim under the batch table's unique index, stamp-before-send, the
 * recipient re-validation and the render - lives in
 * Common/Server/Utils/EmailRollup/EmailRollupFlushRunner, so it can be tested
 * end to end with no queue and no Redis. This file only says when it runs.
 *
 * EVERY MINUTE, because the deferral promise is "a few minutes later", and a
 * coarser schedule would add up to its own interval of latency on top of
 * FLUSH_AFTER_MINUTES for no benefit. A tick with nothing due is one indexed
 * query against a small contiguous slice of the ["sentAt","createdAt"] index.
 *
 * runOnStartup MUST STAY FALSE. App/FeatureSet/Notification/Utils/Handlebars
 * fires loadPartials() unawaited at import time, so a render that happens
 * during boot can throw "the partial X could not be found" - and the rollup
 * template is built entirely from partials. Nothing about the feature needs a
 * boot-time catch-up either: a bucket that was due during a restart is still
 * due on the next scheduled tick.
 *
 * The timeout is four minutes: above the sweep's own three-minute wall-clock
 * budget so a healthy tick is never killed part way through a bucket, and
 * below JobDictionary's five-minute default so it is a deliberate number
 * rather than an inherited one. The sweep lock inside the runner is five
 * minutes and so outlives it, which is required rather than sloppy -
 * QueueWorker.runJobWithTimeout races the job body, it does not cancel it, so
 * a timed-out tick is still running when the next one starts.
 */
RunCron(
  ROLLUP_JOB_NAME,
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: ROLLUP_JOB_TIMEOUT_MS,
  },
  async () => {
    logger.debug(`Starting cron job: ${ROLLUP_JOB_NAME}`);

    await EmailRollupFlushRunner.runSweepUnderLock();

    logger.debug(`Completed cron job: ${ROLLUP_JOB_NAME}`);
  },
);
