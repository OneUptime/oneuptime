import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import ProxmoxResourceService from "Common/Server/Services/ProxmoxResourceService";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";

/*
 * ------------------------------------------------------------------
 * Proxmox:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark clusters as disconnected if they have not been seen for
 *      5 minutes (ProxmoxClusterService.markDisconnectedClusters —
 *      this cron is its only scheduled caller). Net SLA: ingest bumps
 *      lastSeenAt at most ~5 minutes behind real traffic (Redis
 *      maintenance fence) + the 5-minute disconnect threshold inside
 *      markDisconnectedClusters ⇒ the list-page status pill flips to
 *      Disconnected ≤ ~10 minutes after the agent dies.
 *   2. For each CONNECTED cluster, hard-delete ProxmoxResource
 *      inventory rows whose last snapshot is older than the stale
 *      threshold (default 15 minutes = 3x the snapshot interval;
 *      override with PVE_INVENTORY_STALE_MINUTES, minimum 5).
 *
 * Skipping disconnected clusters is deliberate: during a transient
 * agent outage we want to preserve the last-known inventory rather
 * than wipe the overview page. When the agent reconnects, the next
 * snapshot refreshes lastSeenAt and the rows become live again.
 * ------------------------------------------------------------------
 */

function getStaleThresholdDate(): Date {
  let minutes: number = 15;

  const raw: string | undefined = process.env["PVE_INVENTORY_STALE_MINUTES"];
  if (raw) {
    const parsed: number = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 5) {
      minutes = parsed;
    }
  }

  return OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.getCurrentDate(),
    -minutes,
  );
}

RunCron(
  "Proxmox:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      /*
       * Step 1: flip stale clusters to disconnected so step 2 skips
       * them.
       */
      try {
        await ProxmoxClusterService.markDisconnectedClusters();
      } catch (err) {
        logger.error(
          `Proxmox:CleanupStaleResources: markDisconnectedClusters failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale inventory rows for clusters that are
       * still believed to be connected.
       */
      const connectedClusters: Array<ProxmoxCluster> =
        await ProxmoxClusterService.findBy({
          query: {
            otelCollectorStatus: "connected",
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      if (connectedClusters.length === 0) {
        return;
      }

      const cutoff: Date = getStaleThresholdDate();

      let totalDeleted: number = 0;
      for (const cluster of connectedClusters) {
        if (!cluster._id) {
          continue;
        }

        const clusterId: ObjectID = new ObjectID(cluster._id.toString());

        try {
          // Batched delete loop so a huge stale backlog never holds one giant transaction.
          let deleted: number = 0;
          do {
            deleted = await ProxmoxResourceService.hardDeleteBy({
              query: {
                proxmoxClusterId: clusterId,
                lastSeenAt: QueryHelper.lessThan(cutoff),
              },
              limit: LIMIT_MAX,
              skip: 0,
              props: { isRoot: true },
            });
            totalDeleted += deleted;
          } while (deleted > 0);
        } catch (err) {
          logger.error(
            `Proxmox:CleanupStaleResources: stale inventory delete failed for cluster ${cluster._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `Proxmox:CleanupStaleResources: pruned ${totalDeleted} stale ProxmoxResource row(s) across ${connectedClusters.length} cluster(s) (cutoff ${cutoff.toISOString()})`,
        );
      }
    } catch (err) {
      logger.error(
        `Proxmox:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
