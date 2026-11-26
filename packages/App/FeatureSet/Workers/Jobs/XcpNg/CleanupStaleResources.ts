import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import XcpNgPoolService from "Common/Server/Services/XcpNgPoolService";
import XcpNgResourceService from "Common/Server/Services/XcpNgResourceService";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * XcpNg:CleanupStaleResources
 *
 * Runs every 5 minutes, as Proxmox:CleanupStaleResources does. Two steps:
 *   1. Mark pools Disconnected when they have not been READ for 15 minutes
 *      (XcpNgPoolService.markDisconnectedPools - this cron is its only
 *      scheduled caller). A pool is read when Xen Orchestra reports it, so a
 *      pool Xen Orchestra lost turns Disconnected while its Xen Orchestra's
 *      other pools carry on.
 *   2. For each CONNECTED pool, delete the XcpNgResource rows its reads
 *      stopped reporting (a host removed from the pool, a deleted VM,
 *      storage repository or virtual disk), with a cutoff anchored on the
 *      pool's own lastSeenAt (XcpNgResourceService.getStaleThresholdDate),
 *      never the whole inventory at once (deleteStaleForPool).
 *
 * Skipping disconnected pools is deliberate: a pool Xen Orchestra lost
 * keeps its last-known inventory, shown as last known, instead of an empty
 * page. Stopping a VM never removes it: Xen Orchestra reports a halted VM's
 * status on every scrape.
 * ------------------------------------------------------------------
 */

RunCron(
  "XcpNg:CleanupStaleResources",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      try {
        await XcpNgPoolService.markDisconnectedPools();
      } catch (err) {
        logger.error(
          `XcpNg:CleanupStaleResources: markDisconnectedPools failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const connectedPools: Array<XcpNgPool> = await XcpNgPoolService.findBy({
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

      let totalDeleted: number = 0;
      for (const pool of connectedPools) {
        if (!pool._id || !pool.projectId) {
          continue;
        }

        const cutoff: Date = XcpNgResourceService.getStaleThresholdDate(
          pool.lastSeenAt || undefined,
        );

        try {
          totalDeleted += await XcpNgResourceService.deleteStaleForPool({
            projectId: pool.projectId,
            xcpNgPoolId: new ObjectID(pool._id.toString()),
            olderThan: cutoff,
          });
        } catch (err) {
          logger.error(
            `XcpNg:CleanupStaleResources: stale inventory delete failed for XCP-ng pool ${pool._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `XcpNg:CleanupStaleResources: pruned ${totalDeleted} stale XcpNgResource row(s) across ${connectedPools.length} pool(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `XcpNg:CleanupStaleResources cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
