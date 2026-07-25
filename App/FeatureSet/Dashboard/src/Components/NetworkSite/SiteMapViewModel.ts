import {
  ProjectedPoint,
  projectAlbersUsa,
  projectRobinson,
} from "./Geo/GeoProjection";
import { GeoClusterPoint } from "./Geo/GeoClusterUtil";

/*
 * Pure, react-free view-model for the SiteGeoMap component: projecting map
 * sites into pins, deciding cluster colors, and sizing cluster markers.
 *
 * Kept out of the component so the logic can be imported (and unit-tested)
 * in a plain Node/TypeScript environment — see Geo/GeoProjection.ts for
 * why. Everything here is deterministic: same input, same output, no
 * randomness and no clock access.
 */

export type MapRegion = "us" | "world";

// The subset of a /network-site/map row the pin builder needs.
export interface PinnableSite {
  id: string;
  latitude: number;
  longitude: number;
  statusPriority: number;
}

export interface BuildPinsResult {
  // Projected pins in input order, ready for GeoClusterUtil.clusterPoints.
  pins: Array<GeoClusterPoint>;
  /*
   * Sites that could not be placed on the requested map: non-finite
   * coordinates (either region), or — on the US map — locations outside
   * every AlbersUSA composite zone (e.g. London, Guam).
   */
  unmappableCount: number;
}

/**
 * Project each site into the requested region's viewBox. The US map uses
 * the AlbersUSA composite (null = outside all zones → unmappable); the
 * world map uses Robinson, which clamps every finite coordinate onto the
 * map, so only non-finite coordinates are unmappable there.
 */
export const buildPins: (
  sites: Array<PinnableSite>,
  region: MapRegion,
) => BuildPinsResult = (
  sites: Array<PinnableSite>,
  region: MapRegion,
): BuildPinsResult => {
  const pins: Array<GeoClusterPoint> = [];
  let unmappableCount: number = 0;

  for (const site of sites) {
    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
      unmappableCount++;
      continue;
    }

    const point: ProjectedPoint | null =
      region === "us"
        ? projectAlbersUsa(site.latitude, site.longitude)
        : projectRobinson(site.latitude, site.longitude);

    if (!point) {
      unmappableCount++;
      continue;
    }

    pins.push({
      id: site.id,
      x: point[0],
      y: point[1],
      statusPriority: Number.isFinite(site.statusPriority)
        ? site.statusPriority
        : 0,
    });
  }

  return { pins, unmappableCount };
};

/*
 * Cluster color keys, mapped to Tailwind palette hexes by the component:
 *   'none'  → gray-400   (no member has a meaningful status)
 *   'ok'    → emerald-500 (every member operational)
 *   'down'  → red-500     (at least one member NOT operational)
 *   'mixed' → amber-500   (anything else — partial/unknown health)
 */
export type ClusterColorKey = "none" | "ok" | "down" | "mixed";

export interface ClusterColorMember {
  statusPriority: number | null | undefined;
  isOperational: boolean | null | undefined;
}

/**
 * Decide a cluster's color from its members. Checks are ordered so an
 * outage always dominates: red beats everything (never hide a down site
 * behind a calm gray), full health beats "no data", and gray is reserved
 * for clusters where no member carries a meaningful status (statusPriority
 * 0/null and no operational verdict). Everything else is mixed.
 */
export const decideClusterColorKey: (
  members: Array<ClusterColorMember>,
) => ClusterColorKey = (
  members: Array<ClusterColorMember>,
): ClusterColorKey => {
  if (members.length === 0) {
    return "none";
  }

  let anyDown: boolean = false;
  let allOperational: boolean = true;
  let allStatusless: boolean = true;

  for (const member of members) {
    if (member.isOperational === false) {
      anyDown = true;
    }
    if (member.isOperational !== true) {
      allOperational = false;
    }
    const priority: number =
      typeof member.statusPriority === "number" &&
      Number.isFinite(member.statusPriority)
        ? member.statusPriority
        : 0;
    if (
      priority !== 0 ||
      member.isOperational === true ||
      member.isOperational === false
    ) {
      allStatusless = false;
    }
  }

  if (anyDown) {
    return "down";
  }
  if (allOperational) {
    return "ok";
  }
  if (allStatusless) {
    return "none";
  }
  return "mixed";
};

/*
 * Marker sizing, in viewBox units (the US map is 975 wide, the world map
 * 960). The minimum is deliberately generous: at realistic dashboard
 * widths the map renders at roughly 1:1, so a smaller dot reads as a
 * speck rather than a site.
 */
export const MIN_CLUSTER_RADIUS: number = 7;
export const MAX_CLUSTER_RADIUS: number = 22;

/**
 * Marker radius for a cluster: sqrt scaling (area tracks count) from
 * MIN_CLUSTER_RADIUS at a single site, clamped to MAX_CLUSTER_RADIUS.
 * Non-finite or sub-1 counts render at the minimum.
 */
export const clusterRadius: (totalCount: number) => number = (
  totalCount: number,
): number => {
  const count: number =
    Number.isFinite(totalCount) && totalCount > 1 ? totalCount : 1;
  const radius: number = MIN_CLUSTER_RADIUS * Math.sqrt(count);
  return Math.min(MAX_CLUSTER_RADIUS, Math.max(MIN_CLUSTER_RADIUS, radius));
};

// The subset of a map row that decides where a marker is drawn.
export interface FingerprintableSite {
  id: string;
  latitude: number;
  longitude: number;
}

/**
 * Order-independent identity of the pin geometry a map is drawing: which
 * sites are on it and where each one sits.
 *
 * The background poll rebuilds the sites array every minute, so array
 * identity says nothing about whether the map actually changed. SiteGeoMap
 * keys its "this popover is anchored to a cluster that no longer exists"
 * reset on this instead. Status is deliberately excluded — a site going
 * down recolors its marker but does not move it, so it must not close a
 * popover the user is reading.
 */
export const mapPinFingerprint: (
  sites: Array<FingerprintableSite>,
) => string = (sites: Array<FingerprintableSite>): string => {
  return sites
    .map((site: FingerprintableSite): string => {
      return `${site.id}:${site.latitude}:${site.longitude}`;
    })
    .sort()
    .join("|");
};

/**
 * "99.9%" with exactly one decimal, or an em-dash when there is no uptime
 * number to show (null/undefined/non-finite).
 */
export const formatUptimePercent: (
  uptimePercent: number | null | undefined,
) => string = (uptimePercent: number | null | undefined): string => {
  if (
    uptimePercent === null ||
    uptimePercent === undefined ||
    !Number.isFinite(uptimePercent)
  ) {
    return "—";
  }
  return `${uptimePercent.toFixed(1)}%`;
};
