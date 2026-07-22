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

// One pin row of /network-site/map.
export interface MapSiteView {
  id: string;
  name: string;
  siteType: string;
  latitude: number;
  longitude: number;
  statusPriority: number;
  isOperational: boolean | null;
  parentBreadcrumb: string;
}

export interface SiteMapResponse {
  sites: Array<MapSiteView>;
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

/**
 * Narrow an untyped /network-site/map payload. Rows without an id or with
 * non-finite coordinates are dropped — a pin that cannot be projected is
 * noise, and the projection math requires finite inputs.
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
      const latitude: unknown = row["latitude"];
      const longitude: unknown = row["longitude"];
      if (
        typeof latitude !== "number" ||
        !Number.isFinite(latitude) ||
        typeof longitude !== "number" ||
        !Number.isFinite(longitude)
      ) {
        return null;
      }
      return {
        id: id,
        name: asString(row["name"], "Unnamed site"),
        siteType: asString(row["siteType"], "Other"),
        latitude: latitude,
        longitude: longitude,
        statusPriority: asFiniteNumber(row["statusPriority"], 0),
        isOperational:
          typeof row["isOperational"] === "boolean"
            ? (row["isOperational"] as boolean)
            : null,
        parentBreadcrumb: asString(row["parentBreadcrumb"], ""),
      };
    })
    .filter((site: MapSiteView | null): site is MapSiteView => {
      return site !== null;
    });
  return {
    sites: sites,
    isTruncated: data?.["isTruncated"] === true,
  };
};
