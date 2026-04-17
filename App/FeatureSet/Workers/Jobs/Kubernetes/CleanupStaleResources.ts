import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * Kubernetes:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark clusters as disconnected if they have not been seen for
 *      5 minutes (existing KubernetesClusterService method).
 *   2. For each CONNECTED cluster, hard-delete KubernetesResource
 *      rows whose last snapshot is older than the stale threshold
 *      (default 15 minutes = 3x snapshot interval).
 *
 * Skipping disconnected clusters is deliberate: during a transient
 * agent outage we want to preserve the last-known inventory rather
 * than wipe the overview page. When the agent reconnects, the next
 * snapshot refreshes lastSeenAt and the rows become live again.
 * ------------------------------------------------------------------
 */

RunCron(
  "Kubernetes:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      // Step 1: flip stale clusters to disconnected so step 2 skips
      // them. This was previously dormant — this cron is the first
      // scheduled caller.
      try {
        await KubernetesClusterService.markDisconnectedClusters();
      } catch (err) {
        logger.error(
          `CleanupStaleResources: markDisconnectedClusters failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Step 2: prune stale resource rows for clusters that are still
      // believed to be connected.
      const connectedClusters: Array<KubernetesCluster> =
        await KubernetesClusterService.findBy({
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

      const cutoff: Date =
        KubernetesResourceService.getStaleThresholdDate();

      let totalDeleted: number = 0;
      for (const cluster of connectedClusters) {
        if (!cluster._id) {
          continue;
        }

        try {
          const deleted: number =
            await KubernetesResourceService.deleteStaleForCluster({
              kubernetesClusterId: new ObjectID(cluster._id.toString()),
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `CleanupStaleResources: deleteStaleForCluster failed for cluster ${cluster._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `CleanupStaleResources: pruned ${totalDeleted} stale KubernetesResource row(s) across ${connectedClusters.length} cluster(s) (cutoff ${cutoff.toISOString()})`,
        );
      }
    } catch (err) {
      logger.error(
        `CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
