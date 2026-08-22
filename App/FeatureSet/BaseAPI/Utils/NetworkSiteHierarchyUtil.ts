import {
  DeviceHealthCounts,
  NetworkDeviceHealthState,
  addDeviceHealth,
  emptyDeviceHealthCounts,
} from "Common/Utils/NetworkDevice/DeviceHealthStateUtil";

/*
 * Pure aggregation logic behind the /network-site/children endpoint.
 * Everything here is plain data-in/data-out so the breadcrumb ordering,
 * unit rollups, device counting and link filtering are unit-testable
 * without a database. The API layer fetches rows (one batch query per
 * model) and hands them to these helpers.
 *
 * siteType is carried through as a plain display string (the configured
 * NetworkSiteType's name) — every consumer of these DTOs only renders it.
 * isUnitLevel is the load-bearing half: site types are per-project rows a
 * customer can rename at will, so no logic here may compare siteType to a
 * literal like "Unit". The leaf-level decision always keys off the flag
 * the type row carries.
 */

// One crumb of the root-first ancestor chain shown above the drill-down.
export interface BreadcrumbEntry {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
}

// A directly-returned child of the requested site.
export interface ChildSiteRow {
  id: string;
  siteType: string;
  isUnitLevel: boolean;
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
  isUnitLevel: boolean;
  parentSiteId?: string | undefined;
  materializedPath?: string | undefined;
  currentMonitorStatusId?: string | undefined;
}

export interface UnitStats {
  totalUnits: number;
  operationalUnits: number;
}

/*
 * One device attachment fed to the aggregator: which site it hangs off,
 * and how healthy it is.
 *
 * The health verdict is computed once per device by the API layer (see
 * DeviceHealthStateUtil) rather than in here, so this stays a pure
 * bucketing pass with no clock in it — the same reason every other helper
 * in this file takes resolved facts rather than model rows.
 */
export interface DeviceAttachmentRow {
  siteId: string;
  healthState: NetworkDeviceHealthState;
}

export interface ChildAggregate {
  childSiteCount: number;
  deviceCount: number;
  /*
   * The device health of the child's whole subtree — issue #3320's "which
   * SITES hold a device that needs attention", answered per row so the
   * level can be filtered without loading a single device node.
   *
   * `deviceStats.total` and `deviceCount` are always the same number.
   * Both are kept because they are read by different things: the card
   * prints a count, the filter reads a breakdown, and collapsing them
   * would make every existing consumer reach through a nested object for
   * one integer.
   */
  deviceStats: DeviceHealthCounts;
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

/*
 * Longest search text /network-site/search will act on. A site's name is a
 * ShortText column, so nothing longer than this could match a row anyway —
 * the cap is there to keep an unbounded caller-supplied string out of the
 * ILIKE pattern the query builds from it.
 */
export const MAX_SEARCH_TEXT_LENGTH: number = 200;

// A row the search endpoint has to print the path to.
export interface SearchPathRow {
  id: string;
  materializedPath?: string | undefined;
}

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
      isUnitLevel: boolean;
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
      isUnitLevel: site.isUnitLevel,
    });
    return breadcrumb;
  }

  /*
   * Normalizes the caller-supplied search text. A non-string, or a string
   * that is blank once trimmed, reads as NO SEARCH — which the endpoint
   * answers with an empty result rather than with the whole project: an
   * empty box must not be the query that returns everything.
   *
   * The length cap is applied after trimming (see MAX_SEARCH_TEXT_LENGTH).
   */
  public static normalizeSearchText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim().slice(0, MAX_SEARCH_TEXT_LENGTH);
  }

  /*
   * Every ancestor id the given rows reference, deduplicated, minus the ones
   * the caller already holds rows for.
   *
   * A search answers with matches from anywhere in the hierarchy, and each
   * one has to print the path to it — so the names of their ancestors have
   * to be resolved. Collecting the ids first is what keeps that to ONE extra
   * query for the whole result set instead of one walk per hit.
   */
  public static collectAncestorIds(
    rows: Array<SearchPathRow>,
    knownIds: Set<string>,
  ): Array<string> {
    const ancestorIds: Set<string> = new Set<string>();
    for (const row of rows) {
      for (const ancestorId of NetworkSiteHierarchyUtil.parseAncestorIds(
        row.materializedPath,
        row.id,
      )) {
        if (!knownIds.has(ancestorId)) {
          ancestorIds.add(ancestorId);
        }
      }
    }
    return Array.from(ancestorIds);
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
   * - unitStats: unit-level descendants in the child's subtree — rows whose
   *   site type is flagged isUnitLevel, never rows whose type happens to be
   *   named "Unit" — counted operational when their status id is in
   *   operationalStatusIds. A child that IS unit-level reports exactly
   *   itself (1/1 or 1/0); its own descendants, if any, don't add.
   * - deviceCount / deviceStats: devices attached to the child itself or to
   *   any site in its subtree, tallied by health so the level can answer
   *   "which of these holds something that needs attention".
   *
   * A subtree row belongs to the child whose id appears in its
   * materialized path (children are siblings, so at most one matches);
   * rows without a usable path fall back to direct parentSiteId matching.
   */
  public static aggregateChildStats(data: {
    children: Array<ChildSiteRow>;
    descendants: Array<SubtreeSiteRow>;
    devices: Array<DeviceAttachmentRow>;
    operationalStatusIds: Set<string>;
  }): Map<string, ChildAggregate> {
    const childIds: Set<string> = new Set<string>();
    const childIsUnitLevelById: Map<string, boolean> = new Map<
      string,
      boolean
    >();
    const result: Map<string, ChildAggregate> = new Map<
      string,
      ChildAggregate
    >();

    for (const child of data.children) {
      childIds.add(child.id);
      childIsUnitLevelById.set(child.id, child.isUnitLevel);
      const isUnit: boolean = child.isUnitLevel;
      const isOperational: boolean = Boolean(
        child.currentMonitorStatusId &&
          data.operationalStatusIds.has(child.currentMonitorStatusId),
      );
      result.set(child.id, {
        childSiteCount: 0,
        deviceCount: 0,
        deviceStats: emptyDeviceHealthCounts(),
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
        row.isUnitLevel &&
        !childIsUnitLevelById.get(subtreeRoot)
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

    for (const device of data.devices) {
      const subtreeRoot: string | undefined = subtreeRootBySiteId.get(
        device.siteId,
      );
      if (subtreeRoot) {
        const aggregate: ChildAggregate | undefined = result.get(subtreeRoot);
        if (aggregate) {
          aggregate.deviceCount += 1;
          addDeviceHealth(aggregate.deviceStats, device.healthState);
        }
      }
    }

    return result;
  }

  /*
   * Device health for one explicit set of sites — not a subtree.
   *
   * The drill-down needs this for the level the user is standing ON, which
   * aggregateChildStats deliberately says nothing about: a site can hold
   * devices of its own AND have children under it (a distribution centre
   * with its own core switches above a dozen stores), and those devices
   * belong to no child's subtree. Before this they were simply invisible —
   * counted nowhere and drawn nowhere.
   */
  public static tallyDeviceHealth(
    devices: Array<DeviceAttachmentRow>,
    siteIds: Set<string>,
  ): DeviceHealthCounts {
    const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
    for (const device of devices) {
      if (siteIds.has(device.siteId)) {
        addDeviceHealth(counts, device.healthState);
      }
    }
    return counts;
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
