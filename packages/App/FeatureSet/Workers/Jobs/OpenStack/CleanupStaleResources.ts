import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import OpenStackResourceService from "Common/Server/Services/OpenStackResourceService";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * OpenStack:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark clouds as disconnected if they have not been seen for 15 minutes
 *      (OpenStackCloudService.markDisconnectedClouds: this cron is its only
 *      scheduled caller).
 *   2. For each CONNECTED cloud, remove the parts that have really gone
 *      (OpenStackResourceService.deleteStaleForCloud). A part is gone only when
 *      its own service's scrape succeeded without it: a failing Nova is not a Nova
 *      with no instances, so a cloud in trouble keeps its inventory, which is when
 *      people need it most.
 *
 * Skipping disconnected clouds is deliberate: during an agent outage we keep the
 * last-known inventory rather than wipe the Overview. When the agent reconnects,
 * the next snapshot makes the rows live again.
 * ------------------------------------------------------------------
 */

RunCron(
  "OpenStack:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      try {
        await OpenStackCloudService.markDisconnectedClouds();
      } catch (err) {
        logger.error(
          `OpenStack:CleanupStaleResources: markDisconnectedClouds failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const connectedClouds: Array<OpenStackCloud> =
        await OpenStackCloudService.findBy({
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

      let totalDeleted: number = 0;
      for (const cloud of connectedClouds) {
        if (!cloud._id || !cloud.projectId) {
          continue;
        }

        try {
          totalDeleted += await OpenStackResourceService.deleteStaleForCloud({
            projectId: cloud.projectId,
            openStackCloudId: new ObjectID(cloud._id.toString()),
          });
        } catch (err) {
          logger.error(
            `OpenStack:CleanupStaleResources: stale inventory delete failed for cloud ${cloud._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `OpenStack:CleanupStaleResources: removed ${totalDeleted} OpenStackResource row(s) across ${connectedClouds.length} cloud(s).`,
        );
      }
    } catch (err) {
      logger.error(
        `OpenStack:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
