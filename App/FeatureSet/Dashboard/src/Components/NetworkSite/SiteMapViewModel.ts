import { ProjectedPoint, projectRobinson } from "./Geo/GeoProjection";
import { MapViewport, screenLengthToViewportLength } from "./Geo/GeoViewport";
import {
  GeoCluster,
  GeoClusterPoint,
  clusterPoints,
} from "./Geo/GeoClusterUtil";
import {
  CollidableMarker,
  MarkerPlacement,
  resolveMarkerCollisions,
} from "./Geo/MarkerLayout";
import { MapLinkView, MapSiteView, SiteMapMode } from "./SiteHierarchyTypes";

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
 * A container is drawn as a SQUARE rather than a disc — same shape as the
 * card it opens into — and a square of side 2r covers a good deal more ink
 * than a circle of radius r, so the side is pulled in to keep the two shapes
 * reading at one weight.
 *
 * One constant, because three different pieces of geometry have to agree on
 * it: the square SiteGeoMap draws, the box a label has to clear, and the
 * circle the collision layout keeps clear around it.
 */
export const CONTAINER_SIDE_FACTOR: number = 1.78;

/*
 * The radius of the circle that CONTAINS that square — half its diagonal.
 * Collision uses it so two containers cannot be pushed together corner to
 * corner, which is the one direction a side-length comparison misses.
 */
export const CONTAINER_COLLISION_FACTOR: number =
  (CONTAINER_SIDE_FACTOR / 2) * Math.SQRT2;

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
  /*
   * Trimmed first. A site named entirely of spaces is not a name, and an
   * untrimmed one is TRUTHY: it would be handed to the placement pass, take
   * a reserved box away from a marker with a real name, and then draw
   * nothing in it — a hole in the layout that nothing on screen accounts for.
   */
  const name: string = value.trim();
  if (name.length <= MAX_MARKER_LABEL_CHARS) {
    return name;
  }
  return `${name.slice(0, MAX_MARKER_LABEL_CHARS - 1).trimEnd()}…`;
};
/*
 * Label geometry, in screen units — the same units screenRadius is in.
 * The character width is an approximation of a 600-weight sans glyph at
 * LABEL_FONT_SIZE; it only has to be close enough to decide overlap, and
 * erring slightly wide means the map pushes a name further out rather than
 * printing two on top of each other.
 */
export const LABEL_FONT_SIZE: number = 10;
const LABEL_CHAR_WIDTH: number = 5.6;
const LABEL_HEIGHT: number = 12;

/*
 * Above and below, the gap is measured from the marker's edge to the label's
 * CENTRE: a label is one line of text, positioned by its centre, and half a
 * line's height is comfortably less than this either way.
 */
export const LABEL_GAP: number = 10;

/*
 * Sideways it is measured to the label's near EDGE instead. A name set
 * beside its marker starts right there — measuring to the centre would push
 * a twenty-character box half its own width away from the thing it names.
 */
export const LABEL_SIDE_GAP: number = 5;

// Labels this close to each other read as collided even when they do not touch.
const LABEL_PADDING: number = 2;

/*
 * The box a name occupies on screen, padding included. This is the unit the
 * whole collision pass works in: a name is reserved as one of these, and
 * everything it has to keep clear of — the other names, the marker bodies —
 * is compared as one of these too.
 */
export interface LabelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/*
 * Where a marker's name sits relative to it. Below reads best — the eye goes
 * marker-then-name — so it is tried first, then above, then the two sides,
 * then the corners.
 *
 * This is a preference order, not a ranking of quality: every one of these
 * is a perfectly readable place for a name, and having eight to choose from
 * instead of two is most of what keeps a level's names on the map at all.
 */
export type LabelDirection =
  | "below"
  | "above"
  | "right"
  | "left"
  | "below-right"
  | "below-left"
  | "above-right"
  | "above-left";

export const LABEL_DIRECTIONS: Array<LabelDirection> = [
  "below",
  "above",
  "right",
  "left",
  "below-right",
  "below-left",
  "above-right",
  "above-left",
];

// The compass as a step per axis. Diagonals are normalised where they are used.
const DIRECTION_STEPS: Record<LabelDirection, { x: number; y: number }> = {
  below: { x: 0, y: 1 },
  above: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  "below-right": { x: 1, y: 1 },
  "below-left": { x: -1, y: 1 },
  "above-right": { x: 1, y: -1 },
  "above-left": { x: -1, y: -1 },
};

/*
 * ── Names that cannot fit against their marker ─────────────────────────
 *
 * Eight positions around a marker are plenty for a map whose markers are
 * spread over a country. They are nowhere near enough for a dozen units in
 * one retail park.
 *
 * Those units arrive at near-identical coordinates. The collision layout
 * fans their MARKERS apart into a disc a few dozen screen units across (see
 * Geo/MarkerLayout.ts) so none of them is hidden — but a name is a box
 * roughly seventy screen units wide, and a dozen of those do not fit in the
 * ring around a disc that small. Every name but the first two used to be
 * dropped, and zooming in never brought them back: zoom multiplies the
 * distance between two markers in the WORLD, and between two units on the
 * same street that distance is zero.
 *
 * So a name with nowhere to sit is PUSHED off its marker, a step at a time,
 * until it finds room — and once it is off, a thin thread is drawn from the
 * marker to the name so it is still obvious whose name it is. That is the
 * same bargain the marker layout already makes with position, and it is
 * what lets a dozen names spread over the space around a pile-up instead of
 * two of them fitting and ten vanishing.
 */
export const LABEL_PUSH_STEP: number = 8;

/*
 * How far a name may be pushed from its marker, in screen units. Past it the
 * reader is tracing a line across the map rather than reading a label, and
 * dropping the name is more honest than pretending the thread explains it.
 *
 * It is dimensioned against the worst case the map can actually present:
 * MAX_LABELLED_MARKERS markers, all on one point, all named at the
 * MAX_MARKER_LABEL_CHARS cap. That seats every name with the furthest of
 * them sitting just about on this number — a dozen units in one retail park,
 * which is what this is really for, never gets past a third of it.
 *
 * Note this is longer than MAX_MARKER_DISPLACEMENT, which bounds how far a
 * MARKER may be moved. That is deliberate: a marker carries a position, and
 * moving one a long way makes the map wrong. A name carries nothing but
 * itself.
 */
export const MAX_LABEL_PUSH: number = 176;

/*
 * Ceiling on the candidate positions examined per call. Fitting on the first
 * try is the normal case — a map with room on it never gets past the first
 * candidate for any marker — and this only bites on a level so crowded that
 * most of its names are being pushed. Names are resolved again on every zoom
 * step, and a map that stutters under a wheel is a worse map than one with a
 * couple of names missing from a crowd.
 */
const MAX_LABEL_CANDIDATE_VISITS: number = 120_000;

// Where a label's text is anchored horizontally, as SVG spells it.
export type LabelTextAnchor = "middle" | "start" | "end";

/*
 * The thread from a marker to a name that no longer sits against it, in
 * SCREEN units RELATIVE to the marker's drawn position — so a renderer
 * divides by the zoom and adds the marker's coordinates, exactly as it does
 * for every other screen-sized piece of the map.
 *
 * It starts on the marker's edge rather than at its centre, so the line does
 * not print over the marker it belongs to, and ends on the nearest edge of
 * the label's box rather than at the text, so it does not print over the
 * name either.
 */
export interface LabelLeaderLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Everything a renderer needs to draw one name: nothing here has to be
 * re-derived, and nothing may be.
 *
 * The collision pass reserved a box at an exact size and offset. A renderer
 * that computed its own offset would be free to draw the name somewhere the
 * pass never checked — which is worse than having no collision pass at all,
 * because the overlap would then look deliberate.
 */
export interface LabelPlacement {
  direction: LabelDirection;
  /*
   * How far past its attached position the name had to be pushed, in screen
   * units. Zero for a name sitting against its marker, which is the case
   * for nearly every name on nearly every map.
   */
  push: number;
  /*
   * Where the text is anchored, relative to the marker's DRAWN position, in
   * screen units. Add the marker's coordinates and divide by the zoom.
   */
  offsetX: number;
  offsetY: number;
  textAnchor: LabelTextAnchor;
  // Null when the name is against its marker and needs no explaining.
  leaderLine: LabelLeaderLine | null;
}

/*
 * A container is drawn as a square of side CONTAINER_SIDE_FACTOR * r, so
 * everything that has to keep clear of it — its label, its thread, its
 * neighbours' labels — clears the SIDE rather than the circumscribed circle.
 */
const markerHalfExtent: (marker: MapMarker) => number = (
  marker: MapMarker,
): number => {
  return marker.isContainer
    ? (marker.screenRadius * CONTAINER_SIDE_FACTOR) / 2
    : marker.screenRadius;
};

// The box a name occupies, padding included, in screen units.
const labelBoxSize: (marker: MapMarker) => { width: number; height: number } = (
  marker: MapMarker,
): { width: number; height: number } => {
  return {
    width:
      Math.max(marker.label.length * LABEL_CHAR_WIDTH, LABEL_CHAR_WIDTH) +
      LABEL_PADDING * 2,
    height: LABEL_HEIGHT + LABEL_PADDING * 2,
  };
};

/*
 * A zoom that can be divided by and multiplied with. A map that has not been
 * measured yet reports a zero or a NaN for a frame or two, and a name is
 * better placed at the wrong magnification than not placed at all.
 */
const safeMapZoom: (zoom: number) => number = (zoom: number): number => {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
};

// One position a name could take: the box it would occupy, and how to draw it.
interface LabelCandidate {
  direction: LabelDirection;
  push: number;
  rect: LabelBounds;
  offsetX: number;
  offsetY: number;
  textAnchor: LabelTextAnchor;
}

/**
 * The box a name would occupy in one direction, pushed `push` screen units
 * further out than its attached position.
 *
 * The push is applied along the UNIT vector of the direction, so one step is
 * the same distance whichever of the eight ways it goes — a corner is not
 * quietly forty percent further out than a side.
 */
const labelCandidateAt: (
  marker: MapMarker,
  zoom: number,
  direction: LabelDirection,
  push: number,
) => LabelCandidate = (
  marker: MapMarker,
  zoom: number,
  direction: LabelDirection,
  push: number,
): LabelCandidate => {
  const step: { x: number; y: number } = DIRECTION_STEPS[direction];
  const length: number = Math.sqrt(step.x * step.x + step.y * step.y);
  const unitX: number = step.x / length;
  const unitY: number = step.y / length;

  const half: number = markerHalfExtent(marker);
  const size: { width: number; height: number } = labelBoxSize(marker);
  const markerX: number = marker.x * zoom;
  const markerY: number = marker.y * zoom;

  const centerX: number =
    markerX + step.x * (half + LABEL_SIDE_GAP + size.width / 2) + unitX * push;
  const centerY: number = markerY + step.y * (half + LABEL_GAP) + unitY * push;

  /*
   * The text itself is narrower than its box by the padding either side.
   * A name beside its marker is anchored on the edge nearest the marker, so
   * it reads outwards from the thing it names.
   */
  const textWidth: number = size.width - LABEL_PADDING * 2;
  const textAnchor: LabelTextAnchor =
    step.x === 0 ? "middle" : step.x > 0 ? "start" : "end";
  const textX: number =
    step.x === 0
      ? centerX
      : step.x > 0
        ? centerX - textWidth / 2
        : centerX + textWidth / 2;

  return {
    direction: direction,
    push: push,
    rect: {
      left: centerX - size.width / 2,
      right: centerX + size.width / 2,
      top: centerY - size.height / 2,
      bottom: centerY + size.height / 2,
    },
    offsetX: textX - markerX,
    offsetY: centerY - markerY,
    textAnchor: textAnchor,
  };
};

// The marker's own body, in the same screen units as its label rect.
const markerBodyRect: (marker: MapMarker, zoom: number) => LabelBounds = (
  marker: MapMarker,
  zoom: number,
): LabelBounds => {
  const half: number = markerHalfExtent(marker);
  const centerX: number = marker.x * zoom;
  const centerY: number = marker.y * zoom;
  return {
    left: centerX - half,
    right: centerX + half,
    top: centerY - half,
    bottom: centerY + half,
  };
};

const rectsOverlap: (a: LabelBounds, b: LabelBounds) => boolean = (
  a: LabelBounds,
  b: LabelBounds,
): boolean => {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
};

/**
 * The thread from a marker to a pushed name, or null when the name is still
 * sitting against its marker and nothing needs explaining.
 *
 * Relative to the marker's drawn position, in screen units.
 */
const leaderLineFor: (
  marker: MapMarker,
  zoom: number,
  candidate: LabelCandidate,
) => LabelLeaderLine | null = (
  marker: MapMarker,
  zoom: number,
  candidate: LabelCandidate,
): LabelLeaderLine | null => {
  if (candidate.push <= 0) {
    return null;
  }

  const markerX: number = marker.x * zoom;
  const markerY: number = marker.y * zoom;
  /*
   * The point on the label's box closest to the marker — which for a name
   * directly below is the middle of its top edge, and for a name off to one
   * side is the middle of its near edge. Aiming at the box rather than at
   * the text keeps the thread from ending inside the glyphs.
   */
  const nearX: number = Math.min(
    Math.max(markerX, candidate.rect.left),
    candidate.rect.right,
  );
  const nearY: number = Math.min(
    Math.max(markerY, candidate.rect.top),
    candidate.rect.bottom,
  );

  const deltaX: number = nearX - markerX;
  const deltaY: number = nearY - markerY;
  const distance: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const half: number = markerHalfExtent(marker);
  // Nothing to draw if the box reaches the marker's edge on its own.
  if (distance <= half) {
    return null;
  }

  return {
    x1: (deltaX / distance) * half,
    y1: (deltaY / distance) * half,
    x2: deltaX,
    y2: deltaY,
  };
};

/**
 * Whether a line segment passes through a box.
 *
 * Liang–Barsky, which answers this without allocating and without a special
 * case for a vertical or horizontal segment — and both are the common case
 * here, since a name pushed straight down has a perfectly vertical thread.
 * Touching an edge does not count as crossing it: a thread that ends exactly
 * on a neighbouring box's edge is not passing through it.
 */
const segmentCrossesRect: (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: LabelBounds,
) => boolean = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: LabelBounds,
): boolean => {
  const deltaX: number = x2 - x1;
  const deltaY: number = y2 - y1;
  const edges: Array<number> = [-deltaX, deltaX, -deltaY, deltaY];
  const distances: Array<number> = [
    x1 - rect.left,
    rect.right - x1,
    y1 - rect.top,
    rect.bottom - y1,
  ];

  let enter: number = 0;
  let exit: number = 1;

  for (let index: number = 0; index < 4; index++) {
    const edge: number = edges[index]!;
    const distance: number = distances[index]!;
    if (edge === 0) {
      // Parallel to this edge: outside it means the segment misses entirely.
      if (distance < 0) {
        return false;
      }
      continue;
    }
    const crossing: number = distance / edge;
    if (edge < 0) {
      if (crossing > exit) {
        return false;
      }
      if (crossing > enter) {
        enter = crossing;
      }
    } else {
      if (crossing < enter) {
        return false;
      }
      if (crossing < exit) {
        exit = crossing;
      }
    }
  }

  return enter < exit;
};

/**
 * Where each marker draws its name at this zoom — and which markers, if any,
 * do not get to draw one at all.
 *
 * Three regions whose centroids fall in the same corner of a state print
 * their names on top of each other, which is worse than printing none of
 * them: an overlapped label is unreadable AND it hides its neighbour. So
 * names are placed greedily in paint order — biggest marker first, since
 * that is the one a reader is most likely to be looking for — and each one
 * takes the first position that is clear of every name already placed and
 * of every other marker's body. A name half-covered by the neighbouring
 * region's disc reads as a rendering bug, not as a dense map.
 *
 * "The first position" is a spiral outwards: the eight places around the
 * marker itself, then the same eight a step further out, and so on up to
 * MAX_LABEL_PUSH — see the note above LABEL_PUSH_STEP for why a name has to
 * be allowed to leave its marker at all. A name that has been pushed keeps a
 * thread back, and the search prefers a position whose thread crosses
 * nothing to one that fits but has to cross a name already on the map.
 *
 * Zoom is the only thing this depends on, not the pan: markers keep their
 * relative distances as the frame moves, so a drag never re-decides where a
 * name goes. Zooming in genuinely separates markers that are apart in the
 * world, and their names walk back in towards them.
 */
export const resolveMarkerLabels: (
  markers: Array<MapMarker>,
  zoom: number,
) => Map<string, LabelPlacement> = (
  markers: Array<MapMarker>,
  zoom: number,
): Map<string, LabelPlacement> => {
  const safeZoom: number = safeMapZoom(zoom);
  const resolved: Map<string, LabelPlacement> = new Map<
    string,
    LabelPlacement
  >();
  const placed: Array<LabelBounds> = [];

  /*
   * A marker with coordinates that are not finite is drawn nowhere, so it has
   * no body to keep clear of and no place to hang a name. Its entry is null
   * rather than a rectangle of NaNs, because every comparison against a NaN
   * is false and rectsOverlap would therefore report it as overlapping EVERY
   * candidate — costing every other marker on the level its name.
   *
   * Geo/MarkerLayout.ts passes the same markers straight through for the
   * same reason: this is not the place that decides whether they are drawn.
   */
  const bodies: Array<LabelBounds | null> = markers.map(
    (marker: MapMarker): LabelBounds | null => {
      return Number.isFinite(marker.x) && Number.isFinite(marker.y)
        ? markerBodyRect(marker, safeZoom)
        : null;
    },
  );

  let visits: number = 0;

  const fits: (rect: LabelBounds, index: number) => boolean = (
    rect: LabelBounds,
    index: number,
  ): boolean => {
    for (const other of placed) {
      if (rectsOverlap(rect, other)) {
        return false;
      }
    }
    for (let other: number = 0; other < bodies.length; other++) {
      const body: LabelBounds | null = bodies[other]!;
      /*
       * Its own body never counts: the label is deliberately placed hard
       * against it, and a generous glyph-width estimate can graze it.
       */
      if (other !== index && body && rectsOverlap(rect, body)) {
        return false;
      }
    }
    return true;
  };

  /*
   * A thread that runs through a name, or through another marker, is worse
   * than no thread: it points at the wrong thing. Nothing is dropped over
   * it — a crossed thread still beats a missing name — but a position that
   * avoids it wins over one that does not.
   */
  const threadIsClear: (
    marker: MapMarker,
    leader: LabelLeaderLine,
    index: number,
  ) => boolean = (
    marker: MapMarker,
    leader: LabelLeaderLine,
    index: number,
  ): boolean => {
    const fromX: number = marker.x * safeZoom + leader.x1;
    const fromY: number = marker.y * safeZoom + leader.y1;
    const toX: number = marker.x * safeZoom + leader.x2;
    const toY: number = marker.y * safeZoom + leader.y2;
    for (const other of placed) {
      if (segmentCrossesRect(fromX, fromY, toX, toY, other)) {
        return false;
      }
    }
    for (let other: number = 0; other < bodies.length; other++) {
      const body: LabelBounds | null = bodies[other]!;
      if (
        other !== index &&
        body &&
        segmentCrossesRect(fromX, fromY, toX, toY, body)
      ) {
        return false;
      }
    }
    return true;
  };

  /*
   * The spiral, walked outwards. The first position that fits AND whose
   * thread crosses nothing wins outright; the first that merely fits is
   * kept as the fallback, so a name is only ever dropped when the whole
   * spiral had nowhere to put it.
   */
  const chooseCandidate: (
    marker: MapMarker,
    index: number,
  ) => LabelCandidate | null = (
    marker: MapMarker,
    index: number,
  ): LabelCandidate | null => {
    let fallback: LabelCandidate | null = null;

    for (
      let push: number = 0;
      push <= MAX_LABEL_PUSH;
      push += LABEL_PUSH_STEP
    ) {
      /*
       * Out of budget: the eight positions AGAINST the marker are still
       * tried — they are eight comparisons, and they are the ones that fit
       * on an ordinary map — but the spiral stops here. Degrading to "a name
       * with room around it keeps it" beats a cliff where every remaining
       * marker on the level goes nameless at once.
       */
      if (push > 0 && visits >= MAX_LABEL_CANDIDATE_VISITS) {
        return fallback;
      }

      for (const direction of LABEL_DIRECTIONS) {
        visits++;

        const candidate: LabelCandidate = labelCandidateAt(
          marker,
          safeZoom,
          direction,
          push,
        );
        if (!fits(candidate.rect, index)) {
          continue;
        }

        const leader: LabelLeaderLine | null = leaderLineFor(
          marker,
          safeZoom,
          candidate,
        );
        if (!leader || threadIsClear(marker, leader, index)) {
          return candidate;
        }
        if (!fallback) {
          fallback = candidate;
        }
      }
    }

    return fallback;
  };

  for (let index: number = 0; index < markers.length; index++) {
    const marker: MapMarker = markers[index]!;
    // No name to draw, or nowhere on the map to draw it (see `bodies`).
    if (!marker.label || !bodies[index]) {
      continue;
    }

    const candidate: LabelCandidate | null = chooseCandidate(marker, index);
    if (!candidate) {
      continue;
    }

    placed.push(candidate.rect);
    resolved.set(marker.key, {
      direction: candidate.direction,
      push: candidate.push,
      offsetX: candidate.offsetX,
      offsetY: candidate.offsetY,
      textAnchor: candidate.textAnchor,
      leaderLine: leaderLineFor(marker, safeZoom, candidate),
    });
  }

  return resolved;
};

/**
 * The box resolveMarkerLabels reserved for this name, in screen units.
 *
 * The pass guarantees these do not overlap each other or any marker's body;
 * that guarantee is only worth anything while everything that cares about a
 * name's footprint asks the same function for it, rather than rebuilding the
 * geometry from the offsets and a guess at the glyph width.
 */
export const labelBounds: (
  marker: MapMarker,
  zoom: number,
  placement: LabelPlacement,
) => LabelBounds = (
  marker: MapMarker,
  zoom: number,
  placement: LabelPlacement,
): LabelBounds => {
  return labelCandidateAt(
    marker,
    safeMapZoom(zoom),
    placement.direction,
    placement.push,
  ).rect;
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

/*
 * ── Where a marker is DRAWN ────────────────────────────────────────────
 *
 * Paint order stopped being enough the moment two markers landed on the same
 * point. The smaller one being painted last only helps while there is some
 * of the bigger one left to see: a market whose centroid is its parent's, or
 * six regions whose derived positions all average out over the same city,
 * draw N markers in one place and show ONE. The rest cannot be hovered,
 * named or clicked, and nothing on screen admits they exist.
 *
 * So markers are laid out before they are drawn: anything that would cover
 * another is pushed off it by the smallest amount that clears the overlap,
 * and keeps a line back to where it really is. See Geo/MarkerLayout.ts.
 */

// A marker plus where the map actually draws it.
export interface PlacedMapMarker extends MapMarker {
  // Where the marker belongs — the far end of its leader line.
  anchorX: number;
  anchorY: number;
  /*
   * Pushed clear of the spot it belongs to, rather than merely nudged within
   * its own footprint. The map draws a leader line for exactly these, and
   * says so in the legend.
   */
  needsLeaderLine: boolean;
}

/**
 * The radius that has to stay clear around a marker, in screen units: its
 * own radius, or — for a container — the radius of the circle that contains
 * the square it is drawn as.
 */
export const collisionRadiusOfMarker: (marker: MapMarker) => number = (
  marker: MapMarker,
): number => {
  const radius: number =
    Number.isFinite(marker.screenRadius) && marker.screenRadius > 0
      ? marker.screenRadius
      : 0;
  return marker.isContainer ? radius * CONTAINER_COLLISION_FACTOR : radius;
};

/**
 * Place markers so that none of them covers another at this zoom.
 *
 * Returns the markers in PAINT order — the order they came in — each
 * carrying the position it is drawn at, the position it belongs to, and
 * whether the two differ enough to be worth a leader line. Markers with room
 * around them come back untouched, so a map with nothing overlapping on it
 * draws every marker exactly where the customer's coordinates put it.
 */
export const layoutMapMarkers: (
  markers: Array<MapMarker>,
  zoom: number,
) => Array<PlacedMapMarker> = (
  markers: Array<MapMarker>,
  zoom: number,
): Array<PlacedMapMarker> => {
  const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
    markers.map((marker: MapMarker): CollidableMarker => {
      return {
        key: marker.key,
        x: marker.x,
        y: marker.y,
        radius: collisionRadiusOfMarker(marker),
      };
    }),
    zoom,
  );

  return markers.map((marker: MapMarker, index: number): PlacedMapMarker => {
    const placement: MarkerPlacement | undefined = placements[index];
    if (!placement) {
      return {
        ...marker,
        anchorX: marker.x,
        anchorY: marker.y,
        needsLeaderLine: false,
      };
    }
    return {
      ...marker,
      x: placement.x,
      y: placement.y,
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      needsLeaderLine: placement.needsLeaderLine,
    };
  });
};

/*
 * ── Link lines ─────────────────────────────────────────────────────────
 *
 * A map of where the sites are is only half of a network. The other half is
 * what is CONNECTED to what — the WAN links, the fibre pairs — and until
 * now those existed on this page only as a strip of chips under the map and
 * as edges on the child graph, never on the map itself.
 *
 * Two rules matter here, and both come straight from what a link IS:
 *
 *   A link is drawn whether or not a monitor is attached to it. The monitor
 *   decides the line's COLOR, never whether the line exists — a fibre pair
 *   nobody has pointed a monitor at is still part of the network, and a map
 *   that hid it would be describing a different network from the one the
 *   customer modelled.
 *
 *   A line is drawn between MARKERS, at the positions the markers are
 *   actually drawn at (see layoutMapMarkers). A line to where a marker
 *   would have been if it had not been nudged clear of its neighbour points
 *   at nothing.
 */

/*
 * The neutral a link with no monitor on it is drawn in — slate-400, the
 * same neutral the child graph uses for its unmonitored edges, so the two
 * views of the same link agree.
 */
export const DEFAULT_MAP_LINK_COLOR: string = "#94a3b8";

/*
 * How far apart two links between the SAME pair of markers bow, in screen
 * units. Drawn straight, the second of them would sit exactly on top of the
 * first: one line on screen where the customer has modelled two, with the
 * one on top silently deciding what color the pair looks like.
 */
export const MAP_LINK_PARALLEL_OFFSET: number = 16;

/**
 * How far the nth link between one pair of markers bows away from the
 * straight line between them, in screen units.
 *
 * The first is straight — the overwhelmingly common case is one link
 * between two sites, and bowing it would be decoration. The rest alternate
 * sides in widening steps so a bundle stays symmetric about the line it
 * belongs to instead of drifting off to one side.
 */
export const parallelLinkOffset: (index: number) => number = (
  index: number,
): number => {
  const safeIndex: number =
    Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  if (safeIndex === 0) {
    return 0;
  }
  const step: number = Math.ceil(safeIndex / 2);
  const side: number = safeIndex % 2 === 1 ? 1 : -1;
  return side * step * MAP_LINK_PARALLEL_OFFSET;
};

/**
 * The color a link's line is drawn in: the color of the monitor status
 * attached to it, or the neutral when there is no monitor (or when the
 * status carries no color of its own).
 */
export const mapLinkColor: (link: {
  monitorStatus?: { color: string | undefined } | undefined;
}) => string = (link: {
  monitorStatus?: { color: string | undefined } | undefined;
}): string => {
  return (
    (link.monitorStatus && link.monitorStatus.color) || DEFAULT_MAP_LINK_COLOR
  );
};

/**
 * Hover/accessible text for one line: what the link is called, and what the
 * monitor on it currently says. "No monitor attached" is the honest answer
 * for an unmonitored link — the line is grey because nothing is watching
 * it, not because something is wrong.
 */
export const describeMapLink: (link: {
  name: string;
  monitorStatus?: { name: string } | undefined;
}) => string = (link: {
  name: string;
  monitorStatus?: { name: string } | undefined;
}): string => {
  const name: string = link.name || "Unnamed link";
  return `${name} — ${
    link.monitorStatus ? link.monitorStatus.name : "No monitor attached"
  }`;
};

// What buildMapLinks needs off a marker: its identity, its sites, its spot.
export interface LinkableMarker {
  key: string;
  ids: Array<string>;
  x: number;
  y: number;
}

// One drawable line. All coordinates are viewBox units.
export interface DrawableMapLink {
  // Stable across re-renders — React's key. Link ids are unique.
  key: string;
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /*
   * Quadratic control point. Equal to the midpoint for a straight line, so
   * a single link between two markers draws as a plain segment.
   */
  controlX: number;
  controlY: number;
  // Where the drawn curve passes at its middle — the hover anchor.
  midX: number;
  midY: number;
  color: string;
  /*
   * A monitor is attached, so the color means something. Lines without one
   * are drawn dashed: the difference between "no monitor is watching this"
   * and "a monitor is watching this and it is fine" must survive a customer
   * whose operational status happens to be a grey.
   */
  hasMonitor: boolean;
  tooltip: string;
}

export interface BuildMapLinksInput {
  links: Array<MapLinkView>;
  // The markers as DRAWN (see layoutMapMarkers), in paint order.
  markers: Array<LinkableMarker>;
  // Current map zoom — bows stay a constant size on screen.
  zoom: number;
}

/**
 * Turn link rows into drawable lines between the markers on the map.
 *
 * A link is dropped only when the map cannot draw it:
 *
 *   - an end that has no marker (the site is not on this level, or it has
 *     no coordinates anywhere beneath it), or
 *   - both ends on the SAME marker. That is not a line, it is a dot — and
 *     in "all" mode it happens honestly, when two linked sites are close
 *     enough to share one clustered marker.
 *
 * A missing monitor is never a reason to drop one.
 *
 * Output order is input order, and parallel links between one pair of
 * markers are bowed apart in the order they arrive, so the same payload
 * always draws the same picture.
 */
export const buildMapLinks: (
  input: BuildMapLinksInput,
) => Array<DrawableMapLink> = (
  input: BuildMapLinksInput,
): Array<DrawableMapLink> => {
  const safeZoom: number =
    Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;

  /*
   * Every site id to the marker that stands for it. In grouped mode that is
   * one id per marker; in "all" mode a clustered marker speaks for all of
   * the sites in it, which is what lets a link between two clustered sites
   * still be drawn between the clusters.
   */
  const markerBySiteId: Map<string, LinkableMarker> = new Map<
    string,
    LinkableMarker
  >();
  for (const marker of input.markers) {
    for (const siteId of marker.ids) {
      if (!markerBySiteId.has(siteId)) {
        markerBySiteId.set(siteId, marker);
      }
    }
  }

  const drawnPerPair: Map<string, number> = new Map<string, number>();
  const lines: Array<DrawableMapLink> = [];

  for (const link of input.links) {
    const from: LinkableMarker | undefined = markerBySiteId.get(
      link.fromSiteId,
    );
    const to: LinkableMarker | undefined = markerBySiteId.get(link.toSiteId);
    if (!from || !to || from.key === to.key) {
      continue;
    }

    // Order-independent: A→B and B→A belong to the same bundle.
    const pairKey: string =
      from.key < to.key ? `${from.key}|${to.key}` : `${to.key}|${from.key}`;
    const indexInPair: number = drawnPerPair.get(pairKey) || 0;
    drawnPerPair.set(pairKey, indexInPair + 1);

    const deltaX: number = to.x - from.x;
    const deltaY: number = to.y - from.y;
    const length: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    /*
     * The unit normal the bow is measured along. Two markers on the exact
     * same point have no direction to be perpendicular to; bowing straight
     * up at least keeps a bundle of links between them apart.
     */
    const normalX: number = length > 0 ? -deltaY / length : 0;
    const normalY: number = length > 0 ? deltaX / length : -1;

    const bow: number = parallelLinkOffset(indexInPair) / safeZoom;
    const midX: number = (from.x + to.x) / 2 + normalX * bow;
    const midY: number = (from.y + to.y) / 2 + normalY * bow;

    lines.push({
      key: link.id,
      id: link.id,
      name: link.name,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      /*
       * A quadratic curve passes through its control point at half the
       * offset, so the control goes twice as far out as the bow the drawn
       * line is meant to have.
       */
      controlX: (from.x + to.x) / 2 + normalX * bow * 2,
      controlY: (from.y + to.y) / 2 + normalY * bow * 2,
      midX: midX,
      midY: midY,
      color: mapLinkColor(link),
      hasMonitor: Boolean(link.monitorStatus),
      tooltip: describeMapLink(link),
    });
  }

  return lines;
};

/**
 * The SVG path for one line: a quadratic through its control point, which
 * is the straight segment when the link is not bowed.
 */
export const mapLinkPath: (link: DrawableMapLink) => string = (
  link: DrawableMapLink,
): string => {
  return `M ${link.x1} ${link.y1} Q ${link.controlX} ${link.controlY} ${link.x2} ${link.y2}`;
};
