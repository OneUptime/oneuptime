import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerResourceService, {
  DockerHostInventoryCounts,
} from "Common/Server/Services/DockerResourceService";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * Docker:CleanupStaleResources
 *
 * Runs every 5 minutes. Two responsibilities:
 *
 *   1. Hard-delete DockerResource rows whose last snapshot is older
 *      than the stale threshold. Skipping disconnected hosts is
 *      deliberate — a transient agent outage shouldn't wipe the
 *      last-known inventory.
 *
 *   2. Refresh DockerHost.containersRunning / Stopped / Paused from
 *      the live inventory so the Hosts list and Docker Hosts widget
 *      show accurate numbers without doing a SQL aggregation per
 *      render.
 *
 * Marking disconnected hosts is the responsibility of an existing
 * cron (DockerHostService.markDisconnectedHosts). That runs in a
 * different worker; here we just respect the resulting status.
 * ------------------------------------------------------------------
 */

RunCron(
  "Docker:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      try {
        await DockerHostService.markDisconnectedHosts();
      } catch (err) {
        logger.error(
          `Docker:CleanupStaleResources: markDisconnectedHosts failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const connectedHosts: Array<DockerHost> = await DockerHostService.findBy({
        query: {
          otelCollectorStatus: "connected",
        },
        select: {
          _id: true,
          projectId: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      if (connectedHosts.length === 0) {
        return;
      }

      const cutoff: Date = DockerResourceService.getStaleThresholdDate();

      let totalDeleted: number = 0;
      for (const host of connectedHosts) {
        if (!host._id || !host.projectId) {
          continue;
        }

        const hostId: ObjectID = new ObjectID(host._id.toString());
        const projectId: ObjectID = new ObjectID(host.projectId.toString());

        try {
          const deleted: number =
            await DockerResourceService.deleteStaleForHost({
              dockerHostId: hostId,
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `Docker:CleanupStaleResources: deleteStaleForHost failed for host ${host._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        try {
          const counts: DockerHostInventoryCounts =
            await DockerResourceService.getContainerCountsForHost({
              projectId,
              dockerHostId: hostId,
            });

          await DockerHostService.updateOneById({
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
            `Docker:CleanupStaleResources: cached count refresh failed for host ${host._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `Docker:CleanupStaleResources: pruned ${totalDeleted} stale DockerResource row(s) across ${connectedHosts.length} host(s) (cutoff ${cutoff.toISOString()})`,
        );
      }
    } catch (err) {
      logger.error(
        `Docker:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
