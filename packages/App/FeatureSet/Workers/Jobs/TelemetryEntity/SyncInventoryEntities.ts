import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import {
  InventorySyncPassResult,
  syncAllInventorySources,
} from "Common/Server/Utils/Telemetry/InventoryEntityRegistry";

/*
 * InventoryItem:SyncInventoryEntities
 *
 * Projects OneUptime's poller-collected inventory tables (network devices,
 * cloud resources, serverless functions, RUM applications, IoT devices,
 * Docker and Podman hosts) into the InventoryItem registry, so the entity
 * explorer covers the whole estate rather than only the parts that speak
 * OTLP. See InventoryEntityRegistry for why this is a periodic reconcile
 * instead of create/delete hooks on each of the seven tables.
 *
 * Fifteen minutes is chosen against what the sweep costs rather than how
 * fresh the data needs to be: it reads every row of seven tables. Inventory
 * changes when a human registers or decommissions something, so nothing here
 * is latency-sensitive, and a shorter period would buy responsiveness nobody
 * is waiting on at a cost that scales with estate size.
 *
 * Not run on startup, so a fleet-wide restart does not have every worker
 * begin a full estate scan at once.
 *
 * Its time limit is just under its period, rather than the five minutes a job
 * gets by default: the pass checks its deadline before every page and stops
 * there, and a pass cut short at five minutes on a large estate would read
 * the same first pages every time. A pass that does stop keeps what it
 * wrote, and the next one reads past it without writing.
 */
export const SYNC_INVENTORY_ENTITIES_TIME_LIMIT_MS: number = 14 * 60 * 1000;

RunCron(
  "TelemetryEntity:SyncInventoryEntities",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: SYNC_INVENTORY_ENTITIES_TIME_LIMIT_MS,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const result: InventorySyncPassResult =
        await syncAllInventorySources(deadline);

      if (result.stoppedAtDeadline) {
        logger.debug(
          "SyncInventoryEntities: the pass reached its time limit and stopped; the next pass carries on.",
        );
      }

      if (
        result.created > 0 ||
        result.updated > 0 ||
        result.deleted > 0 ||
        result.archived > 0
      ) {
        /*
         * Archived is reported apart from removed because the two are
         * different events: a removal is a projection catching up with a row
         * that no longer exists, while an archive is the sweep declining to
         * delete because the row was carrying custom field values someone
         * entered. A non-zero archive count is the trail for "where did my
         * decommissioned device's asset data go".
         */
        logger.debug(
          `SyncInventoryEntities: mirrored inventory into the entity registry — ${result.created} created, ${result.updated} updated, ${result.deleted} removed, ${result.archived} archived.`,
        );
      }
    } catch (err) {
      logger.error(
        `SyncInventoryEntities cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
