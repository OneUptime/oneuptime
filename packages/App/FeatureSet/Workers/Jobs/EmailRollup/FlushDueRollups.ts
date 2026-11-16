import RunCron from "../../Utils/Cron";
import {
  ROLLUP_JOB_NAME,
  ROLLUP_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/EmailRollup/EmailRollupConstants";
import EmailRollupFlushRunner from "Common/Server/Utils/EmailRollup/EmailRollupFlushRunner";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
 * budget so a healthy tick is never stopped part way through its buckets, and
 * below JobDictionary's five-minute default so it is a deliberate number
 * rather than an inherited one. RunCron runs one sweep at a time (CronLock)
 * and hands it its deadline, which passes at that limit or when the run's
 * lease is lost; the sweep stops between buckets once it has (issue #8103).
 * The runner takes no lock of its own: the claim insert, not a lock, is what
 * makes a rollup exactly-once.
 */
RunCron(
  ROLLUP_JOB_NAME,
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: ROLLUP_JOB_TIMEOUT_MS,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    logger.debug(`Starting cron job: ${ROLLUP_JOB_NAME}`);

    await EmailRollupFlushRunner.runSweep({ deadline: deadline });

    logger.debug(`Completed cron job: ${ROLLUP_JOB_NAME}`);
  },
);
