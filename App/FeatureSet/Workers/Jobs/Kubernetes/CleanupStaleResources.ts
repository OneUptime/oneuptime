import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import KubernetesResourceChangeEventService from "Common/Server/Services/KubernetesResourceChangeEventService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * Kubernetes:CleanupStaleResources
 *
 * Runs every 5 minutes. Three steps:
 *   1. Mark clusters as disconnected if they have not been seen for
 *      15 minutes (existing KubernetesClusterService method; 3x the
 *      ingest maintenance fence TTL so healthy clusters never flap).
 *   2. Prune KubernetesResourceChangeEvent rows older than the
 *      retention window (default 30 days, min 1; env
 *      K8S_CHANGE_EVENT_RETENTION_DAYS). Runs across all clusters,
 *      connected or not — old timeline rows are dead weight either way.
 *   3. For each CONNECTED cluster, hard-delete KubernetesResource
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
      /*
       * Step 1: flip stale clusters to disconnected so step 2 skips
       * them. This was previously dormant — this cron is the first
       * scheduled caller.
       */
      try {
        await KubernetesClusterService.markDisconnectedClusters();
      } catch (err) {
        logger.error(
          `CleanupStaleResources: markDisconnectedClusters failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune old workload-timeline change events. Sits before
       * the connected-cluster early return on purpose — retention must
       * keep running even when every cluster is disconnected.
       */
      try {
        const retentionCutoff: Date =
          KubernetesResourceChangeEventService.getRetentionCutoffDate();
        const deletedEvents: number =
          await KubernetesResourceChangeEventService.deleteOlderThan({
            olderThan: retentionCutoff,
          });
        if (deletedEvents > 0) {
          logger.debug(
            `CleanupStaleResources: pruned ${deletedEvents} KubernetesResourceChangeEvent row(s) older than ${KubernetesResourceChangeEventService.getRetentionDays()} day(s)`,
          );
        }
      } catch (err) {
        logger.error(
          `CleanupStaleResources: change-event retention delete failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 3: prune stale resource rows for clusters that are still
       * believed to be connected.
       */
      const connectedClusters: Array<KubernetesCluster> =
        await KubernetesClusterService.findBy({
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
      let totalContainersDeleted: number = 0;
      for (const cluster of connectedClusters) {
        if (!cluster._id) {
          continue;
        }

        const clusterId: ObjectID = new ObjectID(cluster._id.toString());

        /*
         * Anchor the prune cutoff to the cluster's own lastSeenAt, not
         * wall-clock now. Resource rows refresh on the 5-minute
         * snapshot clock while cluster.lastSeenAt is fence-gated
         * telemetry, so at agent death the rows are ~5 minutes staler
         * than the cluster record. With the disconnect threshold
         * (15 min) equal to the prune threshold, a wall-clock cutoff
         * would let a cron run during minutes ~10-15 of an outage wipe
         * the last-known inventory of a still-"connected" cluster.
         * Anchoring to lastSeenAt freezes the cutoff during an outage.
         */
        const cutoff: Date = KubernetesResourceService.getStaleThresholdDate(
          cluster.lastSeenAt || undefined,
        );

        try {
          const deleted: number =
            await KubernetesResourceService.deleteStaleForCluster({
              kubernetesClusterId: clusterId,
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `CleanupStaleResources: deleteStaleForCluster failed for cluster ${cluster._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        try {
          const deletedContainers: number =
            await KubernetesContainerService.deleteStaleForCluster({
              kubernetesClusterId: clusterId,
              olderThan: cutoff,
            });
          totalContainersDeleted += deletedContainers;
        } catch (err) {
          logger.error(
            `CleanupStaleResources: container deleteStaleForCluster failed for cluster ${cluster._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0 || totalContainersDeleted > 0) {
        logger.debug(
          `CleanupStaleResources: pruned ${totalDeleted} stale KubernetesResource row(s) and ${totalContainersDeleted} KubernetesContainer row(s) across ${connectedClusters.length} cluster(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
