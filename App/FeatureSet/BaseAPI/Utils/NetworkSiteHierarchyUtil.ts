import NetworkSiteType from "Common/Types/NetworkSite/NetworkSiteType";

/*
 * Pure aggregation logic behind the /network-site/children endpoint.
 * Everything here is plain data-in/data-out so the breadcrumb ordering,
 * unit rollups, device counting and link filtering are unit-testable
 * without a database. The API layer fetches rows (one batch query per
 * model) and hands them to these helpers.
 */

// One crumb of the root-first ancestor chain shown above the drill-down.
export interface BreadcrumbEntry {
  id: string;
  name: string;
  siteType: string;
}

// A directly-returned child of the requested site.
export interface ChildSiteRow {
  id: string;
  siteType: string;
  currentMonitorStatusId?: string | undefined;
}

/*
 * Any site inside the requested site's subtree (children included — the
 * aggregator skips rows whose id is itself a child). parentSiteId drives
 * direct-child counts; materializedPath decides which child's subtree the
 * row belongs to.
 */
export interface SubtreeSiteRow {
  id: string;
  siteType: string;
  parentSiteId?: string | undefined;
  materializedPath?: string | undefined;
  currentMonitorStatusId?: string | undefined;
}

export interface UnitStats {
  totalUnits: number;
  operationalUnits: number;
}

export interface ChildAggregate {
  childSiteCount: number;
  deviceCount: number;
  unitStats: UnitStats;
}

export interface SiteLinkRow {
  id: string;
  name?: string | undefined;
  fromSiteId?: string | undefined;
  toSiteId?: string | undefined;
  monitorId?: string | undefined;
}

export const DEFAULT_UPTIME_WINDOW_DAYS: number = 30;
export const MAX_UPTIME_WINDOW_DAYS: number = 90;
export const MIN_UPTIME_WINDOW_DAYS: number = 1;

export default class NetworkSiteHierarchyUtil {
  /*
   * Normalizes the caller-supplied uptime window: default 30 days, clamped
   * to [1, 90]. Anything that is not a finite number (including numeric
   * strings — the API is JSON, numbers arrive as numbers) falls back to
   * the default rather than failing the whole drill-down.
   */
  public static clampUptimeWindowDays(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_UPTIME_WINDOW_DAYS;
    }
    const rounded: number = Math.round(value);
    if (rounded < MIN_UPTIME_WINDOW_DAYS) {
      return MIN_UPTIME_WINDOW_DAYS;
    }
    if (rounded > MAX_UPTIME_WINDOW_DAYS) {
      return MAX_UPTIME_WINDOW_DAYS;
    }
    return rounded;
  }

  /*
   * Splits a materialized path ('/rootId/childId/') into its ordered,
   * root-first ancestor ids. The path stores ancestors only, but some
   * writers include the site's own id as the last segment — drop it (and
   * any duplicates) defensively so the breadcrumb never repeats the site.
   */
  public static parseAncestorIds(
    materializedPath: string | undefined,
    selfId: string,
  ): Array<string> {
    if (!materializedPath) {
      return [];
    }
    const seen: Set<string> = new Set<string>();
    const ids: Array<string> = [];
    for (const segment of materializedPath.split("/")) {
      if (!segment || segment === selfId || seen.has(segment)) {
        continue;
      }
      seen.add(segment);
      ids.push(segment);
    }
    return ids;
  }

  /*
   * Root-first breadcrumb for the requested site: every ancestor from the
   * materialized path that resolved to a real row (missing ones — e.g.
   * deleted ancestors — are skipped, keeping order), then the site itself
   * as the last crumb.
   */
  public static buildBreadcrumb(
    site: {
      id: string;
      name: string;
      siteType: string;
      materializedPath?: string | undefined;
    },
    ancestorsById: Map<string, BreadcrumbEntry>,
  ): Array<BreadcrumbEntry> {
    const breadcrumb: Array<BreadcrumbEntry> = [];
    for (const ancestorId of NetworkSiteHierarchyUtil.parseAncestorIds(
      site.materializedPath,
      site.id,
    )) {
      const ancestor: BreadcrumbEntry | undefined =
        ancestorsById.get(ancestorId);
      if (ancestor) {
        breadcrumb.push(ancestor);
      }
    }
    breadcrumb.push({
      id: site.id,
      name: site.name,
      siteType: site.siteType,
    });
    return breadcrumb;
  }

  // ' / '-joined ancestor names for the map view, root-first.
  public static buildParentBreadcrumbString(
    materializedPath: string | undefined,
    selfId: string,
    nameById: Map<string, string>,
  ): string {
    const names: Array<string> = [];
    for (const ancestorId of NetworkSiteHierarchyUtil.parseAncestorIds(
      materializedPath,
      selfId,
    )) {
      const name: string | undefined = nameById.get(ancestorId);
      if (name) {
        names.push(name);
      }
    }
    return names.join(" / ");
  }

  /*
   * Per-child rollups computed from one pass over the subtree rows and the
   * device→site attachments:
   *
   * - childSiteCount: direct children of the child (rows whose
   *   parentSiteId is the child).
   * - unitStats: Unit-type descendants in the child's subtree, counted
   *   operational when their status id is in operationalStatusIds. A child
   *   that IS a Unit reports exactly itself (1/1 or 1/0) — its own
   *   descendants, if any, don't add.
   * - deviceCount: devices attached to the child itself or to any site in
   *   its subtree.
   *
   * A subtree row belongs to the child whose id appears in its
   * materialized path (children are siblings, so at most one matches);
   * rows without a usable path fall back to direct parentSiteId matching.
   */
  public static aggregateChildStats(data: {
    children: Array<ChildSiteRow>;
    descendants: Array<SubtreeSiteRow>;
    deviceSiteIds: Array<string>;
    operationalStatusIds: Set<string>;
  }): Map<string, ChildAggregate> {
    const childIds: Set<string> = new Set<string>();
    const childTypeById: Map<string, string> = new Map<string, string>();
    const result: Map<string, ChildAggregate> = new Map<
      string,
      ChildAggregate
    >();

    for (const child of data.children) {
      childIds.add(child.id);
      childTypeById.set(child.id, child.siteType);
      const isUnit: boolean = child.siteType === NetworkSiteType.Unit;
      const isOperational: boolean = Boolean(
        child.currentMonitorStatusId &&
          data.operationalStatusIds.has(child.currentMonitorStatusId),
      );
      result.set(child.id, {
        childSiteCount: 0,
        deviceCount: 0,
        unitStats: {
          totalUnits: isUnit ? 1 : 0,
          operationalUnits: isUnit && isOperational ? 1 : 0,
        },
      });
    }

    // siteId -> the child whose subtree it belongs to (children map to themselves).
    const subtreeRootBySiteId: Map<string, string> = new Map<string, string>();
    for (const childId of childIds) {
      subtreeRootBySiteId.set(childId, childId);
    }

    for (const row of data.descendants) {
      if (childIds.has(row.id)) {
        // The child rows themselves — already seeded above.
        continue;
      }

      let subtreeRoot: string | undefined = undefined;
      if (row.materializedPath) {
        for (const segment of row.materializedPath.split("/")) {
          if (segment && childIds.has(segment)) {
            subtreeRoot = segment;
            break;
          }
        }
      }
      if (!subtreeRoot && row.parentSiteId && childIds.has(row.parentSiteId)) {
        subtreeRoot = row.parentSiteId;
      }
      if (subtreeRoot) {
        subtreeRootBySiteId.set(row.id, subtreeRoot);
      }

      if (row.parentSiteId) {
        const parentAggregate: ChildAggregate | undefined = result.get(
          row.parentSiteId,
        );
        if (parentAggregate) {
          parentAggregate.childSiteCount += 1;
        }
      }

      if (
        subtreeRoot &&
        row.siteType === NetworkSiteType.Unit &&
        childTypeById.get(subtreeRoot) !== NetworkSiteType.Unit
      ) {
        const aggregate: ChildAggregate = result.get(subtreeRoot)!;
        aggregate.unitStats.totalUnits += 1;
        if (
          row.currentMonitorStatusId &&
          data.operationalStatusIds.has(row.currentMonitorStatusId)
        ) {
          aggregate.unitStats.operationalUnits += 1;
        }
      }
    }

    for (const deviceSiteId of data.deviceSiteIds) {
      const subtreeRoot: string | undefined =
        subtreeRootBySiteId.get(deviceSiteId);
      if (subtreeRoot) {
        const aggregate: ChildAggregate | undefined = result.get(subtreeRoot);
        if (aggregate) {
          aggregate.deviceCount += 1;
        }
      }
    }

    return result;
  }

  /*
   * Only links whose BOTH endpoints are among the returned children are
   * drawable on the drill-down canvas; everything else (links to sites at
   * other levels, dangling endpoints) is dropped.
   */
  public static filterLinksBetweenChildren(
    links: Array<SiteLinkRow>,
    childIds: Set<string>,
  ): Array<SiteLinkRow> {
    return links.filter((link: SiteLinkRow) => {
      return Boolean(
        link.fromSiteId &&
          link.toSiteId &&
          childIds.has(link.fromSiteId) &&
          childIds.has(link.toSiteId),
      );
    });
  }
}
