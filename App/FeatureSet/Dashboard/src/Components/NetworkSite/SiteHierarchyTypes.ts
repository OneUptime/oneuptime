import { JSONArray, JSONObject } from "Common/Types/JSON";

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
  unitStats: SiteUnitStats;
  uptimePercent: number | null;
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

export interface SiteMapResponse {
  mode: SiteMapMode;
  sites: Array<MapSiteView>;
  unplacedSites: Array<MapUnplacedSiteView>;
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
  return {
    id: id,
    name: asString(row["name"], "Unnamed site"),
    siteType: asString(row["siteType"], "Other"),
    isUnitLevel: row["isUnitLevel"] === true,
    currentMonitorStatus: parseStatusInfo(row["currentMonitorStatus"]),
    childSiteCount: asFiniteNumber(row["childSiteCount"], 0),
    deviceCount: asFiniteNumber(row["deviceCount"], 0),
    unitStats: {
      totalUnits: asFiniteNumber(unitStatsRow["totalUnits"], 0),
      operationalUnits: asFiniteNumber(unitStatsRow["operationalUnits"], 0),
    },
    uptimePercent:
      typeof rawUptime === "number" && Number.isFinite(rawUptime)
        ? rawUptime
        : null,
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
  const statusRow: unknown = row["monitorStatus"];
  let monitorStatus: SiteLinkStatusInfo | undefined = undefined;
  if (statusRow && typeof statusRow === "object" && !Array.isArray(statusRow)) {
    const status: JSONObject = statusRow as JSONObject;
    monitorStatus = {
      name: asString(status["name"], "Unknown"),
      color: asOptionalString(status["color"]),
      priority: asFiniteNumber(status["priority"], 0),
    };
  }
  return {
    id: id,
    name: asString(row["name"], "Unnamed link"),
    fromSiteId: asOptionalString(row["fromSiteId"]),
    toSiteId: asOptionalString(row["toSiteId"]),
    monitorStatus: monitorStatus,
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
  return {
    breadcrumb: breadcrumb,
    children: children,
    links: links,
    childrenTruncated: data?.["childrenTruncated"] === true,
    descendantCountsTruncated: data?.["descendantCountsTruncated"] === true,
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
  return {
    mode: data?.["mode"] === "all" ? "all" : "grouped",
    sites: sites,
    unplacedSites: unplacedSites,
    isTruncated: data?.["isTruncated"] === true,
  };
};
