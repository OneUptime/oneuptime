import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import MessageQueueService from "Common/Server/Services/MessageQueueService";

/*
 * ------------------------------------------------------------------
 * MessageQueue:CleanupStaleResources
 *
 * Runs every 5 minutes. Archives DISCOVERED queues nobody has seen - or
 * touched - for MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS (default 7), at most 500
 * per run, oldest first (MessageQueueService.autoArchiveStaleMessageQueues).
 * Discovery creates rows on its own from messaging spans and broker
 * metrics, so without this sweep a queue a decommissioned service used, or
 * a per-run topic seen once in a trace, would sit in the list - and count
 * against the project's auto-create budget - forever.
 *
 * Manual rows and rows a person invested in (a description, a rename, labels
 * and owners a PERSON added - not the ones label / owner rules attached) are
 * never archived, and neither is a row a person just restored from the
 * archive (until it is seen again, or a grace period passes). A row
 * archived here comes back by itself the next time discovery sees it.
 * The thresholds and the SQL live in the service, so this cron carries no
 * duplicate policy.
 *
 * Queues have no collector connection to flip to "disconnected": a queue
 * seen in traces or broker metrics is live, and brokerMetricsLastSeenAt
 * says when the broker's own metrics last arrived.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "MessageQueue:CleanupStaleResources";

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    let archived: number = 0;

    try {
      archived = await MessageQueueService.autoArchiveStaleMessageQueues();
    } catch (err) {
      logger.error(
        `${JOB_NAME}: autoArchiveStaleMessageQueues failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (archived > 0) {
      logger.debug(
        `${JOB_NAME}: auto-archived ${archived} stale discovered queue(s)`,
      );
    }
  },
);
