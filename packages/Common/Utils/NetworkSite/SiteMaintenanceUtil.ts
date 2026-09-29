import MaterializedPathUtil from "./MaterializedPathUtil";
import { SiteMaintenanceWindow } from "./SiteUptimeUtil";

/*
 * Which scheduled maintenance windows cover which NetworkSite.
 *
 * Attachment is INHERITED DOWNWARD: a window attached to a Region covers
 * every Market and Unit beneath it. That is the only arrangement a franchise
 * estate can actually use - a regional carrier cutover would otherwise mean
 * naming four hundred stores one at a time, and any store added between
 * scheduling the window and running it would be missed.
 *
 * It is emphatically NOT inherited upward. A window on one Unit does not
 * put its Region "under maintenance": the region is still expected to be up,
 * and a genuine outage in a different unit during the same hours must still
 * count against it. What the unit's window does to its ancestors is
 * narrower and handled elsewhere - the unit's devices stop voting in their
 * rollups, so the planned outage never reaches the region's timeline in the
 * first place.
 *
 * Pure: the callers on both sides of the wire (the hierarchy API and the
 * dashboard) resolve coverage with this same function against rows they
 * fetched themselves.
 */

// One maintenance event, reduced to what coverage and uptime math need.
export interface MaintenanceEventWindow {
  startsAt: Date;
  // Null for an event with no declared end - treated as still running.
  endsAt: Date | null;
  // Ids of the sites attached directly to the event.
  siteIds: Array<string>;
}

export class SiteMaintenanceUtil {
  /*
   * The windows that cover one site: those attached to the site itself, and
   * those attached to any of its ancestors.
   *
   * Ancestry is read off the site's materialized path, whose segments are
   * exactly its ancestor ids followed by its own. A site with no path (never
   * placed in the hierarchy, or mid-repair) still matches windows attached
   * to it directly - `siteId` is checked on its own rather than trusted to
   * appear in the path.
   */
  public static windowsCoveringSite(data: {
    siteId: string;
    materializedPath?: string | null | undefined;
    events: Array<MaintenanceEventWindow>;
  }): Array<SiteMaintenanceWindow> {
    const coveringIds: Set<string> = new Set<string>([data.siteId]);

    for (const segment of MaterializedPathUtil.segmentsOf(
      data.materializedPath,
    )) {
      coveringIds.add(segment);
    }

    const windows: Array<SiteMaintenanceWindow> = [];

    for (const event of data.events) {
      if (!SiteMaintenanceUtil.intersects(event.siteIds, coveringIds)) {
        continue;
      }

      windows.push({
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      });
    }

    return windows;
  }

  /*
   * The same resolution for many sites at once, keyed by site id. Sites with
   * no covering window are present in the map with an empty array, so a
   * caller can tell "resolved, nothing covers it" from "never looked".
   */
  public static windowsBySite(data: {
    sites: Array<{ id: string; materializedPath?: string | null | undefined }>;
    events: Array<MaintenanceEventWindow>;
  }): Map<string, Array<SiteMaintenanceWindow>> {
    const bySite: Map<string, Array<SiteMaintenanceWindow>> = new Map();

    for (const site of data.sites) {
      bySite.set(
        site.id,
        SiteMaintenanceUtil.windowsCoveringSite({
          siteId: site.id,
          materializedPath: site.materializedPath,
          events: data.events,
        }),
      );
    }

    return bySite;
  }

  private static intersects(values: Array<string>, set: Set<string>): boolean {
    for (const value of values) {
      if (set.has(value)) {
        return true;
      }
    }
    return false;
  }
}

export default SiteMaintenanceUtil;
