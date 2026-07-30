import { ProjectedPoint, projectRobinson } from "./Geo/GeoProjection";
import { MapViewport, screenLengthToViewportLength } from "./Geo/GeoViewport";
import {
  GeoCluster,
  GeoClusterPoint,
  clusterPoints,
} from "./Geo/GeoClusterUtil";
import { MapSiteView, SiteMapMode } from "./SiteHierarchyTypes";

/*
 * Pure, react-free view-model for the SiteGeoMap component: projecting map
 * sites into pins, deciding cluster colors, and sizing cluster markers.
 *
 * Kept out of the component so the logic can be imported (and unit-tested)
 * in a plain Node/TypeScript environment — see Geo/GeoProjection.ts for
 * why. Everything here is deterministic: same input, same output, no
 * randomness and no clock access.
 */

// The subset of a /network-site/map row the pin builder needs.
export interface PinnableSite {
  id: string;
  latitude: number;
  longitude: number;
  statusPriority: number;
  /*
   * How many underlying sites this row stands for. A grouped marker is one
   * row that represents a whole region, so the cluster it seeds has to
   * carry that weight rather than counting as a single site.
   */
  count?: number | undefined;
}

export interface BuildPinsResult {
  // Projected pins in input order, ready for GeoClusterUtil.clusterPoints.
  pins: Array<GeoClusterPoint>;
  /*
   * Sites that could not be placed on the map at all — coordinates that are
   * not finite numbers. Every real location on Earth has a place on this
   * projection, so this only ever catches corrupt data.
   */
  unmappableCount: number;
}

/**
 * Project each site into the world viewBox. Robinson places every finite
 * coordinate, so a site is only unmappable when its coordinates are not
 * finite numbers — whether it is currently inside the visible frame is a
 * viewport question, not a projection one (see Geo/GeoViewport.ts).
 */
export const buildPins: (sites: Array<PinnableSite>) => BuildPinsResult = (
  sites: Array<PinnableSite>,
): BuildPinsResult => {
  const pins: Array<GeoClusterPoint> = [];
  let unmappableCount: number = 0;

  for (const site of sites) {
    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
      unmappableCount++;
      continue;
    }

    const point: ProjectedPoint = projectRobinson(
      site.latitude,
      site.longitude,
    );

    pins.push({
      id: site.id,
      x: point[0],
      y: point[1],
      statusPriority: Number.isFinite(site.statusPriority)
        ? site.statusPriority
        : 0,
      count:
        typeof site.count === "number" &&
        Number.isFinite(site.count) &&
        site.count > 0
          ? Math.round(site.count)
          : 1,
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
 * Marker sizing, in whole-world viewBox units (the world map is 960 wide).
 * The minimum is deliberately generous: at realistic dashboard widths the
 * unzoomed map renders at roughly 1:1, so a smaller dot reads as a speck
 * rather than a site.
 */
export const MIN_CLUSTER_RADIUS: number = 7;
export const MAX_CLUSTER_RADIUS: number = 22;

/**
 * Marker radius for a cluster: sqrt scaling (area tracks count) from
 * MIN_CLUSTER_RADIUS at a single site, clamped to MAX_CLUSTER_RADIUS.
 * Non-finite or sub-1 counts render at the minimum.
 *
 * Pass the current viewport to keep the marker the same size ON SCREEN at
 * every zoom. Markers are UI, not geography: a marker that grows with the
 * zoom means zooming in to separate two sites just yields two bigger
 * overlapping blobs.
 */
export const clusterRadius: (
  totalCount: number,
  viewport?: MapViewport | undefined,
) => number = (
  totalCount: number,
  viewport?: MapViewport | undefined,
): number => {
  const count: number =
    Number.isFinite(totalCount) && totalCount > 1 ? totalCount : 1;
  const radius: number = MIN_CLUSTER_RADIUS * Math.sqrt(count);
  const clamped: number = Math.min(
    MAX_CLUSTER_RADIUS,
    Math.max(MIN_CLUSTER_RADIUS, radius),
  );
  return viewport ? screenLengthToViewportLength(clamped, viewport) : clamped;
};

/*
 * Grid cell size for pin clustering, in whole-world viewBox units. Sites
 * closer together than this share a marker.
 */
export const CLUSTER_CELL_SIZE: number = 28;

/**
 * Cluster cell size for the current viewport, in viewBox units.
 *
 * This is what makes zoom mean something: the cell is a constant distance ON
 * SCREEN, so it covers less and less of the world as the map zooms in, and a
 * cluster of nearby sites breaks apart into individual markers instead of
 * staying one lump at every zoom.
 */
export const clusterCellSize: (viewport: MapViewport) => number = (
  viewport: MapViewport,
): number => {
  return screenLengthToViewportLength(CLUSTER_CELL_SIZE, viewport);
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

/*
 * ── Hierarchy markers ──────────────────────────────────────────────────
 *
 * The map draws one marker per CHILD of the level in view, so a marker
 * stands for a region, a market or a store — something the customer named —
 * rather than for however many pins fell in one grid cell. Everything that
 * decides what a marker looks like lives here, in plain functions over
 * plain data, so the component is left with nothing but drawing.
 */

/*
 * Health of a site or a rollup, in the vocabulary the site CARD already
 * speaks. The map reuses it deliberately: a region whose card reads "63 of
 * 63 units down" must not be a calm dot on the map above it. That
 * disagreement between the two halves of the page is what this whole
 * change is fixing.
 */
export type HealthTone = "ok" | "warn" | "down" | "none";

/**
 * Tone for a unit rollup, from the counts alone.
 *
 * Half or more of the units down is an outage, not a wobble — red. A
 * minority down is degraded — amber. This is the rule SiteCard has always
 * used for its lead figure and meter; both now read it from here so the
 * card and the marker above it can never drift apart.
 */
export const unitRollupTone: (rollup: {
  totalUnits: number;
  operationalUnits: number;
}) => HealthTone = (rollup: {
  totalUnits: number;
  operationalUnits: number;
}): HealthTone => {
  const total: number = rollup.totalUnits;
  if (!Number.isFinite(total) || total <= 0) {
    return "none";
  }
  const operational: number = Math.min(
    Math.max(
      Number.isFinite(rollup.operationalUnits) ? rollup.operationalUnits : 0,
      0,
    ),
    total,
  );
  if (operational >= total) {
    return "ok";
  }
  if (operational * 2 <= total) {
    return "down";
  }
  return "warn";
};

/*
 * The card's four tones onto the map's four marker colors. "warn" and
 * "mixed" are the same amber: on a card the word is about units, on a
 * marker it is about a cluster, and both mean "partly bad".
 */
export const colorKeyForTone: (tone: HealthTone) => ClusterColorKey = (
  tone: HealthTone,
): ClusterColorKey => {
  return tone === "warn" ? "mixed" : tone;
};

const toneFromOperational: (isOperational: boolean | null) => HealthTone = (
  isOperational: boolean | null,
): HealthTone => {
  if (isOperational === false) {
    return "down";
  }
  return isOperational === true ? "ok" : "none";
};

/**
 * Tone of one grouped marker: a container with units under it is colored by
 * its rollup (so a region 3% down is amber, not the same red as one that is
 * entirely dark), and anything else falls back to its own reported health.
 */
export const markerToneForSite: (site: MapSiteView) => HealthTone = (
  site: MapSiteView,
): HealthTone => {
  if (site.isContainer && site.totalUnits > 0) {
    return unitRollupTone(site);
  }
  return toneFromOperational(site.isOperational);
};

/**
 * The figure printed inside a grouped marker: how many units are under it,
 * or — for a level that has no unit-level descendants yet — how many sites
 * are. 1 means there is nothing to count, and the marker draws as a plain
 * pin with no number in it.
 */
export const markerCountForSite: (site: MapSiteView) => number = (
  site: MapSiteView,
): number => {
  if (site.totalUnits > 0) {
    return site.totalUnits;
  }
  return site.childSiteCount > 0 ? site.childSiteCount : 1;
};

const pluralize: (count: number, singular: string) => string = (
  count: number,
  singular: string,
): string => {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
};

/*
 * The fallback name for a level whose children are of mixed types. Site
 * types are per-project rows, so there is no safe generic to borrow from
 * one of them.
 */
export const GENERIC_SITE_TYPE_LABEL: string = "site";

const CONSONANT_Y_ENDING: RegExp = new RegExp("[^aeiou]y$");
const SIBILANT_ENDING: RegExp = new RegExp("(s|x|z|ch|sh)$");

/**
 * Plural of a site-type name the CUSTOMER wrote.
 *
 * Site types are free text on a per-project row, so the naive "+ s" that is
 * fine for the hardcoded English nouns elsewhere in this file produces
 * "Facilitys", "Branchs" and "Franchise Unitss" on a real customer's map.
 * This handles the endings that actually show up in franchise estates, and
 * leaves a name that is already plural alone.
 */
export const pluralizeSiteType: (word: string) => string = (
  word: string,
): string => {
  const trimmed: string = word.trim();
  if (!trimmed) {
    return trimmed;
  }
  const lower: string = trimmed.toLowerCase();

  /*
   * Already plural — "Units", "Premises". The exclusions are the singulars
   * that merely end in s: "Business", "Campus", "Chassis".
   */
  if (
    lower.endsWith("s") &&
    !lower.endsWith("ss") &&
    !lower.endsWith("us") &&
    !lower.endsWith("is")
  ) {
    return trimmed;
  }
  // Consonant + y → -ies: "Facility", "Territory".
  if (CONSONANT_Y_ENDING.test(lower)) {
    return `${trimmed.slice(0, -1)}ies`;
  }
  // Sibilant endings take -es: "Business", "Branch", "Box", "Dish".
  if (SIBILANT_ENDING.test(lower)) {
    return `${trimmed}es`;
  }
  return `${trimmed}s`;
};

/**
 * What to call the children of the level in view, in the customer's own
 * words: the shared site-type name when they all agree ("Region",
 * "Market", "Store"), and a plain "site" when the level mixes types.
 *
 * The map must never invent vocabulary. A customer who renamed "Unit" to
 * "Restaurant" should read "12 restaurants on the map", and a customer
 * whose top level holds both regions and a stray unit should read "sites"
 * rather than have one of the two names put in their mouth.
 */
export const childTypeLabelFor: (
  sites: Array<{ siteType: string }>,
) => string = (sites: Array<{ siteType: string }>): string => {
  let label: string | null = null;
  for (const site of sites) {
    const siteType: string = (site.siteType || "").trim();
    if (!siteType) {
      return GENERIC_SITE_TYPE_LABEL;
    }
    if (label === null) {
      label = siteType;
      continue;
    }
    if (label.toLowerCase() !== siteType.toLowerCase()) {
      return GENERIC_SITE_TYPE_LABEL;
    }
  }
  return label === null ? GENERIC_SITE_TYPE_LABEL : label;
};

/**
 * The map's coverage line: how much of the network the frame is holding.
 *
 * A count that quietly shrinks as somebody zooms reads as sites
 * disappearing, so once the frame stops holding everything the line says
 * what it does hold. In grouped mode it counts the LEVEL's children by
 * their own type name — counting them as "sites" would be the same
 * category error the flat map made, one marker standing for a thousand
 * stores while the footer calls it one site.
 */
export const describeMapCoverage: (input: {
  mode: SiteMapMode;
  markerCount: number;
  inViewCount: number;
  siteCount: number;
  childTypeLabel: string;
}) => string = (input: {
  mode: SiteMapMode;
  markerCount: number;
  inViewCount: number;
  siteCount: number;
  childTypeLabel: string;
}): string => {
  if (input.mode === "all") {
    return input.inViewCount < input.siteCount
      ? `${input.inViewCount} of ${input.siteCount} sites in view`
      : `${pluralize(input.siteCount, "site")} mapped`;
  }
  const noun: string = input.childTypeLabel || GENERIC_SITE_TYPE_LABEL;
  const counted: string =
    input.markerCount === 1
      ? noun.toLowerCase()
      : pluralizeSiteType(noun).toLowerCase();
  if (input.inViewCount < input.markerCount) {
    return `${input.inViewCount} of ${input.markerCount} ${counted} in view`;
  }
  return `${input.markerCount} ${counted} on the map`;
};

/**
 * One phrase describing a marker's health, in the same shape the card uses:
 * a healthy thing counts what is up, an unhealthy one counts what is down.
 */
export const describeMarkerHealth: (site: MapSiteView) => string = (
  site: MapSiteView,
): string => {
  if (!site.isContainer || site.totalUnits <= 0) {
    if (site.isOperational === true) {
      return "Operational";
    }
    return site.isOperational === false ? "Down" : "No status yet";
  }
  const total: number = site.totalUnits;
  const operational: number = Math.min(
    Math.max(site.operationalUnits, 0),
    total,
  );
  if (operational >= total) {
    return `${pluralize(total, "unit")} operational`;
  }
  return `${total - operational} of ${pluralize(total, "unit")} down`;
};

/**
 * Hover/accessible text for one grouped marker: what it is, how it is
 * doing, how big it is, and — when the position was inferred rather than
 * given — that the map is only approximately right about where it sits.
 */
export const describeMarkerSite: (site: MapSiteView) => string = (
  site: MapSiteView,
): string => {
  const parts: Array<string> = [
    `${site.name} — ${site.siteType}`,
    describeMarkerHealth(site),
  ];
  if (site.isContainer && site.childSiteCount > 0) {
    parts.push(pluralize(site.childSiteCount, "site"));
  }
  if (site.isDerivedLocation) {
    parts.push(
      site.locatedDescendantCount > 0
        ? `centered on ${pluralize(site.locatedDescendantCount, "located site")}`
        : "approximate location",
    );
  }
  return parts.join(" · ");
};

/*
 * Grouped marker sizing, in whole-world viewBox units — the same units
 * clusterRadius returns, so the two modes draw at a comparable weight.
 *
 * The size is RELATIVE to the biggest marker on screen rather than
 * absolute. A franchise where every region holds 60-110 units would
 * otherwise saturate the absolute sqrt scale and render thirteen identical
 * maximum-size discs, throwing away the one thing size is for. Scaling to
 * the largest keeps the comparison alive at any estate size, and sqrt keeps
 * AREA proportional to the count so the reading stays honest.
 */
export const groupedMarkerRadius: (
  count: number,
  maxCount: number,
) => number = (count: number, maxCount: number): number => {
  const safeCount: number = Number.isFinite(count) && count > 1 ? count : 1;
  const safeMax: number =
    Number.isFinite(maxCount) && maxCount > 1 ? maxCount : 1;
  if (safeMax <= 1) {
    return MIN_CLUSTER_RADIUS;
  }
  const fraction: number = Math.sqrt(Math.min(safeCount, safeMax) / safeMax);
  return (
    MIN_CLUSTER_RADIUS + (MAX_CLUSTER_RADIUS - MIN_CLUSTER_RADIUS) * fraction
  );
};

/*
 * Past this many markers the name labels come off: they would overlap into
 * an unreadable mat, and the hover tooltip still names every one. Levels
 * with this many children are rare — it is the deep, unit-heavy levels that
 * get busy, and those are exactly the ones whose markers are single stores.
 */
export const MAX_LABELLED_MARKERS: number = 48;

/*
 * Names are free text. Past this many characters a label spans further than
 * the markers either side of it; the full name stays in the tooltip and in
 * the marker's accessible name.
 */
export const MAX_MARKER_LABEL_CHARS: number = 22;

/**
 * Shorten a marker's label to something that fits under a marker.
 */
export const truncateMarkerLabel: (value: string) => string = (
  value: string,
): string => {
  if (value.length <= MAX_MARKER_LABEL_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_MARKER_LABEL_CHARS - 1).trimEnd()}…`;
};

/*
 * Label geometry, in screen units — the same units screenRadius is in.
 * The character width is an approximation of a 600-weight sans glyph at
 * LABEL_FONT_SIZE; it only has to be close enough to decide overlap, and
 * erring slightly wide means the map drops a label rather than printing two
 * on top of each other.
 */
export const LABEL_FONT_SIZE: number = 10;
const LABEL_CHAR_WIDTH: number = 5.6;
const LABEL_HEIGHT: number = 12;
export const LABEL_GAP: number = 10;
// Labels this close to each other read as collided even when they do not touch.
const LABEL_PADDING: number = 2;

interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/*
 * Where a marker's name sits relative to it. Below reads best — the eye
 * goes marker-then-name — so it is always tried first; above is the escape
 * hatch for a marker with a neighbour directly beneath it.
 */
export type LabelPlacement = "below" | "above";

export const LABEL_PLACEMENTS: Array<LabelPlacement> = ["below", "above"];

/*
 * A container is drawn as a square of side 1.78r, so its label clears the
 * corner rather than the circumscribed circle.
 */
const markerLabelRect: (
  marker: MapMarker,
  zoom: number,
  placement: LabelPlacement,
) => LabelRect = (
  marker: MapMarker,
  zoom: number,
  placement: LabelPlacement,
): LabelRect => {
  const width: number = Math.max(
    marker.label.length * LABEL_CHAR_WIDTH,
    LABEL_CHAR_WIDTH,
  );
  const centerX: number = marker.x * zoom;
  const offset: number =
    (marker.isContainer
      ? (marker.screenRadius * 1.78) / 2
      : marker.screenRadius) + LABEL_GAP;
  const centerY: number =
    marker.y * zoom + (placement === "above" ? -offset : offset);
  return {
    left: centerX - width / 2 - LABEL_PADDING,
    right: centerX + width / 2 + LABEL_PADDING,
    top: centerY - LABEL_HEIGHT / 2 - LABEL_PADDING,
    bottom: centerY + LABEL_HEIGHT / 2 + LABEL_PADDING,
  };
};

// The marker's own body, in the same screen units as its label rect.
const markerBodyRect: (marker: MapMarker, zoom: number) => LabelRect = (
  marker: MapMarker,
  zoom: number,
): LabelRect => {
  const half: number = marker.isContainer
    ? (marker.screenRadius * 1.78) / 2
    : marker.screenRadius;
  const centerX: number = marker.x * zoom;
  const centerY: number = marker.y * zoom;
  return {
    left: centerX - half,
    right: centerX + half,
    top: centerY - half,
    bottom: centerY + half,
  };
};

const rectsOverlap: (a: LabelRect, b: LabelRect) => boolean = (
  a: LabelRect,
  b: LabelRect,
): boolean => {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
};

/**
 * Where each marker draws its name at this zoom — and which markers do not
 * get to draw one at all.
 *
 * Three regions whose centroids fall in the same corner of a state print
 * their names on top of each other, which is worse than printing none of
 * them: an overlapped label is unreadable AND it hides its neighbour. So
 * names are placed greedily in paint order — biggest marker first, since
 * that is the one a reader is most likely to be looking for — trying below
 * the marker and then above it, and a name that fits in neither position is
 * dropped rather than stacked on something.
 *
 * A label must clear the other MARKERS too, not just the other labels: a
 * name half-covered by the neighbouring region's disc reads as a rendering
 * bug, not as a dense map.
 *
 * Zoom is the only thing this depends on, not the pan: markers keep their
 * relative distances as the frame moves, so a drag never re-decides which
 * names are on the map. Zooming in genuinely separates them and the dropped
 * names come back.
 */
export const resolveMarkerLabels: (
  markers: Array<MapMarker>,
  zoom: number,
) => Map<string, LabelPlacement> = (
  markers: Array<MapMarker>,
  zoom: number,
): Map<string, LabelPlacement> => {
  const safeZoom: number = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const resolved: Map<string, LabelPlacement> = new Map<
    string,
    LabelPlacement
  >();
  const placed: Array<LabelRect> = [];

  const bodies: Array<LabelRect> = markers.map(
    (marker: MapMarker): LabelRect => {
      return markerBodyRect(marker, safeZoom);
    },
  );

  const fits: (rect: LabelRect, index: number) => boolean = (
    rect: LabelRect,
    index: number,
  ): boolean => {
    for (const other of placed) {
      if (rectsOverlap(rect, other)) {
        return false;
      }
    }
    for (let other: number = 0; other < bodies.length; other++) {
      /*
       * Its own body never counts: the label is deliberately placed hard
       * against it, and a generous glyph-width estimate can graze it.
       */
      if (other !== index && rectsOverlap(rect, bodies[other]!)) {
        return false;
      }
    }
    return true;
  };

  for (let index: number = 0; index < markers.length; index++) {
    const marker: MapMarker = markers[index]!;
    if (!marker.label) {
      continue;
    }
    for (const placement of LABEL_PLACEMENTS) {
      const rect: LabelRect = markerLabelRect(marker, safeZoom, placement);
      if (fits(rect, index)) {
        placed.push(rect);
        resolved.set(marker.key, placement);
        break;
      }
    }
  }

  return resolved;
};

// One drawable marker. Positions are viewBox units; radius is screen units.
export interface MapMarker {
  // Stable across re-renders for the same geometry — React's key.
  key: string;
  x: number;
  y: number;
  // The sites this marker stands for. Exactly one in grouped mode.
  ids: Array<string>;
  /*
   * The figure drawn inside the marker. 1 renders as a plain pin with no
   * number — there is nothing to count.
   */
  count: number;
  screenRadius: number;
  colorKey: ClusterColorKey;
  // Draw as a container (a level you can open) rather than as a place.
  isContainer: boolean;
  // Position inferred from descendants — the marker says so.
  isApproximate: boolean;
  /** Name drawn under the marker, or "" when this marker gets no label. */
  label: string;
  tooltip: string;
}

const clusterTooltip: (
  cluster: GeoCluster,
  siteById: Map<string, MapSiteView>,
) => string = (
  cluster: GeoCluster,
  siteById: Map<string, MapSiteView>,
): string => {
  if (cluster.ids.length === 1) {
    const site: MapSiteView | undefined = siteById.get(cluster.ids[0]!);
    if (!site) {
      return "";
    }
    return site.parentBreadcrumb
      ? `${site.name} — ${site.parentBreadcrumb}`
      : site.name;
  }
  const names: Array<string> = cluster.ids
    .slice(0, 5)
    .map((id: string): string => {
      return siteById.get(id)?.name || "Unnamed site";
    });
  const more: number = cluster.ids.length - names.length;
  return `${cluster.totalCount} sites: ${names.join(", ")}${
    more > 0 ? `, +${more} more` : ""
  }`;
};

export interface BuildMarkersInput {
  sites: Array<MapSiteView>;
  mode: SiteMapMode;
  // Grid cell size for "all" mode clustering, in viewBox units.
  cellSize: number;
}

/**
 * Turn map rows into drawable markers.
 *
 * GROUPED never clusters. A marker is one child of the level in view, and
 * merging two of them because they happen to sit close together would
 * recreate the exact defect this mode exists to fix: a number on the map
 * that stands for nothing the customer has a name for. They can overlap;
 * zoom separates them, and the smaller marker is painted last so it stays
 * reachable under the bigger one.
 *
 * ALL clusters by screen proximity, which is the right thing when every
 * marker really is one store.
 *
 * Output order is paint order, and it is deterministic: markers are sorted
 * by descending count with the id as the tie-break, so the same data always
 * draws the same way.
 */
export const buildMapMarkers: (input: BuildMarkersInput) => Array<MapMarker> = (
  input: BuildMarkersInput,
): Array<MapMarker> => {
  const { pins }: BuildPinsResult = buildPins(
    input.sites.map((site: MapSiteView): PinnableSite => {
      return {
        id: site.id,
        latitude: site.latitude,
        longitude: site.longitude,
        statusPriority: site.statusPriority,
        count: input.mode === "grouped" ? markerCountForSite(site) : 1,
      };
    }),
  );

  const siteById: Map<string, MapSiteView> = new Map<string, MapSiteView>();
  for (const site of input.sites) {
    siteById.set(site.id, site);
  }

  if (input.mode === "all") {
    return clusterPoints(pins, input.cellSize).map(
      (cluster: GeoCluster): MapMarker => {
        const members: Array<MapSiteView> = cluster.ids
          .map((id: string): MapSiteView | undefined => {
            return siteById.get(id);
          })
          .filter((site: MapSiteView | undefined): site is MapSiteView => {
            return site !== undefined;
          });
        return {
          key: `${cluster.x}:${cluster.y}:${cluster.ids[0]}`,
          x: cluster.x,
          y: cluster.y,
          ids: cluster.ids,
          count: cluster.totalCount,
          screenRadius: clusterRadius(cluster.totalCount),
          colorKey: decideClusterColorKey(
            members.map((site: MapSiteView): ClusterColorMember => {
              return {
                statusPriority: site.statusPriority,
                isOperational: site.isOperational,
              };
            }),
          ),
          isContainer: false,
          isApproximate: false,
          label: "",
          tooltip: clusterTooltip(cluster, siteById),
        };
      },
    );
  }

  const counts: Array<number> = pins.map((pin: GeoClusterPoint): number => {
    return pin.count ?? 1;
  });
  const maxCount: number = counts.length > 0 ? Math.max(...counts) : 1;
  const showLabels: boolean = pins.length <= MAX_LABELLED_MARKERS;

  const markers: Array<MapMarker> = [];
  for (const pin of pins) {
    const site: MapSiteView | undefined = siteById.get(pin.id);
    if (!site) {
      continue;
    }
    const count: number = pin.count ?? 1;
    markers.push({
      key: site.id,
      x: pin.x,
      y: pin.y,
      ids: [site.id],
      count: count,
      screenRadius: groupedMarkerRadius(count, maxCount),
      colorKey: colorKeyForTone(markerToneForSite(site)),
      isContainer: site.isContainer,
      isApproximate: site.isDerivedLocation,
      label: showLabels ? truncateMarkerLabel(site.name) : "",
      tooltip: describeMarkerSite(site),
    });
  }

  /*
   * Biggest first, so the smallest marker is painted last and a single
   * store never disappears under the region that contains its neighbours.
   */
  markers.sort((a: MapMarker, b: MapMarker): number => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return markers;
};
