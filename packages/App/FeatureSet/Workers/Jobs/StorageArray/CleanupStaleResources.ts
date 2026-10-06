import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import StorageArrayResourceService from "Common/Server/Services/StorageArrayResourceService";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * StorageArray:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark storage arrays as disconnected if they have not been seen
 *      for 15 minutes (StorageArrayService.markDisconnectedArrays —
 *      this cron is its only scheduled caller). The threshold is 3x
 *      the ingest maintenance fence TTL: lastSeenAt is legitimately up
 *      to ~5 minutes stale during continuous telemetry (Redis fence),
 *      so a threshold equal to the fence flaps healthy arrays between
 *      connected and disconnected. Net SLA: the list-page status pill
 *      flips to Disconnected <= ~20 minutes after the agent dies.
 *   2. For each CONNECTED array, hard-delete StorageArrayResource
 *      inventory rows (volumes, hosts, pods, hardware, drives,
 *      controllers, network interfaces, directories, file systems,
 *      buckets) whose last scrape is older than their kind's stale
 *      threshold. Thresholds and the delete all live in
 *      StorageArrayResourceService (getStaleThresholdDate /
 *      getSlowScrapeStaleThresholdDate / deleteStaleForArray — default
 *      15 minutes, 3x the slowest regular scrape interval, tunable with
 *      STORAGE_ARRAY_INVENTORY_STALE_MINUTES, minimum 5; directories,
 *      which the shipped FlashArray config scrapes only every 30
 *      minutes, get their own 90-minute cutoff) so this cron carries no
 *      duplicate policy. Both cutoffs are anchored to each array's own
 *      lastSeenAt rather than wall-clock now: inventory rows ride the
 *      slower scrape clock, so with the disconnect and prune thresholds
 *      both at 15 minutes a wall-clock cutoff could wipe the last-known
 *      inventory of a still-connected array late in an outage — on the
 *      tick just before step 1 would have flipped it. Anchoring freezes
 *      the prune clock at the last telemetry the array actually sent.
 *
 * Skipping disconnected arrays is deliberate: during a transient agent
 * outage (collector restart, an expired or rotated API token, array
 * maintenance) we want to preserve the last-known inventory rather
 * than wipe the overview page. When the agent reconnects, the next
 * scrape refreshes lastSeenAt on the array and on every object it
 * still reports, and only the objects that really went away (a
 * deleted volume, a removed host) age out on a following tick.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "StorageArray:CleanupStaleResources";

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      /*
       * Step 1: flip stale arrays to disconnected so step 2 skips them.
       * Its own try block — a failure here must not stop the prune, and
       * vice versa.
       */
      try {
        await StorageArrayService.markDisconnectedArrays();
      } catch (err) {
        logger.error(
          `${JOB_NAME}: markDisconnectedArrays failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale inventory rows for arrays that are still
       * believed to be connected.
       */
      const connectedArrays: Array<StorageArray> =
        await StorageArrayService.findBy({
          query: {
            otelCollectorStatus: "connected",
          },
          select: {
            _id: true,
            projectId: true,
            lastSeenAt: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      if (connectedArrays.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const array of connectedArrays) {
        if (!array._id) {
          continue;
        }

        // Anchor both cutoffs to this array's lastSeenAt (see header).
        const anchor: Date | undefined = array.lastSeenAt || undefined;
        const olderThan: Date =
          StorageArrayResourceService.getStaleThresholdDate(anchor);
        const slowScrapeOlderThan: Date =
          StorageArrayResourceService.getSlowScrapeStaleThresholdDate(anchor);

        try {
          const deleted: number =
            await StorageArrayResourceService.deleteStaleForArray({
              storageArrayId: new ObjectID(array._id.toString()),
              olderThan: olderThan,
              slowScrapeOlderThan: slowScrapeOlderThan,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `${JOB_NAME}: deleteStaleForArray failed for storage array ${array._id.toString()} (project ${array.projectId?.toString() || "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `${JOB_NAME}: pruned ${totalDeleted} stale StorageArrayResource row(s) across ${connectedArrays.length} connected storage array(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
