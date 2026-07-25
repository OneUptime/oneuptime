import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";

/*
 * Cron backstop for the event-driven network-site rollup engine.
 *
 * Rollups are normally recomputed when a monitor status change stamps a
 * device or when a device changes site, but the freshness fallback (devices
 * with no monitor going stale after 15 minutes without SNMP contact)
 * produces NO event - only the passage of time changes the answer. This job
 * sweeps sites whose rollup has not run recently (or ever) so that drift is
 * bounded.
 *
 * Each stale site is recomputed individually (not with its ancestors): a
 * stale ancestor matches the same query and is picked up in the same sweep,
 * so recomputing chains here would only redo work. Oldest rollups go first
 * and the sweep is capped, so a large install converges over a few runs
 * instead of hammering the database in one.
 */
const STALE_AFTER_MINUTES: number = 10;
const MAX_SITES_PER_RUN: number = 500;

RunCron(
  "NetworkSite:RecomputeStaleRollups",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    const staleSites: Array<NetworkSite> = await NetworkSiteService.findBy({
      query: {
        lastRollupAt: QueryHelper.lessThanOrNull(
          OneUptimeDate.getSomeMinutesAgo(STALE_AFTER_MINUTES),
        ),
      },
      select: {
        _id: true,
      },
      sort: {
        lastRollupAt: SortOrder.Ascending,
      },
      limit: MAX_SITES_PER_RUN,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (staleSites.length === 0) {
      return;
    }

    logger.debug(
      `RecomputeStaleRollups: recomputing ${staleSites.length} stale network site rollup(s).`,
    );

    for (const site of staleSites) {
      if (!site.id) {
        continue;
      }

      try {
        await NetworkSiteService.recomputeRollupForSite(site.id);
      } catch (error) {
        // One broken site must not starve the rest of the sweep.
        logger.error(
          `RecomputeStaleRollups: failed to recompute rollup for network site ${site.id.toString()}: ${error}`,
        );
      }
    }
  },
);
