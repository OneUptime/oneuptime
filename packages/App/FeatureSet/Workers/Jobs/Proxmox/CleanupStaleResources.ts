import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import ProxmoxResourceService from "Common/Server/Services/ProxmoxResourceService";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * Proxmox:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark clusters as disconnected if they have not been seen for
 *      15 minutes (ProxmoxClusterService.markDisconnectedClusters —
 *      this cron is its only scheduled caller). The threshold is 3x
 *      the ingest maintenance fence TTL: lastSeenAt is legitimately up
 *      to ~5 minutes stale during continuous telemetry (Redis fence),
 *      so a threshold equal to the fence flaps healthy clusters
 *      between connected and disconnected. Net SLA: the list-page
 *      status pill flips to Disconnected ≤ ~20 minutes after the agent
 *      dies.
 *   2. For each CONNECTED cluster, hard-delete ProxmoxResource
 *      inventory rows whose last snapshot is older than the stale
 *      threshold. Threshold and delete both live in
 *      ProxmoxResourceService (getStaleThresholdDate /
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
 *
 * One kind of row outlives the cutoff on purpose: a Node that reports
 * itself over the Proxmox VE native OpenTelemetry push (isNativePush).
 * There every node pushes only its own status and nothing in the push
 * says which nodes the cluster has, so the Node rows ARE the cluster's
 * membership — the roster (ProxmoxResourceService.getNodeRoster) from
 * which the nodes still alive report the ones that went quiet, and the
 * ingest flush marks those Offline
 * (ProxmoxResourceService.markNodesNotReporting: isUp = false, never
 * lastSeenAt). A node that dies just stops refreshing its row; were
 * step 2 to prune that row at the normal cutoff, the node would drop
 * off the roster, never be reported down, and its Node Offline alert
 * would resolve. So deleteStaleForCluster keeps a native-push Node row
 * for the retention window whatever its state — marked Offline or not
 * yet. Not yet is the case that matters: a node that died just before
 * or during a OneUptime ingest outage, or failed to boot after the
 * whole cluster lost power, is only marked once the nodes that are
 * back have pushed for two minutes, while the first push after an
 * outage long enough to turn the cluster Disconnected reconnects it
 * with a fresh lastSeenAt (so the anchored cutoff jumps past the
 * node's last push) — a tick in those two minutes must not drop it.
 * The keep rule lives in the service, not here: this cron still hands
 * over only the cluster id and the anchored cutoff, and the retention
 * cutoff is the service's own, on the wall clock
 * (ProxmoxResourceService.getSilentNodeRetentionCutoff, the same one
 * the roster uses). The row stops being kept when the node comes back
 * (its own push makes the row live again), when it has been silent
 * for longer than the retention window (7 days by default,
 * PVE_SILENT_NODE_RETENTION_HOURS — see
 * ProxmoxResourceService.getSilentNodeRetentionHours; it drops off the
 * roster then too, so its siblings stop reporting it, and the first
 * connected tick afterwards prunes it), or when a user removes it
 * (ProxmoxResourceService.removeOfflineNode deletes the Offline row
 * outright). None of this holds while silent-node detection is switched
 * off (PVE_NATIVE_NODE_SILENCE_DETECTION=false): nothing marks a silent
 * node Offline then, so a kept row would show a dead node Online for the
 * whole window — deleteStaleForCluster drops the keep and prunes a
 * native-push Node row at the stale cutoff like every other row, as
 * before. Everything else keeps the 15-minute prune, Offline or
 * not: a Node row the native push did not write last — the agent's
 * (isNativePush false; pve-exporter asks the cluster about every node,
 * so a Node row it stops refreshing belongs to a node that left the
 * cluster) or one untouched since before the column existed (NULL) —
 * and every guest and storage row, native push or not. A whole cluster
 * (or a standalone host) going dark has nobody left to report: it
 * turns Disconnected in step 1 and keeps its inventory as above.
 * ------------------------------------------------------------------
 */

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
        const cutoff: Date = ProxmoxResourceService.getStaleThresholdDate(
          cluster.lastSeenAt || undefined,
        );

        try {
          totalDeleted += await ProxmoxResourceService.deleteStaleForCluster({
            proxmoxClusterId: new ObjectID(cluster._id.toString()),
            olderThan: cutoff,
          });
        } catch (err) {
          logger.error(
            `Proxmox:CleanupStaleResources: stale inventory delete failed for cluster ${cluster._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `Proxmox:CleanupStaleResources: pruned ${totalDeleted} stale ProxmoxResource row(s) across ${connectedClusters.length} cluster(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `Proxmox:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
