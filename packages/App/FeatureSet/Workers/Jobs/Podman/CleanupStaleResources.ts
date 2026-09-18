import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import PodmanResourceService, {
  PodmanHostInventoryCounts,
} from "Common/Server/Services/PodmanResourceService";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * Podman:CleanupStaleResources
 *
 * Runs every 5 minutes. Two responsibilities:
 *
 *   1. Hard-delete PodmanResource rows whose last snapshot is older
 *      than the stale threshold. Skipping disconnected hosts is
 *      deliberate — a transient agent outage shouldn't wipe the
 *      last-known inventory.
 *
 *   2. Refresh PodmanHost.containersRunning / Stopped / Paused from
 *      the live inventory so the Hosts list and Podman Hosts widget
 *      show accurate numbers without doing a SQL aggregation per
 *      render.
 *
 * Marking disconnected hosts happens first in this cron via
 * PodmanHostService.markDisconnectedHosts, so the inventory pruning
 * below respects the freshly updated status.
 * ------------------------------------------------------------------
 */

RunCron(
  "Podman:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      try {
        await PodmanHostService.markDisconnectedHosts();
      } catch (err) {
        logger.error(
          `Podman:CleanupStaleResources: markDisconnectedHosts failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const connectedHosts: Array<PodmanHost> = await PodmanHostService.findBy({
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

      if (connectedHosts.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const host of connectedHosts) {
        if (!host._id || !host.projectId) {
          continue;
        }

        const hostId: ObjectID = new ObjectID(host._id.toString());
        const projectId: ObjectID = new ObjectID(host.projectId.toString());

        /*
         * Anchor the prune cutoff to the host's own lastSeenAt, not
         * wall-clock now. Inventory rows refresh on the snapshot clock
         * while host.lastSeenAt is fence-gated telemetry, so at agent
         * death the rows are staler than the host record. With the
         * disconnect threshold (15 min) equal to the prune threshold,
         * a wall-clock cutoff would let a cron run late in an outage
         * wipe the last-known inventory (and zero the cached container
         * counts) of a still-"connected" host. Anchoring to lastSeenAt
         * freezes the cutoff during an outage.
         */
        const cutoff: Date = PodmanResourceService.getStaleThresholdDate(
          host.lastSeenAt || undefined,
        );

        try {
          const deleted: number =
            await PodmanResourceService.deleteStaleForHost({
              podmanHostId: hostId,
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `Podman:CleanupStaleResources: deleteStaleForHost failed for host ${host._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        try {
          const counts: PodmanHostInventoryCounts =
            await PodmanResourceService.getContainerCountsForHost({
              projectId,
              podmanHostId: hostId,
            });

          await PodmanHostService.updateOneById({
            id: hostId,
            data: {
              containersRunning: counts.containersRunning,
              containersStopped: counts.containersStopped,
              containersPaused: counts.containersPaused,
            },
            props: { isRoot: true },
          });
        } catch (err) {
          logger.error(
            `Podman:CleanupStaleResources: cached count refresh failed for host ${host._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `Podman:CleanupStaleResources: pruned ${totalDeleted} stale PodmanResource row(s) across ${connectedHosts.length} host(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `Podman:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
