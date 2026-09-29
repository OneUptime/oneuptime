import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import logger from "Common/Server/Utils/Logger";

/*
 * Cron backstop for the event-driven network-site rollup engine.
 *
 * Rollups are normally recomputed when a monitor status change stamps a
 * device or when a device changes site, but the freshness fallback (a device
 * with no recorded poll outcome going stale) produces NO event — only the
 * passage of time changes the answer. This job sweeps sites whose rollup has
 * not run recently (or ever) so that drift is bounded.
 *
 * Each stale site is recomputed individually (not with its ancestors): a
 * stale ancestor matches the same query and is picked up in the same sweep,
 * so recomputing chains here would only redo work. Oldest rollups go first
 * and the sweep is capped, so a large install converges over a few runs
 * instead of hammering the database in one.
 */
const STALE_AFTER_MINUTES: number = 10;
const MAX_SITES_PER_RUN: number = 500;

// Wall-clock budget of one sweep, mirrored by the job's own timeoutInMS.
const SWEEP_TIMEOUT_MINUTES: number = 4;

/*
 * Redis mutex that serializes the whole sweep across every worker replica —
 * the same arrangement, for the same reason, as the auto-import sweep next
 * door. RunCron has no overlap guard, and a sweep of 500 sites is several
 * queries per site: at any real estate size a run can outlive its five-minute
 * schedule, and the next tick then selects THE SAME 500 sites, because none
 * of them has had `lastRollupAt` stamped yet. Two runs recomputing the same
 * site race the timeline's close-open pair in
 * NetworkSiteService.recomputeRollupForSite and can leave two open rows for
 * one transition.
 *
 * The lock timeout outlives the job timeout so an overrunning sweep keeps
 * holding the lock rather than letting a second sweep in behind it;
 * redis-semaphore auto-refreshes a held lock, so the value only bounds how
 * long a CRASHED worker's lock lingers.
 */
const SWEEP_LOCK_KEY: string = "NetworkSite:RecomputeStaleRollups";
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
const SWEEP_LOCK_TIMEOUT_MS: number = 5 * 60 * 1000;

RunCron(
  "NetworkSite:RecomputeStaleRollups",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      SWEEP_TIMEOUT_MINUTES,
    ),
  },
  async () => {
    /*
     * acquireAttemptsLimit: 1 — never queue behind the in-flight sweep. The
     * job re-runs every five minutes anyway; skipping is the correct
     * backpressure.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: SWEEP_LOCK_KEY,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `NetworkSite:RecomputeStaleRollups - Could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this tick: ${err}`,
      );
      return;
    }

    try {
      /*
       * Sites that have NEVER been rolled up go first, and that ordering is
       * load-bearing.
       *
       * `lastRollupAt IS NULL` is a brand-new site, and Postgres sorts NULLs
       * LAST in an ascending order — so a plain `lastRollupAt ASC` put the
       * one site that has never had a verdict behind every site that merely
       * has an old one. Past MAX_SITES_PER_RUN stale sites, which is any real
       * estate, a new site would never reach the front of the queue and would
       * never get its first rollup at all.
       *
       * Two passes rather than one clever ORDER BY: the never-rolled-up set
       * is small and drains immediately, and each query keeps a shape the
       * `lastRollupAt` index can serve.
       */
      const neverRolledUp: Array<NetworkSite> = await NetworkSiteService.findBy(
        {
          query: {
            lastRollupAt: QueryHelper.isNull(),
          },
          select: {
            _id: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
          limit: MAX_SITES_PER_RUN,
          skip: 0,
          props: {
            isRoot: true,
          },
        },
      );

      const remaining: number = MAX_SITES_PER_RUN - neverRolledUp.length;

      const staleSites: Array<NetworkSite> =
        remaining > 0
          ? await NetworkSiteService.findBy({
              query: {
                lastRollupAt: QueryHelper.lessThan(
                  OneUptimeDate.getSomeMinutesAgo(STALE_AFTER_MINUTES),
                ),
              },
              select: {
                _id: true,
              },
              sort: {
                lastRollupAt: SortOrder.Ascending,
              },
              limit: remaining,
              skip: 0,
              props: {
                isRoot: true,
              },
            })
          : [];

      const sitesToRecompute: Array<NetworkSite> = [
        ...neverRolledUp,
        ...staleSites,
      ];

      if (sitesToRecompute.length === 0) {
        return;
      }

      logger.debug(
        `RecomputeStaleRollups: recomputing ${sitesToRecompute.length} network site rollup(s) (${neverRolledUp.length} never rolled up).`,
      );

      /*
       * The deadline is what keeps the sweep inside its schedule on an estate
       * bigger than one run can cover. Stopping early is safe and self
       * correcting: nothing has been half-written, and the sites left behind
       * are still the oldest, so the next tick picks up exactly where this one
       * stopped. Running past the schedule would instead hand the next tick
       * the same 500 sites this one is still working through.
       */
      const deadline: number =
        Date.now() +
        OneUptimeDate.convertMinutesToMilliseconds(SWEEP_TIMEOUT_MINUTES) * 0.8;

      let recomputed: number = 0;

      for (const site of sitesToRecompute) {
        if (!site.id) {
          continue;
        }

        if (Date.now() > deadline) {
          logger.debug(
            `RecomputeStaleRollups: stopping after ${recomputed} of ${sitesToRecompute.length} site(s) — out of time for this sweep. The rest are still the oldest and lead the next one.`,
          );
          break;
        }

        try {
          await NetworkSiteService.recomputeRollupForSite(site.id);
          recomputed++;
        } catch (error) {
          // One broken site must not starve the rest of the sweep.
          logger.error(
            `RecomputeStaleRollups: failed to recompute rollup for network site ${site.id.toString()}: ${error}`,
          );
        }
      }
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(
          `NetworkSite:RecomputeStaleRollups - Failed to release the sweep lock: ${err}`,
        );
      }
    }
  },
);
