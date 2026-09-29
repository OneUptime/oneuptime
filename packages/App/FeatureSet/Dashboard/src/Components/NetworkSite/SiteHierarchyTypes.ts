import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  DeviceHealthCounts,
  emptyDeviceHealthCounts,
} from "Common/Utils/NetworkDevice/DeviceHealthStateUtil";

/*
 * Pure, react-free client-side shapes for the Network Site hierarchy
 * endpoints (/network-site/children and /network-site/map), plus the
 * narrowing parsers that turn untyped API payloads into them.
 *
 * Kept out of the components so the parsing can be imported (and
 * unit-tested) in a plain Node/TypeScript environment — see
 * Geo/GeoProjection.ts for why. The parsers are defensive the same way
 * NetworkTopologyLiveView's parseTopologyResponse is: malformed rows are
 * dropped, missing scalars fall back to safe defaults, and nothing here
 * ever throws on bad data.
 *
 * Every row that carries a siteType also carries isUnitLevel. siteType is
 * only ever DISPLAYED — it is the name of a per-project NetworkSiteType row,
 * which a customer can rename to "Store" or "Restaurant" at will — so no
 * consumer may branch on it. isUnitLevel is the flag the leaf-level logic
 * keys off (NetworkMap opens a unit's device topology instead of a child-site
 * graph). It defaults to false: an unflagged or legacy row is a container,
 * which degrades to the drill-down view rather than to a topology of nothing.
 */

// Reduced MonitorStatus row attached to a child site.
export interface SiteStatusInfo {
  id: string;
  name: string;
  color: string | undefined;
  priority: number;
  isOperationalState: boolean;
}

export interface SiteBreadcrumbEntry {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
}

export interface SiteUnitStats {
  totalUnits: number;
  operationalUnits: number;
}

// One child row of /network-site/children.
export interface SiteChildView {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
  currentMonitorStatus: SiteStatusInfo | undefined;
  childSiteCount: number;
  deviceCount: number;
  /*
   * The health of every device in this child's subtree (issue #3320).
   * `deviceStats.total` is always `deviceCount` — see ChildAggregate on the
   * server for why both are carried.
   *
   * Never undefined on the client even against a server that predates it:
   * the parser falls back to a zeroed tally, which reads as "this level has
   * nothing to say about devices" rather than crashing every consumer that
   * indexes into it.
   */
  deviceStats: DeviceHealthCounts;
  unitStats: SiteUnitStats;
  uptimePercent: number | null;
  /*
   * The same measurement over the last 24 hours. A bad day inside an
   * otherwise healthy month barely moves the 30-day figure, so the card
   * carries both. Null on a server that predates it, and on a site with no
   * rollup history at all — the same absence the 30-day figure reports.
   */
  dailyUptimePercent: number | null;
  /*
   * Whether a scheduled maintenance window covers this site right now
   * (attached to it, or to any of its ancestors). The site's status is NOT
   * suppressed during one, so this is the only thing distinguishing planned
   * work from a real outage on the card.
   */
  isUnderMaintenance: boolean;
}

/*
 * How the project's devices divide between the hierarchy and everything
 * outside it — what the topology explorer reads to decide whether a
 * hierarchy is worth showing at all.
 *
 * `attachedDeviceCount` of zero is the whole reason this exists: a project
 * that models sites but has never set a device's site has a hierarchy of
 * empty rooms, and drilling through it to reach an always-empty topology is
 * strictly worse than the flat map it replaced.
 */
export interface SiteDeviceScope {
  attachedDeviceCount: number;
  unattachedDeviceCount: number;
}

export interface SiteLinkStatusInfo {
  name: string;
  color: string | undefined;
  priority: number;
}

// One link row of /network-site/children (links between the listed children).
export interface SiteLinkView {
  id: string;
  name: string;
  fromSiteId: string | undefined;
  toSiteId: string | undefined;
  monitorStatus: SiteLinkStatusInfo | undefined;
}

export interface SiteChildrenResponse {
  // Root-first; the LAST entry is the requested site itself.
  breadcrumb: Array<SiteBreadcrumbEntry>;
  children: Array<SiteChildView>;
  links: Array<SiteLinkView>;
  /*
   * Devices attached to the level in view ITSELF, not to any of its
   * children. Zeroed at the root, which has no site of its own.
   */
  ownDeviceStats: DeviceHealthCounts;
  deviceScope: SiteDeviceScope;
  childrenTruncated: boolean;
  descendantCountsTruncated: boolean;
}

/*
 * How the map is showing the level in view:
 *
 *   grouped — one marker per child of this level, the same set the cards
 *             below it list. A container child with no coordinates of its
 *             own sits at the centroid of the sites beneath it.
 *   all     — every located site in this level's subtree, individually.
 *
 * Grouped is the default because it is the only one of the two that can
 * answer "what does my network look like": the flat view turns a franchise
 * estate into proximity blobs whose counts match nothing anybody named.
 */
export type SiteMapMode = "grouped" | "all";

// One marker row of /network-site/map.
export interface MapSiteView {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
  latitude: number;
  longitude: number;
  statusPriority: number;
  isOperational: boolean | null;
  parentBreadcrumb: string;
  /*
   * This marker stands for a level of the hierarchy rather than for one
   * place — it is drawn as a container, and clicking it drills.
   */
  isContainer: boolean;
  // The position is the centroid of what is beneath it, not its own pin.
  isDerivedLocation: boolean;
  locatedDescendantCount: number;
  unlocatedDescendantCount: number;
  totalUnits: number;
  operationalUnits: number;
  childSiteCount: number;
}

/*
 * A child of this level that has no place on the map: neither it nor
 * anything beneath it carries coordinates. Reported rather than dropped —
 * a region missing from the map while its card sits right underneath is a
 * bug report waiting to happen.
 */
export interface MapUnplacedSiteView {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
}

/*
 * One link row of /network-site/map: a site link the map can draw as a
 * LINE, because both of its ends have a marker on it.
 *
 * monitorStatus is optional by design. A link with no monitor attached is
 * still part of the network's shape and is still drawn — the monitor only
 * decides what color the line is.
 */
export interface MapLinkView {
  id: string;
  name: string;
  fromSiteId: string;
  toSiteId: string;
  monitorStatus: SiteLinkStatusInfo | undefined;
}

export interface SiteMapResponse {
  mode: SiteMapMode;
  sites: Array<MapSiteView>;
  links: Array<MapLinkView>;
  unplacedSites: Array<MapUnplacedSiteView>;
  isTruncated: boolean;
}

/*
 * One hit of /network-site/search — a site matched by name from anywhere in
 * the project, not just the level in view. `path` is what makes the hit
 * usable: two stores called "Michigan Ave" are told apart by the markets
 * above them, and it answers "where is this" without drilling.
 */
export interface SiteSearchResultView {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
  /** ' / '-joined ancestor names, root-first. Empty for a root site. */
  path: string;
  currentMonitorStatus: SiteStatusInfo | undefined;
}

export interface SiteSearchResponse {
  results: Array<SiteSearchResultView>;
  // The server capped the result set — there are more matches than these.
  isTruncated: boolean;
}

const asString: (value: unknown, fallback: string) => string = (
  value: unknown,
  fallback: string,
): string => {
  return typeof value === "string" && value ? value : fallback;
};

const asOptionalString: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" && value ? value : undefined;
};

const asFiniteNumber: (value: unknown, fallback: number) => number = (
  value: unknown,
  fallback: number,
): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const asRows: (value: unknown) => JSONArray = (value: unknown): JSONArray => {
  return Array.isArray(value) ? (value as JSONArray) : [];
};

const parseStatusInfo: (value: unknown) => SiteStatusInfo | undefined = (
  value: unknown,
): SiteStatusInfo | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const row: JSONObject = value as JSONObject;
  const id: string = asString(row["id"], "");
  if (!id) {
    return undefined;
  }
  return {
    id: id,
    name: asString(row["name"], "Unknown"),
    color: asOptionalString(row["color"]),
    priority: asFiniteNumber(row["priority"], 0),
    isOperationalState: row["isOperationalState"] === true,
  };
};

const parseBreadcrumbEntry: (value: unknown) => SiteBreadcrumbEntry | null = (
  value: unknown,
): SiteBreadcrumbEntry | null => {
  const row: JSONObject = (value || {}) as JSONObject;
  const id: string = asString(row["id"], "");
  if (!id) {
    return null;
  }
  return {
    id: id,
    name: asString(row["name"], "Unnamed site"),
    siteType: asString(row["siteType"], "Other"),
    isUnitLevel: row["isUnitLevel"] === true,
  };
};

/*
 * A device-health tally, narrowed defensively.
 *
 * Every field falls back to zero and `total` is CLAMPED UP to the sum of
 * the four states: a payload where they disagree (an older server, a
 * partial rollup) must not produce a card that reads "2 of 0 devices down",
 * which is the kind of number that makes an operator stop trusting the
 * page.
 */
const parseDeviceHealthCounts: (value: unknown) => DeviceHealthCounts = (
  value: unknown,
): DeviceHealthCounts => {
  const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }
  const row: JSONObject = value as JSONObject;
  counts.down = Math.max(0, asFiniteNumber(row["down"], 0));
  counts.degraded = Math.max(0, asFiniteNumber(row["degraded"], 0));
  counts.healthy = Math.max(0, asFiniteNumber(row["healthy"], 0));
  counts.unknown = Math.max(0, asFiniteNumber(row["unknown"], 0));
  counts.total = Math.max(
    asFiniteNumber(row["total"], 0),
    counts.down + counts.degraded + counts.healthy + counts.unknown,
  );
  return counts;
};

const parseChildRow: (value: unknown) => SiteChildView | null = (
  value: unknown,
): SiteChildView | null => {
  const row: JSONObject = (value || {}) as JSONObject;
  const id: string = asString(row["id"], "");
  if (!id) {
    return null;
  }
  const unitStatsRow: JSONObject = (row["unitStats"] || {}) as JSONObject;
  const rawUptime: unknown = row["uptimePercent"];
  const rawDailyUptime: unknown = row["dailyUptimePercent"];
  return {
    id: id,
    name: asString(row["name"], "Unnamed site"),
    siteType: asString(row["siteType"], "Other"),
    isUnitLevel: row["isUnitLevel"] === true,
    currentMonitorStatus: parseStatusInfo(row["currentMonitorStatus"]),
    childSiteCount: asFiniteNumber(row["childSiteCount"], 0),
    deviceCount: asFiniteNumber(row["deviceCount"], 0),
    deviceStats: parseDeviceHealthCounts(row["deviceStats"]),
    unitStats: {
      totalUnits: asFiniteNumber(unitStatsRow["totalUnits"], 0),
      operationalUnits: asFiniteNumber(unitStatsRow["operationalUnits"], 0),
    },
    uptimePercent:
      typeof rawUptime === "number" && Number.isFinite(rawUptime)
        ? rawUptime
        : null,
    dailyUptimePercent:
      typeof rawDailyUptime === "number" && Number.isFinite(rawDailyUptime)
        ? rawDailyUptime
        : null,
    isUnderMaintenance: row["isUnderMaintenance"] === true,
  };
};

/*
 * A link's status, or undefined when no monitor is attached to it. The
 * absent case is ordinary, not broken: most links in a fresh project have
 * no monitor yet, and every consumer draws them in a neutral color rather
 * than dropping them.
 */
const parseLinkStatus: (value: unknown) => SiteLinkStatusInfo | undefined = (
  value: unknown,
): SiteLinkStatusInfo | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const status: JSONObject = value as JSONObject;
  return {
    name: asString(status["name"], "Unknown"),
    color: asOptionalString(status["color"]),
    priority: asFiniteNumber(status["priority"], 0),
  };
};

const parseLinkRow: (value: unknown) => SiteLinkView | null = (
  value: unknown,
): SiteLinkView | null => {
  const row: JSONObject = (value || {}) as JSONObject;
  const id: string = asString(row["id"], "");
  if (!id) {
    return null;
  }
  return {
    id: id,
    name: asString(row["name"], "Unnamed link"),
    fromSiteId: asOptionalString(row["fromSiteId"]),
    toSiteId: asOptionalString(row["toSiteId"]),
    monitorStatus: parseLinkStatus(row["monitorStatus"]),
  };
};

/*
 * The map's link rows are stricter than the children endpoint's: a line
 * needs two ends, so a row missing either one is dropped here rather than
 * carried through the view model as an undrawable half-link.
 */
const parseMapLinkRow: (value: unknown) => MapLinkView | null = (
  value: unknown,
): MapLinkView | null => {
  const row: JSONObject = (value || {}) as JSONObject;
  const id: string = asString(row["id"], "");
  const fromSiteId: string = asString(row["fromSiteId"], "");
  const toSiteId: string = asString(row["toSiteId"], "");
  if (!id || !fromSiteId || !toSiteId) {
    return null;
  }
  return {
    id: id,
    name: asString(row["name"], "Unnamed link"),
    fromSiteId: fromSiteId,
    toSiteId: toSiteId,
    monitorStatus: parseLinkStatus(row["monitorStatus"]),
  };
};

/**
 * Narrow an untyped /network-site/children payload. Rows without an id are
 * dropped; missing flags default to false.
 */
export const parseSiteChildrenResponse: (
  data: JSONObject | undefined,
) => SiteChildrenResponse = (
  data: JSONObject | undefined,
): SiteChildrenResponse => {
  const breadcrumb: Array<SiteBreadcrumbEntry> = asRows(data?.["breadcrumb"])
    .map(parseBreadcrumbEntry)
    .filter(
      (entry: SiteBreadcrumbEntry | null): entry is SiteBreadcrumbEntry => {
        return entry !== null;
      },
    );
  const children: Array<SiteChildView> = asRows(data?.["children"])
    .map(parseChildRow)
    .filter((child: SiteChildView | null): child is SiteChildView => {
      return child !== null;
    });
  const links: Array<SiteLinkView> = asRows(data?.["links"])
    .map(parseLinkRow)
    .filter((link: SiteLinkView | null): link is SiteLinkView => {
      return link !== null;
    });
  const deviceScopeRow: JSONObject = (data?.["deviceScope"] ||
    {}) as JSONObject;
  return {
    breadcrumb: breadcrumb,
    children: children,
    links: links,
    ownDeviceStats: parseDeviceHealthCounts(data?.["ownDeviceStats"]),
    deviceScope: {
      attachedDeviceCount: Math.max(
        0,
        asFiniteNumber(deviceScopeRow["attachedDeviceCount"], 0),
      ),
      unattachedDeviceCount: Math.max(
        0,
        asFiniteNumber(deviceScopeRow["unattachedDeviceCount"], 0),
      ),
    },
    childrenTruncated: data?.["childrenTruncated"] === true,
    descendantCountsTruncated: data?.["descendantCountsTruncated"] === true,
  };
};

const parseSearchResultRow: (value: unknown) => SiteSearchResultView | null = (
  value: unknown,
): SiteSearchResultView | null => {
  const row: JSONObject = (value || {}) as JSONObject;
  const id: string = asString(row["id"], "");
  if (!id) {
    return null;
  }
  return {
    id: id,
    name: asString(row["name"], "Unnamed site"),
    siteType: asString(row["siteType"], "Other"),
    isUnitLevel: row["isUnitLevel"] === true,
    /*
     * A root site has no ancestors, so an absent path is the normal case
     * here rather than a defect — it narrows to "" and the row simply
     * prints no path line.
     */
    path: asString(row["path"], ""),
    currentMonitorStatus: parseStatusInfo(row["currentMonitorStatus"]),
  };
};

/**
 * Narrow an untyped /network-site/search payload. Rows without an id are
 * dropped; everything else falls back the same way the other parsers here
 * do, so a partially broken server costs the user a label rather than the
 * whole search box.
 */
export const parseSiteSearchResponse: (
  data: JSONObject | undefined,
) => SiteSearchResponse = (
  data: JSONObject | undefined,
): SiteSearchResponse => {
  return {
    results: asRows(data?.["results"])
      .map(parseSearchResultRow)
      .filter(
        (
          result: SiteSearchResultView | null,
        ): result is SiteSearchResultView => {
          return result !== null;
        },
      ),
    isTruncated: data?.["isTruncated"] === true,
  };
};

/*
 * Real latitude and longitude ranges. A CSV import that shifts a column by
 * one puts a longitude in the latitude field, and a latitude of 1246.7
 * projects to a marker — and a frame fitted around it — somewhere no site
 * is. Out-of-range rows are dropped here for the same reason the server
 * refuses to place them.
 */
const MAX_LATITUDE: number = 90;
const MAX_LONGITUDE: number = 180;

const asCoordinate: (value: unknown, limit: number) => number | null = (
  value: unknown,
  limit: number,
): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value >= -limit && value <= limit ? value : null;
};

const parseUnplacedRow: (value: unknown) => MapUnplacedSiteView | null = (
  value: unknown,
): MapUnplacedSiteView | null => {
  const row: JSONObject = (value || {}) as JSONObject;
  const id: string = asString(row["id"], "");
  if (!id) {
    return null;
  }
  return {
    id: id,
    name: asString(row["name"], "Unnamed site"),
    siteType: asString(row["siteType"], "Other"),
    isUnitLevel: row["isUnitLevel"] === true,
  };
};

/**
 * Narrow an untyped /network-site/map payload. Rows without an id, or whose
 * coordinates are not usable numbers in the real latitude/longitude ranges,
 * are dropped — a marker that cannot be projected is noise, and the
 * projection math requires finite inputs.
 *
 * Every rollup field defaults to a shape the map can render: a payload from
 * a server that predates grouped markers narrows to plain, non-container
 * markers rather than to holes.
 */
export const parseSiteMapResponse: (
  data: JSONObject | undefined,
) => SiteMapResponse = (data: JSONObject | undefined): SiteMapResponse => {
  const sites: Array<MapSiteView> = asRows(data?.["sites"])
    .map((value: unknown): MapSiteView | null => {
      const row: JSONObject = (value || {}) as JSONObject;
      const id: string = asString(row["id"], "");
      if (!id) {
        return null;
      }
      const latitude: number | null = asCoordinate(
        row["latitude"],
        MAX_LATITUDE,
      );
      const longitude: number | null = asCoordinate(
        row["longitude"],
        MAX_LONGITUDE,
      );
      if (latitude === null || longitude === null) {
        return null;
      }
      const totalUnits: number = Math.max(
        0,
        asFiniteNumber(row["totalUnits"], 0),
      );
      return {
        id: id,
        name: asString(row["name"], "Unnamed site"),
        siteType: asString(row["siteType"], "Other"),
        isUnitLevel: row["isUnitLevel"] === true,
        latitude: latitude,
        longitude: longitude,
        statusPriority: asFiniteNumber(row["statusPriority"], 0),
        isOperational:
          typeof row["isOperational"] === "boolean"
            ? (row["isOperational"] as boolean)
            : null,
        parentBreadcrumb: asString(row["parentBreadcrumb"], ""),
        isContainer: row["isContainer"] === true,
        isDerivedLocation: row["isDerivedLocation"] === true,
        locatedDescendantCount: Math.max(
          0,
          asFiniteNumber(row["locatedDescendantCount"], 0),
        ),
        unlocatedDescendantCount: Math.max(
          0,
          asFiniteNumber(row["unlocatedDescendantCount"], 0),
        ),
        totalUnits: totalUnits,
        /*
         * Clamped into its own total: a marker can never report more
         * healthy units than it has, however the rollup arrived.
         */
        operationalUnits: Math.min(
          totalUnits,
          Math.max(0, asFiniteNumber(row["operationalUnits"], 0)),
        ),
        childSiteCount: Math.max(0, asFiniteNumber(row["childSiteCount"], 0)),
      };
    })
    .filter((site: MapSiteView | null): site is MapSiteView => {
      return site !== null;
    });
  const unplacedSites: Array<MapUnplacedSiteView> = asRows(
    data?.["unplacedSites"],
  )
    .map(parseUnplacedRow)
    .filter((site: MapUnplacedSiteView | null): site is MapUnplacedSiteView => {
      return site !== null;
    });
  /*
   * A payload from a server that predates link lines has no links key at
   * all, which narrows to an empty list — the map simply draws none.
   */
  const links: Array<MapLinkView> = asRows(data?.["links"])
    .map(parseMapLinkRow)
    .filter((link: MapLinkView | null): link is MapLinkView => {
      return link !== null;
    });
  return {
    mode: data?.["mode"] === "all" ? "all" : "grouped",
    sites: sites,
    links: links,
    unplacedSites: unplacedSites,
    isTruncated: data?.["isTruncated"] === true,
  };
};
