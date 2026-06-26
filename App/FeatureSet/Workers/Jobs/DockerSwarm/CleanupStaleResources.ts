import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import DockerSwarmResourceService from "Common/Server/Services/DockerSwarmResourceService";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * DockerSwarm:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark clusters as disconnected if they have not been seen for
 *      15 minutes (DockerSwarmClusterService.markDisconnectedClusters —
 *      this cron is its only scheduled caller). The threshold is 3x
 *      the ingest maintenance fence TTL: lastSeenAt is legitimately up
 *      to ~5 minutes stale during continuous telemetry (Redis fence),
 *      so a threshold equal to the fence flaps healthy clusters
 *      between connected and disconnected. Net SLA: the list-page
 *      status pill flips to Disconnected ≤ ~20 minutes after the agent
 *      dies.
 *   2. For each CONNECTED cluster, hard-delete DockerSwarmResource
 *      inventory rows whose last snapshot is older than the stale
 *      threshold. Threshold and delete both live in
 *      DockerSwarmResourceService (getStaleThresholdDate /
 *      deleteStaleForCluster — default 15 minutes = 3x the snapshot
 *      interval; override with PVE_INVENTORY_STALE_MINUTES, minimum
 *      5) so this cron carries no duplicate policy. The cutoff is
 *      anchored to each cluster's own lastSeenAt rather than wall-clock
 *      now: inventory rows ride the slower snapshot clock, so with the
 *      disconnect and prune thresholds both at 15 minutes a wall-clock
 *      cutoff could wipe the last-known inventory of a still-connected
 *      cluster late in an outage. Anchoring freezes the prune clock.
 *
 * Skipping disconnected clusters is deliberate: during a transient
 * agent outage we want to preserve the last-known inventory rather
 * than wipe the overview page. When the agent reconnects, the next
 * snapshot refreshes lastSeenAt and the rows become live again.
 * ------------------------------------------------------------------
 */

RunCron(
  "DockerSwarm:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      /*
       * Step 1: flip stale clusters to disconnected so step 2 skips
       * them.
       */
      try {
        await DockerSwarmClusterService.markDisconnectedClusters();
      } catch (err) {
        logger.error(
          `DockerSwarm:CleanupStaleResources: markDisconnectedClusters failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale inventory rows for clusters that are
       * still believed to be connected.
       */
      const connectedClusters: Array<DockerSwarmCluster> =
        await DockerSwarmClusterService.findBy({
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

      if (connectedClusters.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const cluster of connectedClusters) {
        if (!cluster._id) {
          continue;
        }

        // Anchor the cutoff to this cluster's lastSeenAt (see header).
        const cutoff: Date = DockerSwarmResourceService.getStaleThresholdDate(
          cluster.lastSeenAt || undefined,
        );

        try {
          totalDeleted +=
            await DockerSwarmResourceService.deleteStaleForCluster({
              dockerSwarmClusterId: new ObjectID(cluster._id.toString()),
              olderThan: cutoff,
            });
        } catch (err) {
          logger.error(
            `DockerSwarm:CleanupStaleResources: stale inventory delete failed for cluster ${cluster._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `DockerSwarm:CleanupStaleResources: pruned ${totalDeleted} stale DockerSwarmResource row(s) across ${connectedClusters.length} cluster(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `DockerSwarm:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
