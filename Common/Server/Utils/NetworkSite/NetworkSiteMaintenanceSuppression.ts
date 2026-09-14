import NetworkSiteService from "../../Services/NetworkSiteService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import QueryHelper from "../../Types/Database/QueryHelper";
import { MaintenanceEventWindow } from "../../../Utils/NetworkSite/SiteMaintenanceUtil";
import CaptureSpan from "../Telemetry/CaptureSpan";
import logger from "../Logger";

/*
 * Which NetworkSites a scheduled maintenance event is currently silencing,
 * and which windows to subtract from a site's uptime.
 *
 * Network sites are the one maintenance-attachable resource whose health is
 * COMPUTED rather than reported, so the monitor treatment - flip
 * `disableActiveMonitoringBecauseOfScheduledMaintenanceEvent` and let the
 * absence of new checks do the rest - does not transfer. A site under
 * maintenance keeps reporting the truth about itself; what changes is who
 * else has to listen:
 *
 *   - The site's OWN status is untouched. Someone looking at a unit during a
 *     planned outage needs to see it is down.
 *
 *   - Its devices stop voting in its ANCESTORS' rollups, so the region above
 *     it does not turn red for a cutover that was on the calendar. Because
 *     the ancestor never records the outage, its uptime needs no correction
 *     afterwards - which matters, since subtracting the window from the
 *     region's denominator instead would also erase any GENUINE failure that
 *     happened elsewhere in the region during the same hours.
 *
 *   - Its own uptime percentage excludes the window (see SiteUptimeUtil).
 */

/*
 * Ongoing-maintenance lookups are cached per project for a few seconds.
 *
 * recomputeRollupForSite runs once per site per rollup, and the stale-rollup
 * sweep walks up to five hundred sites in one pass; without this, each of
 * those pays two queries to learn the same thing about the same project. The
 * TTL is the entire staleness budget - a window that has just started takes
 * at most this long to begin suppressing, which is nothing next to the
 * five-minute sweep it is racing.
 */
const ONGOING_MAINTENANCE_CACHE_TTL_MS: number = 15 * 1000;

interface CacheEntry {
  expiresAtInMs: number;
  siteIds: Set<string>;
}

/*
 * Ceiling on cached projects. The map is keyed by project and each entry is a
 * set of site ids, so on a large multi-tenant install it would otherwise grow
 * to every project the process has ever rolled up and never shrink. Past this
 * many entries the expired ones are swept before another is added.
 */
const MAX_CACHED_PROJECTS: number = 512;

export default class NetworkSiteMaintenanceSuppression {
  private static cache: Map<string, CacheEntry> = new Map();

  /*
   * Bumped by every invalidateCache. A lookup captures it BEFORE its query
   * and refuses to write its answer back if it changed in the meantime.
   *
   * Without it the cache has a lost-update window exactly where it hurts: a
   * maintenance event flips state and calls invalidateCache while an
   * in-flight lookup is still awaiting the OLD answer, that lookup then
   * stores the stale set, and the window it was supposed to start (or stop)
   * is wrong for a further full TTL.
   */
  private static generation: number = 0;

  /*
   * Ids of every site currently inside an ongoing maintenance window,
   * expanded downward: attaching a Region yields the Region and every Market
   * and Unit beneath it.
   *
   * Returns an empty set - without touching the hierarchy at all - when the
   * project has no ongoing event, which is the overwhelmingly common case.
   */
  @CaptureSpan()
  public static async getSiteIdsUnderOngoingMaintenance(
    projectId: ObjectID,
  ): Promise<Set<string>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = this.cache.get(cacheKey);
    const nowInMs: number = OneUptimeDate.getCurrentDate().getTime();

    if (cached && cached.expiresAtInMs > nowInMs) {
      return cached.siteIds;
    }

    const generationAtStart: number = this.generation;

    let siteIds: Set<string> = new Set<string>();

    try {
      siteIds = await this.resolveSiteIdsUnderOngoingMaintenance(projectId);
    } catch (err) {
      /*
       * A rollup must not fail because the maintenance lookup did. Falling
       * back to "nothing is under maintenance" reproduces the behaviour from
       * before this feature existed, which is the safe direction: a site may
       * briefly turn red for planned work, rather than a real outage going
       * unnoticed.
       */
      logger.error(
        `NetworkSiteMaintenanceSuppression: could not resolve ongoing maintenance for project ${cacheKey}; treating nothing as suppressed.`,
      );
      logger.error(err);
      return new Set<string>();
    }

    /*
     * Someone invalidated while this query was in flight, so the answer in
     * hand is already known to be stale. Serve it to this caller (it is no
     * worse than what they would have got a moment earlier) but do not
     * install it, so the next caller re-reads.
     */
    if (this.generation === generationAtStart) {
      this.sweepIfCrowded();
      this.cache.set(cacheKey, {
        /*
         * Measured from AFTER the query, not before it. A slow query would
         * otherwise burn most of its own TTL before the entry was written.
         */
        expiresAtInMs:
          OneUptimeDate.getCurrentDate().getTime() +
          ONGOING_MAINTENANCE_CACHE_TTL_MS,
        siteIds: siteIds,
      });
    }

    return siteIds;
  }

  // Drop expired entries once the map has grown past its ceiling.
  private static sweepIfCrowded(): void {
    if (this.cache.size < MAX_CACHED_PROJECTS) {
      return;
    }

    const nowInMs: number = OneUptimeDate.getCurrentDate().getTime();

    for (const [key, entry] of this.cache) {
      if (entry.expiresAtInMs <= nowInMs) {
        this.cache.delete(key);
      }
    }

    /*
     * Everything was still live. Entries are a few seconds old at most, so
     * clearing is cheap and bounded — far better than growing without limit.
     */
    if (this.cache.size >= MAX_CACHED_PROJECTS) {
      this.cache.clear();
    }
  }

  /*
   * Drops the cached answer for a project. Called when an event changes
   * state, so a window that has just started or ended takes effect on the
   * very next rollup instead of up to a TTL later.
   */
  public static invalidateCache(projectId?: ObjectID | undefined): void {
    /*
     * Bumped before the delete so a lookup that is mid-flight right now is
     * refused its write-back too, not just future ones.
     */
    this.generation++;

    if (!projectId) {
      this.cache.clear();
      return;
    }
    this.cache.delete(projectId.toString());
  }

  /*
   * Every maintenance event in the project that OVERLAPS [windowStart,
   * windowEnd), as the interval math needs it: the declared window plus the
   * sites attached to it.
   *
   * The declared `startsAt`/`endsAt` are used rather than the state
   * timeline's actual ongoing/ended transitions. They are what the user
   * scheduled and what the event page shows, so the uptime number can be
   * reconciled by hand against the calendar; deriving it from transitions
   * would make the excluded interval depend on when a worker happened to run.
   */
  @CaptureSpan()
  public static async getMaintenanceEventWindows(data: {
    projectId: ObjectID;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<MaintenanceEventWindow>> {
    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: data.projectId,
          startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
          endsAt: QueryHelper.greaterThanOrNull(data.windowStart),
        },
        select: {
          _id: true,
          startsAt: true,
          endsAt: true,
          networkSites: {
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return this.toEventWindows(events);
  }

  /*
   * Shared shaping step: an event with no sites attached is dropped, because
   * it excludes nothing and would only make the caller's loops longer.
   */
  public static toEventWindows(
    events: Array<ScheduledMaintenance>,
  ): Array<MaintenanceEventWindow> {
    const windows: Array<MaintenanceEventWindow> = [];

    for (const event of events) {
      if (!event.startsAt) {
        continue;
      }

      const siteIds: Array<string> = (event.networkSites || [])
        .map((site: { _id?: string | undefined }) => {
          return site._id ? String(site._id) : "";
        })
        .filter((id: string) => {
          return id.length > 0;
        });

      if (siteIds.length === 0) {
        continue;
      }

      windows.push({
        startsAt: event.startsAt,
        endsAt: event.endsAt || null,
        siteIds: siteIds,
      });
    }

    return windows;
  }

  private static async resolveSiteIdsUnderOngoingMaintenance(
    projectId: ObjectID,
  ): Promise<Set<string>> {
    const ongoingEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: projectId,
          currentScheduledMaintenanceState: {
            isOngoingState: true,
          },
        },
        select: {
          _id: true,
          networkSites: {
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const attachedSiteIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const event of ongoingEvents) {
      for (const site of event.networkSites || []) {
        if (!site._id) {
          continue;
        }
        const id: string = String(site._id);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        attachedSiteIds.push(new ObjectID(id));
      }
    }

    if (attachedSiteIds.length === 0) {
      return new Set<string>();
    }

    return NetworkSiteService.getSubtreeSiteIds({
      siteIds: attachedSiteIds,
      projectId: projectId,
    });
  }
}
