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
 * Runs every 5 minutes. Three steps:
 *   1. Mark fleets as disconnected if they have not been seen for
 *      15 minutes (IoTFleetService.markDisconnectedFleets — this cron
 *      is its only scheduled caller). The threshold is 3x the ingest
 *      maintenance fence TTL: lastSeenAt is legitimately up to ~5
 *      minutes stale during continuous telemetry (Redis fence), so a
 *      threshold equal to the fence flaps healthy fleets between
 *      connected and disconnected. Net SLA: the list-page status pill
 *      flips to Disconnected ≤ ~20 minutes after the agent dies.
 *   2. For each CONNECTED fleet, walk IoTDevice inventory rows whose
 *      last snapshot is older than the stale threshold to the Stale
 *      lifecycle state (rows are never hard-deleted — a silent device
 *      stays visible instead of vanishing). Threshold and transition
 *      both live in IoTDeviceService (getStaleThresholdDate /
 *      markStaleForFleet — default 15 minutes = 3x the snapshot
 *      interval; override with IOT_INVENTORY_STALE_MINUTES, minimum 5)
 *      so this cron carries no duplicate policy. The cutoff is anchored
 *      to each fleet's own lastSeenAt rather than wall-clock now:
 *      inventory rows ride the slower snapshot clock, so with the
 *      disconnect and stale thresholds both at 15 minutes a wall-clock
 *      cutoff could mass-stale the last-known inventory of a
 *      still-connected fleet late in an outage. Anchoring freezes the
 *      staleness clock.
 *   3. For EVERY fleet, walk devices silent past the retirement
 *      threshold (IOT_INVENTORY_RETIRE_DAYS, default 30) to Retired.
 *      Retired rows are kept for history but drop out of counts and
 *      default lists. This pass runs for disconnected fleets too — a
 *      month of silence is a decommissioned device either way, and
 *      the cutoff is wall-clock because at that scale snapshot-clock
 *      lag is noise.
 *
 * Skipping disconnected fleets in step 2 is deliberate: during a
 * transient agent outage we want to preserve the last-known inventory
 * rather than mass-stale the overview page. When the agent reconnects,
 * the next snapshot refreshes lastSeenAt and the upsert walks the rows
 * straight back to Online/Offline.
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
       * Step 2: walk stale inventory rows to Stale for fleets that
       * are still believed to be connected.
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

      let totalStaled: number = 0;
      for (const fleet of connectedFleets) {
        if (!fleet._id) {
          continue;
        }

        // Anchor the cutoff to this fleet's lastSeenAt (see header).
        const cutoff: Date = IoTDeviceService.getStaleThresholdDate(
          fleet.lastSeenAt || undefined,
        );

        try {
          totalStaled += await IoTDeviceService.markStaleForFleet({
            iotFleetId: new ObjectID(fleet._id.toString()),
            olderThan: cutoff,
          });
        } catch (err) {
          logger.error(
            `IoT:CleanupStaleResources: stale transition failed for fleet ${fleet._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalStaled > 0) {
        logger.debug(
          `IoT:CleanupStaleResources: marked ${totalStaled} IoTDevice row(s) Stale across ${connectedFleets.length} connected fleet(s)`,
        );
      }

      /*
       * Step 3: retirement pass over every fleet (connected or not —
       * see header). Wall-clock cutoff.
       */
      const allFleets: Array<IoTFleet> = await IoTFleetService.findBy({
        query: {},
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      const retireCutoff: Date = IoTDeviceService.getRetireThresholdDate();
      let totalRetired: number = 0;
      for (const fleet of allFleets) {
        if (!fleet._id) {
          continue;
        }

        try {
          totalRetired += await IoTDeviceService.retireStaleForFleet({
            iotFleetId: new ObjectID(fleet._id.toString()),
            olderThan: retireCutoff,
          });
        } catch (err) {
          logger.error(
            `IoT:CleanupStaleResources: retirement pass failed for fleet ${fleet._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalRetired > 0) {
        logger.debug(
          `IoT:CleanupStaleResources: retired ${totalRetired} IoTDevice row(s) across ${allFleets.length} fleet(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `IoT:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
