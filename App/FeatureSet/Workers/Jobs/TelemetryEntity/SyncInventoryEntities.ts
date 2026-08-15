import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import {
  InventorySyncResult,
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
 */

RunCron(
  "TelemetryEntity:SyncInventoryEntities",
  { schedule: EVERY_FIFTEEN_MINUTE, runOnStartup: false },
  async () => {
    try {
      const result: InventorySyncResult = await syncAllInventorySources();

      if (result.created > 0 || result.updated > 0 || result.deleted > 0) {
        logger.debug(
          `SyncInventoryEntities: mirrored inventory into the entity registry — ${result.created} created, ${result.updated} updated, ${result.deleted} removed.`,
        );
      }
    } catch (err) {
      logger.error(
        `SyncInventoryEntities cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
