import {
  ClusterColorKey,
  decideClusterColorKey,
  ClusterColorMember,
  clusterRadius,
  truncateMarkerLabel,
  resolveMarkerLabels,
  LabelPlacement,
  MapMarker,
  LABEL_FONT_SIZE,
  MAX_LABELLED_MARKERS,
} from "../../NetworkSite/SiteMapViewModel";
import {
  GeoCluster,
  GeoClusterPoint,
  clusterPoints,
} from "../../NetworkSite/Geo/GeoClusterUtil";
import {
  ProjectedPoint,
  projectRobinson,
} from "../../NetworkSite/Geo/GeoProjection";
import {
  MapViewport,
  ViewportPoint,
  countPointsInViewport,
  fitViewportToPoints,
  screenLengthToViewportLength,
} from "../../NetworkSite/Geo/GeoViewport";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

/*
 * Pure, react-free view-model for the Network Map dashboard widget:
 * narrowing NetworkSite rows into pins, clustering them, and deciding what
 * each marker looks like and says.
 *
 * Kept out of the component for the same reason the Network Map page's
 * geometry is (see NetworkSite/Geo/GeoProjection.ts): the App project does
 * not have `react` on its resolution path, so this logic can only be
 * unit-tested while it stays out of a .tsx file.
 *
 * The widget is NOT the drill-down map from Pages/NetworkSite/NetworkMap. It
 * never navigates a hierarchy, so there are no containers, no derived
 * centroids and no rollups here: every marker stands for one or more real,
 * coordinate-bearing sites, and its color is decided by those sites alone.
 *
 * Everything here is deterministic: same input, same output, no randomness
 * and no clock access.
 */

/*
 * Real latitude and longitude ranges. A CSV import that shifts a column by
 * one puts a longitude in the latitude field, and a latitude of 1246.7 would
 * otherwise project to a marker — and a frame fitted around it — somewhere no
 * site is. Same bounds the /network-site/map parser enforces.
 */
const MAX_LATITUDE: number = 90;
const MAX_LONGITUDE: number = 180;

/*
 * Marker palette, mirroring SiteGeoMap so the widget and the full Network
 * Map page never disagree about what a color means.
 */
export const NETWORK_MAP_COLORS: Record<ClusterColorKey, string> = {
  none: "#9ca3af", // gray-400
  ok: "#10b981", // emerald-500
  down: "#ef4444", // red-500
  mixed: "#f59e0b", // amber-500
};

export interface NetworkMapLegendEntry {
  key: ClusterColorKey;
  label: string;
  color: string;
}

/*
 * Legend entries in the order a reader scans for trouble: healthy first,
 * then the two degrees of "look at me", then the absence of data.
 */
export const NETWORK_MAP_LEGEND: Array<NetworkMapLegendEntry> = [
  { key: "ok", label: "Operational", color: NETWORK_MAP_COLORS.ok },
  { key: "mixed", label: "Degraded", color: NETWORK_MAP_COLORS.mixed },
  { key: "down", label: "Offline", color: NETWORK_MAP_COLORS.down },
  { key: "none", label: "No status", color: NETWORK_MAP_COLORS.none },
];

/*
 * A NetworkSite row as the widget's fetch hands it over — every field
 * optional, because ModelAPI returns Postgres NULLs as null and a site that
 * has never been rolled up carries no status at all.
 */
export interface NetworkMapSiteInput {
  id?: string | null | undefined;
  name?: string | null | undefined;
  siteType?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  statusName?: string | null | undefined;
  statusColor?: string | null | undefined;
  statusPriority?: number | null | undefined;
  isOperational?: boolean | null | undefined;
}

// A site the widget can actually draw: identified, named and placeable.
export interface NetworkMapSite {
  id: string;
  name: string;
  siteType: string;
  latitude: number;
  longitude: number;
  statusName: string;
  /*
   * The customer's own color for this status, when they set one. Null means
   * "use the palette" — the health key decides instead.
   */
  statusColor: string | null;
  statusPriority: number;
  isOperational: boolean | null;
}

export interface NetworkMapSitesResult {
  sites: Array<NetworkMapSite>;
  /*
   * Rows that exist but have no place on the map: no coordinates, or
   * coordinates outside the real latitude/longitude ranges. Reported rather
   * than dropped silently — a site missing from the map with nothing saying
   * so is a bug report waiting to happen.
   */
  unplacedCount: number;
}

export const UNNAMED_SITE_LABEL: string = "Unnamed site";
export const UNKNOWN_STATUS_LABEL: string = "No status yet";

const asCoordinate: (value: unknown, limit: number) => number | null = (
  value: unknown,
  limit: number,
): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value >= -limit && value <= limit ? value : null;
};

const asText: (value: unknown, fallback: string) => string = (
  value: unknown,
  fallback: string,
): string => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

/**
 * Narrow fetched rows into the sites the widget can draw.
 *
 * A row without an id is dropped outright — it could not be keyed, deduped
 * or linked. A row that has an id but no usable position is counted as
 * unplaced, so the widget can say how much of the network is missing from
 * the picture instead of pretending the map is complete.
 */
export const toNetworkMapSites: (
  rows: Array<NetworkMapSiteInput>,
) => NetworkMapSitesResult = (
  rows: Array<NetworkMapSiteInput>,
): NetworkMapSitesResult => {
  const sites: Array<NetworkMapSite> = [];
  let unplacedCount: number = 0;

  for (const row of rows || []) {
    const id: string = asText(row?.id, "");
    if (!id) {
      continue;
    }

    const latitude: number | null = asCoordinate(row?.latitude, MAX_LATITUDE);
    const longitude: number | null = asCoordinate(
      row?.longitude,
      MAX_LONGITUDE,
    );

    if (latitude === null || longitude === null) {
      unplacedCount++;
      continue;
    }

    const statusPriority: unknown = row?.statusPriority;

    sites.push({
      id: id,
      name: asText(row?.name, UNNAMED_SITE_LABEL),
      siteType: asText(row?.siteType, ""),
      latitude: latitude,
      longitude: longitude,
      statusName: asText(row?.statusName, UNKNOWN_STATUS_LABEL),
      statusColor: asText(row?.statusColor, "") || null,
      statusPriority:
        typeof statusPriority === "number" && Number.isFinite(statusPriority)
          ? statusPriority
          : 0,
      isOperational:
        typeof row?.isOperational === "boolean" ? row.isOperational : null,
    });
  }

  return { sites: sites, unplacedCount: unplacedCount };
};

/*
 * Grid cell size for clustering, in whole-world viewBox units — the same
 * constant SiteGeoMap uses, so two nearby stores merge at the same distance
 * on both surfaces.
 */
export const NETWORK_MAP_CLUSTER_CELL_SIZE: number = 28;

/*
 * The most sites the widget will ever ask the server for. One below
 * LIMIT_PER_PROJECT because the fetch deliberately requests one row MORE
 * than the cap, to tell "exactly at the cap" apart from "there is more" —
 * and the server rejects a limit above LIMIT_PER_PROJECT outright.
 */
export const NETWORK_MAP_MAX_SITES_CEILING: number = LIMIT_PER_PROJECT - 1;

/**
 * The row cap to actually fetch with, from whatever the saved widget
 * arguments hold.
 *
 * COERCES rather than type-tests. The settings form renders Max Sites as an
 * `<input type="number">` whose onChange hands back `e.target.value` — a
 * STRING — and the arguments form copies those values into the component
 * verbatim. A `typeof === "number"` guard therefore ignores the number the
 * user just typed and silently keeps the default, which is the one failure
 * a settings field must never have.
 */
export const resolveNetworkMapMaxSites: (
  value: unknown,
  fallback: number,
) => number = (value: unknown, fallback: number): number => {
  const parsed: number = Number(
    typeof value === "string" ? value.trim() : value,
  );

  /*
   * An empty string coerces to 0 through Number(), and a cleared field is
   * "use the default", not "draw nothing" — so anything below 1 falls back.
   */
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), NETWORK_MAP_MAX_SITES_CEILING);
};

/*
 * Label size, re-exported from the full map so the renderer draws names at
 * exactly the size resolveMarkerLabels measured them at. Two different
 * constants would mean the collision pass approving a layout the map then
 * draws differently — which is worse than no collision pass, since it would
 * look deliberate.
 *
 * There is no gap constant here any more, and there must not be one: every
 * offset a name is drawn at now comes back on its LabelPlacement, so the
 * renderer has nothing left to re-derive.
 */
export const NETWORK_MAP_LABEL_FONT_SIZE: number = LABEL_FONT_SIZE;

/**
 * Cluster cell size for the current viewport, in viewBox units.
 *
 * This is what makes zoom mean something: the cell is a constant distance ON
 * SCREEN, so it covers less of the world the further in the map is zoomed,
 * and a lump of nearby sites breaks apart into individual markers instead of
 * staying one blob at every zoom.
 */
export const networkMapClusterCellSize: (viewport: MapViewport) => number = (
  viewport: MapViewport,
): number => {
  return screenLengthToViewportLength(NETWORK_MAP_CLUSTER_CELL_SIZE, viewport);
};

// One drawable marker. Position is viewBox units; radius is screen units.
export interface NetworkMapMarker {
  // Stable for the same geometry — React's key.
  key: string;
  x: number;
  y: number;
  // The sites this marker stands for, in the order clusterPoints sorted them.
  ids: Array<string>;
  count: number;
  screenRadius: number;
  colorKey: ClusterColorKey;
  /*
   * The color actually painted. A marker that stands for ONE site uses that
   * site's own status color when the customer set one, so a bespoke
   * "Maintenance" status looks the same here as everywhere else in the
   * product. Clusters fall back to the palette — mixing two customer colors
   * into one dot would say nothing true about either.
   */
  color: string;
  /** Name drawn under the marker, or "" when this marker gets no label. */
  label: string;
  /*
   * Where that name sits relative to the marker, and how to draw it: the
   * offset from the marker, the text anchor, and the thread back to the
   * marker for a name that had to be pushed off it. Null when the marker
   * carries no name at all.
   */
  labelPlacement: LabelPlacement | null;
  tooltip: string;
}

const clusterTooltip: (
  cluster: GeoCluster,
  siteById: Map<string, NetworkMapSite>,
) => string = (
  cluster: GeoCluster,
  siteById: Map<string, NetworkMapSite>,
): string => {
  if (cluster.ids.length === 1) {
    const site: NetworkMapSite | undefined = siteById.get(cluster.ids[0]!);
    if (!site) {
      return "";
    }
    const parts: Array<string> = [site.name];
    if (site.siteType) {
      parts.push(site.siteType);
    }
    parts.push(site.statusName);
    return parts.join(" · ");
  }

  const names: Array<string> = cluster.ids
    .slice(0, 5)
    .map((id: string): string => {
      return siteById.get(id)?.name || UNNAMED_SITE_LABEL;
    });
  const more: number = cluster.ids.length - names.length;

  return `${cluster.totalCount} sites: ${names.join(", ")}${
    more > 0 ? `, +${more} more` : ""
  }`;
};

export interface BuildNetworkMapMarkersInput {
  sites: Array<NetworkMapSite>;
  // Grid cell size for clustering, in viewBox units.
  cellSize: number;
  /*
   * Whether the widget wants names under its markers at all. Even when it
   * does, a name is dropped when it cannot be placed clear of its
   * neighbours (see below), and they all come off past
   * MAX_LABELLED_MARKERS. The tooltip still carries every one.
   */
  showLabels: boolean;
  /*
   * Magnification of the frame the map will draw in. Label collision is a
   * SCREEN question — two markers a hair apart in the world are far apart
   * on a zoomed-in frame — so the layout cannot be decided without it.
   */
  zoom: number;
}

/**
 * Turn sites into drawable markers.
 *
 * Output order is paint order, and it is deterministic: markers are sorted
 * by descending count with the key as the tie-break, so the smallest marker
 * is painted last and a single store never disappears under the cluster that
 * holds its neighbours.
 *
 * Names are then placed greedily in that same order — biggest marker first,
 * since that is the one a reader is most likely to be looking for — spiralling
 * outwards from the marker until a position is clear of every name already
 * placed and of every other marker. A name pushed off its marker keeps a
 * thread back to it; a name with nowhere to go at all is DROPPED rather than
 * stacked on something, because an overlapped label is unreadable and it
 * hides its neighbour. See resolveMarkerLabels.
 */
export const buildNetworkMapMarkers: (
  input: BuildNetworkMapMarkersInput,
) => Array<NetworkMapMarker> = (
  input: BuildNetworkMapMarkersInput,
): Array<NetworkMapMarker> => {
  const siteById: Map<string, NetworkMapSite> = new Map<
    string,
    NetworkMapSite
  >();
  const pins: Array<GeoClusterPoint> = [];

  for (const site of input.sites) {
    siteById.set(site.id, site);

    const point: ProjectedPoint = projectRobinson(
      site.latitude,
      site.longitude,
    );

    pins.push({
      id: site.id,
      x: point[0],
      y: point[1],
      statusPriority: site.statusPriority,
      count: 1,
    });
  }

  /*
   * Sorted by id before clustering, not for tidiness: clusterPoints averages
   * member positions by accumulating them in INPUT order, and IEEE-754
   * addition is not associative. Three sites in one cell arriving in a
   * different order would otherwise produce a cluster centre differing in
   * the last bits — and the widget refetches on a timer, so the row order
   * really does vary between renders.
   */
  pins.sort((a: GeoClusterPoint, b: GeoClusterPoint): number => {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const clusters: Array<GeoCluster> = clusterPoints(pins, input.cellSize);

  /*
   * The label budget counts markers that COULD carry a name — only a cluster
   * of exactly one site does — rather than all markers. Counting every
   * marker meant an estate of fifty paired sites and three lone ones drew no
   * names at all, because fifty-three markers cleared the threshold while
   * only three of them were ever going to be labelled.
   */
  const labellableCount: number = clusters.filter(
    (cluster: GeoCluster): boolean => {
      return cluster.ids.length === 1;
    },
  ).length;
  const showLabels: boolean =
    input.showLabels && labellableCount <= MAX_LABELLED_MARKERS;

  const markers: Array<NetworkMapMarker> = clusters.map(
    (cluster: GeoCluster): NetworkMapMarker => {
      const members: Array<NetworkMapSite> = cluster.ids
        .map((id: string): NetworkMapSite | undefined => {
          return siteById.get(id);
        })
        .filter((site: NetworkMapSite | undefined): site is NetworkMapSite => {
          return site !== undefined;
        });

      const colorKey: ClusterColorKey = decideClusterColorKey(
        members.map((site: NetworkMapSite): ClusterColorMember => {
          return {
            statusPriority: site.statusPriority,
            isOperational: site.isOperational,
          };
        }),
      );

      const single: NetworkMapSite | undefined =
        members.length === 1 ? members[0] : undefined;

      return {
        /*
         * Keyed by its lowest member id — clusterPoints sorts ids
         * lexicographically, and a site belongs to exactly one cluster, so
         * this is both stable and unique. The cluster's centre must NOT be
         * in the key: it is a floating-point mean, so it would change in the
         * last bits with row order and remount every marker on a poll.
         */
        key: cluster.ids[0] as string,
        x: cluster.x,
        y: cluster.y,
        ids: cluster.ids,
        count: cluster.totalCount,
        screenRadius: clusterRadius(cluster.totalCount),
        colorKey: colorKey,
        /*
         * Always the widget's own palette, never the project's status color.
         * A project can name a status anything and color it anything, so
         * painting one site's own hex would mean the same status is one
         * color alone and another inside a cluster — and a third on the
         * Network Map page, which has always used this palette. The legend
         * under the map only tells the truth if every marker obeys it.
         */
        color: NETWORK_MAP_COLORS[colorKey],
        label: showLabels && single ? truncateMarkerLabel(single.name) : "",
        labelPlacement: null,
        tooltip: clusterTooltip(cluster, siteById),
      };
    },
  );

  markers.sort((a: NetworkMapMarker, b: NetworkMapMarker): number => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  /*
   * resolveMarkerLabels works over the full-map marker shape, which carries
   * an `isContainer` flag deciding whether the label clears a square or a
   * disc. Every marker here is a disc — this widget draws no containers —
   * so the flag is fixed false and the rest of the fields map straight over.
   */
  const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
    markers.map((marker: NetworkMapMarker): MapMarker => {
      return {
        key: marker.key,
        x: marker.x,
        y: marker.y,
        ids: marker.ids,
        count: marker.count,
        screenRadius: marker.screenRadius,
        colorKey: marker.colorKey,
        isContainer: false,
        isApproximate: false,
        label: marker.label,
        tooltip: marker.tooltip,
      };
    }),
    input.zoom,
    /*
     * Threads on, explicitly. The Network Map PAGE turns them off above its
     * unit level, where a name stands for a whole region and thirty threads
     * make a web (#3372) — but this widget has no levels: it draws one
     * marker per site and names only the markers that stand for exactly one
     * of them, which is the same thing a unit marker is. A name pushed clear
     * of a crowded city here is still pointing at one site, so it is worth
     * the line.
     */
    { allowLabelThreads: true },
  );

  return markers.map((marker: NetworkMapMarker): NetworkMapMarker => {
    const placement: LabelPlacement | undefined = placements.get(marker.key);

    if (!marker.label || !placement) {
      return { ...marker, label: "", labelPlacement: null };
    }

    return { ...marker, labelPlacement: placement };
  });
};

export interface NetworkMapStatusSummary {
  total: number;
  operational: number;
  down: number;
  unknown: number;
}

/**
 * How the drawn sites are doing, counted rather than colored. The widget
 * prints this above the map so a reader who cannot pick a two-pixel red dot
 * out of two hundred green ones still learns that one is red.
 */
export const networkMapStatusSummary: (
  sites: Array<NetworkMapSite>,
) => NetworkMapStatusSummary = (
  sites: Array<NetworkMapSite>,
): NetworkMapStatusSummary => {
  let operational: number = 0;
  let down: number = 0;
  let unknown: number = 0;

  for (const site of sites) {
    if (site.isOperational === true) {
      operational++;
    } else if (site.isOperational === false) {
      down++;
    } else {
      unknown++;
    }
  }

  return {
    total: sites.length,
    operational: operational,
    down: down,
    unknown: unknown,
  };
};

const pluralize: (count: number, singular: string) => string = (
  count: number,
  singular: string,
): string => {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
};

export interface NetworkMapCoverageInput {
  // Sites the widget drew.
  siteCount: number;
  // How many of them the current frame is holding.
  inViewCount: number;
  // Sites that exist but have no usable coordinates.
  unplacedCount: number;
  /*
   * The fetch came back at the row cap, so there may be sites the widget
   * never saw. Saying nothing here would make a truncated map look complete.
   */
  isTruncated: boolean;
}

/**
 * The map's coverage line: how much of the network this frame is holding,
 * and what it is not showing.
 *
 * A count that quietly shrinks as somebody zooms reads as sites
 * disappearing, so once the frame stops holding everything the line says
 * what it does hold.
 */
export const describeNetworkMapCoverage: (
  input: NetworkMapCoverageInput,
) => string = (input: NetworkMapCoverageInput): string => {
  const parts: Array<string> = [];

  if (input.inViewCount < input.siteCount) {
    parts.push(`${input.inViewCount} of ${input.siteCount} sites in view`);
  } else {
    parts.push(`${pluralize(input.siteCount, "site")} mapped`);
  }

  if (input.unplacedCount > 0) {
    parts.push(`${input.unplacedCount} without coordinates`);
  }

  if (input.isTruncated) {
    parts.push("more sites not shown");
  }

  return parts.join(" · ");
};

/**
 * The frame the widget opens on: fitted to the sites it drew, or the whole
 * world when it drew none.
 *
 * A dashboard tile has no drill state and no viewport controls to recover
 * from a bad opening frame, so this runs on every render of the site set
 * rather than once — the map always opens on the data it is showing.
 */
export const fitNetworkMapViewport: (
  sites: Array<NetworkMapSite>,
) => MapViewport = (sites: Array<NetworkMapSite>): MapViewport => {
  return fitViewportToPoints(networkMapPoints(sites));
};

/** Projected positions of these sites, in viewBox units. */
export const networkMapPoints: (
  sites: Array<NetworkMapSite>,
) => Array<ViewportPoint> = (
  sites: Array<NetworkMapSite>,
): Array<ViewportPoint> => {
  return sites.map((site: NetworkMapSite): ViewportPoint => {
    const point: ProjectedPoint = projectRobinson(
      site.latitude,
      site.longitude,
    );
    return { x: point[0], y: point[1] };
  });
};

/** How many of these sites the given frame is holding. */
export const countNetworkMapSitesInViewport: (
  sites: Array<NetworkMapSite>,
  viewport: MapViewport,
) => number = (sites: Array<NetworkMapSite>, viewport: MapViewport): number => {
  return countPointsInViewport(networkMapPoints(sites), viewport);
};
