import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTDeviceService from "Common/Server/Services/IoTDeviceService";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * IoT:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark fleets as disconnected if they have not been seen for
 *      15 minutes (IoTFleetService.markDisconnectedFleets — this cron
 *      is its only scheduled caller). The threshold is 3x the ingest
 *      maintenance fence TTL: lastSeenAt is legitimately up to ~5
 *      minutes stale during continuous telemetry (Redis fence), so a
 *      threshold equal to the fence flaps healthy fleets between
 *      connected and disconnected. Net SLA: the list-page status pill
 *      flips to Disconnected ≤ ~20 minutes after the agent dies.
 *   2. For each CONNECTED fleet, hard-delete IoTDevice inventory rows
 *      whose last snapshot is older than the stale threshold. Threshold
 *      and delete both live in IoTDeviceService (getStaleThresholdDate /
 *      deleteStaleForFleet — default 15 minutes = 3x the snapshot
 *      interval; override with IOT_INVENTORY_STALE_MINUTES, minimum 5)
 *      so this cron carries no duplicate policy. The cutoff is anchored
 *      to each fleet's own lastSeenAt rather than wall-clock now:
 *      inventory rows ride the slower snapshot clock, so with the
 *      disconnect and prune thresholds both at 15 minutes a wall-clock
 *      cutoff could wipe the last-known inventory of a still-connected
 *      fleet late in an outage. Anchoring freezes the prune clock.
 *
 * Skipping disconnected fleets is deliberate: during a transient agent
 * outage we want to preserve the last-known inventory rather than wipe
 * the overview page. When the agent reconnects, the next snapshot
 * refreshes lastSeenAt and the rows become live again.
 * ------------------------------------------------------------------
 */

RunCron(
  "IoT:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      /*
       * Step 1: flip stale fleets to disconnected so step 2 skips
       * them.
       */
      try {
        await IoTFleetService.markDisconnectedFleets();
      } catch (err) {
        logger.error(
          `IoT:CleanupStaleResources: markDisconnectedFleets failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale inventory rows for fleets that are still
       * believed to be connected.
       */
      const connectedFleets: Array<IoTFleet> = await IoTFleetService.findBy({
        query: {
          otelCollectorStatus: "connected",
        },
        select: {
          _id: true,
          lastSeenAt: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      if (connectedFleets.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const fleet of connectedFleets) {
        if (!fleet._id) {
          continue;
        }

        // Anchor the cutoff to this fleet's lastSeenAt (see header).
        const cutoff: Date = IoTDeviceService.getStaleThresholdDate(
          fleet.lastSeenAt || undefined,
        );

        try {
          totalDeleted += await IoTDeviceService.deleteStaleForFleet({
            iotFleetId: new ObjectID(fleet._id.toString()),
            olderThan: cutoff,
          });
        } catch (err) {
          logger.error(
            `IoT:CleanupStaleResources: stale inventory delete failed for fleet ${fleet._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `IoT:CleanupStaleResources: pruned ${totalDeleted} stale IoTDevice row(s) across ${connectedFleets.length} fleet(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `IoT:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
