/*
 * Pure aggregation logic behind the /network-site/map endpoint — the half
 * that turns a hierarchy into MARKERS.
 *
 * WHY THIS EXISTS
 *
 * The map used to plot every coordinate-bearing site in the project, flat,
 * and let screen-proximity clustering decide what a marker meant. On a
 * franchise network that produced numbered blobs ("104", "58") that
 * correspond to nothing a customer has ever named: they are however many
 * stores happened to fall in one grid cell at that zoom. Meanwhile the cards
 * under the map showed the actual hierarchy — the regions, the markets — so
 * the two halves of the page disagreed about what the network is.
 *
 * Worse, the levels a customer actually models — Region, Market, "Corp",
 * "Franchise Units" — are organizational rows with no coordinates of their
 * own, so they could never appear on the map at all. The one thing the map
 * was for, seeing the shape of the estate, was the one thing it could not
 * show.
 *
 * So the map is now LEVEL-SCOPED: one marker per child of the level being
 * viewed, exactly the set the cards below it list. A container child that
 * carries no coordinates of its own is placed at the centroid of the
 * descendants that do, and reports what is under it (units, how many are
 * operational, direct sites) so the marker can be sized and colored by its
 * rollup rather than by an accident of geography.
 *
 * Everything here is data-in/data-out so the centroid math, the subtree
 * assignment and the rollups are unit-testable without a database. Same
 * input, same output: no clock, no randomness.
 *
 * siteType is carried as a plain display string. isUnitLevel is the
 * load-bearing half — site types are per-project rows a customer can rename
 * ("Unit" → "Store" → "Restaurant"), so nothing here may compare siteType to
 * a literal. See NetworkSiteHierarchyUtil for the same rule on the
 * /network-site/children side.
 */

// A geographic position that has passed isUsableCoordinate.
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/*
 * Any site inside the viewed level's subtree, including the direct children
 * themselves — the aggregator seeds children first and skips them when it
 * walks this list, exactly like NetworkSiteHierarchyUtil.aggregateChildStats.
 */
export interface MapSubtreeRow {
  id: string;
  name?: string | undefined;
  isUnitLevel: boolean;
  parentSiteId?: string | undefined;
  materializedPath?: string | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  currentMonitorStatusId?: string | undefined;
}

// A direct child of the viewed level — one marker each.
export interface MapChildRow {
  id: string;
  name: string;
  siteType: string;
  isUnitLevel: boolean;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  currentMonitorStatusId?: string | undefined;
}

// What one marker reports about the subtree hanging off it.
export interface MapMarkerAggregate {
  /*
   * Where the marker goes. Null when neither the child nor anything under
   * it carries usable coordinates — such a child has no place on the map and
   * is reported separately rather than dropped silently.
   */
  latitude: number | null;
  longitude: number | null;
  /*
   * True when the position is the centroid of descendants rather than the
   * site's own coordinates. The UI says so: an inferred position must not
   * be presented with the same confidence as one somebody typed in.
   */
  isDerivedLocation: boolean;
  // Descendants (the child itself included) that could be placed, and not.
  locatedDescendantCount: number;
  unlocatedDescendantCount: number;
  // Unit-level rollup, the same figures the site card leads with.
  totalUnits: number;
  operationalUnits: number;
  // Direct children of the child — the next drill level's size.
  childSiteCount: number;
  // Worst (= highest priority) status anywhere in the child's subtree.
  worstStatusPriority: number;
  /*
   * Tri-state health of the subtree: false if anything in it is known
   * non-operational, true if everything carrying a status is operational,
   * null when nothing in it reports a status at all.
   */
  isOperational: boolean | null;
}

// The status columns the aggregator reasons about, keyed by status id.
export interface MapStatusInfo {
  priority: number;
  isOperationalState: boolean;
}

export const MIN_LATITUDE: number = -90;
export const MAX_LATITUDE: number = 90;
export const MIN_LONGITUDE: number = -180;
export const MAX_LONGITUDE: number = 180;

const DEGREES_TO_RADIANS: number = Math.PI / 180;
const RADIANS_TO_DEGREES: number = 180 / Math.PI;

/*
 * Below this the averaged unit vector has no meaningful direction — the
 * points cancelled each other out (the textbook case is two exactly
 * antipodal sites). Compared against the vector's LENGTH, which is 1 for a
 * single point and falls toward 0 as the points spread over the sphere.
 */
const DEGENERATE_CENTROID_EPSILON: number = 1e-9;

/**
 * Whether a latitude/longitude pair can be put on a map at all: both finite
 * numbers, and inside the real ranges.
 *
 * The range check is not pedantry. A CSV import that shifts a column by one
 * lands a longitude in the latitude field, and 1246.7 projected as a
 * latitude silently drags a marker (and the frame fitted around it) off to
 * a place no site is. Rejecting it puts the site in the "cannot be placed"
 * list, where the customer can see and fix it.
 */
export function isUsableCoordinate(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return false;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  if (latitude < MIN_LATITUDE || latitude > MAX_LATITUDE) {
    return false;
  }
  return longitude >= MIN_LONGITUDE && longitude <= MAX_LONGITUDE;
}

/**
 * The centroid of a set of points ON THE SPHERE: each is converted to a unit
 * vector, the vectors are averaged, and the mean direction is converted back
 * to a latitude and longitude.
 *
 * Averaging the raw numbers instead would be wrong in the two places it most
 * matters to a network that spans a country. Longitudes wrap: the mean of
 * +179 and -179 is 0 — the Gulf of Guinea — for two sites that are 2 degrees
 * apart in the Pacific. And latitudes converge: near the poles equal steps
 * in longitude are not equal distances, so a flat mean drifts. Unit vectors
 * have neither problem, and for the ordinary case of a few dozen stores in
 * one state they agree with the naive mean to well under a pixel.
 *
 * Returns null for an empty input, and for the degenerate case where the
 * points cancel out (antipodal), where no centroid exists to report.
 */
export function sphericalCentroid(points: Array<GeoPoint>): GeoPoint | null {
  if (points.length === 0) {
    return null;
  }

  let x: number = 0;
  let y: number = 0;
  let z: number = 0;
  let count: number = 0;

  for (const point of points) {
    if (!isUsableCoordinate(point.latitude, point.longitude)) {
      continue;
    }
    const latitude: number = point.latitude * DEGREES_TO_RADIANS;
    const longitude: number = point.longitude * DEGREES_TO_RADIANS;
    const cosLatitude: number = Math.cos(latitude);
    x += cosLatitude * Math.cos(longitude);
    y += cosLatitude * Math.sin(longitude);
    z += Math.sin(latitude);
    count++;
  }

  if (count === 0) {
    return null;
  }

  x /= count;
  y /= count;
  z /= count;

  const length: number = Math.sqrt(x * x + y * y + z * z);
  if (!Number.isFinite(length) || length < DEGENERATE_CENTROID_EPSILON) {
    return null;
  }

  const hypotenuse: number = Math.sqrt(x * x + y * y);
  const latitude: number = Math.atan2(z, hypotenuse) * RADIANS_TO_DEGREES;
  const longitude: number = Math.atan2(y, x) * RADIANS_TO_DEGREES;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude: latitude, longitude: longitude };
}

/*
 * Mutable accumulator — the public aggregate plus the points the centroid
 * is averaged from and the flags the health verdict is folded up from.
 */
interface MarkerAccumulator {
  ownPoint: GeoPoint | null;
  points: Array<GeoPoint>;
  locatedDescendantCount: number;
  unlocatedDescendantCount: number;
  totalUnits: number;
  operationalUnits: number;
  childSiteCount: number;
  worstStatusPriority: number;
  anyNonOperational: boolean;
  anyOperational: boolean;
  anyStatus: boolean;
}

function newAccumulator(): MarkerAccumulator {
  return {
    ownPoint: null,
    points: [],
    locatedDescendantCount: 0,
    unlocatedDescendantCount: 0,
    totalUnits: 0,
    operationalUnits: 0,
    childSiteCount: 0,
    worstStatusPriority: 0,
    anyNonOperational: false,
    anyOperational: false,
    anyStatus: false,
  };
}

function applyStatus(
  accumulator: MarkerAccumulator,
  statusId: string | undefined,
  statusById: Map<string, MapStatusInfo>,
): boolean {
  if (!statusId) {
    return false;
  }
  const status: MapStatusInfo | undefined = statusById.get(statusId);
  if (!status) {
    // Status row deleted since — no priority or verdict to reason with.
    return false;
  }
  accumulator.anyStatus = true;
  accumulator.worstStatusPriority = Math.max(
    accumulator.worstStatusPriority,
    Number.isFinite(status.priority) ? status.priority : 0,
  );
  if (status.isOperationalState) {
    accumulator.anyOperational = true;
  } else {
    accumulator.anyNonOperational = true;
  }
  return status.isOperationalState;
}

/**
 * Which of the viewed level's children a subtree row belongs under.
 *
 * Children are siblings, so at most one of their ids can appear in a
 * descendant's materialized path. Rows whose path is missing or has not
 * been backfilled fall back to a direct parent match, which at least places
 * the grandchildren correctly.
 */
function findSubtreeRoot(
  row: MapSubtreeRow,
  childIds: Set<string>,
): string | undefined {
  if (row.materializedPath) {
    for (const segment of row.materializedPath.split("/")) {
      if (segment && childIds.has(segment)) {
        return segment;
      }
    }
  }
  if (row.parentSiteId && childIds.has(row.parentSiteId)) {
    return row.parentSiteId;
  }
  return undefined;
}

export default class NetworkSiteMapUtil {
  /**
   * One marker aggregate per direct child of the viewed level.
   *
   * Position: the child's own coordinates when it has them — somebody typed
   * those in and they outrank anything inferred — otherwise the spherical
   * centroid of every located site in its subtree. A child with neither gets
   * a null position and is reported to the caller as unplaceable rather than
   * quietly dropped, because "Region 2100 is missing from the map" with no
   * explanation is the bug this whole endpoint exists to stop shipping.
   *
   * Rollups mirror the site card's, so the marker and the card under it
   * cannot disagree: unit-level descendants counted by the isUnitLevel FLAG
   * (never by a type name), operational ones counted against the caller's
   * set of operational status ids, and direct children counted for the
   * "what happens if I click this" figure. A child that is itself unit-level
   * reports exactly itself as its unit rollup — its own descendants, if it
   * somehow has any, do not add.
   */
  public static aggregateMapMarkers(data: {
    children: Array<MapChildRow>;
    descendants: Array<MapSubtreeRow>;
    statusById: Map<string, MapStatusInfo>;
  }): Map<string, MapMarkerAggregate> {
    const childIds: Set<string> = new Set<string>();
    const childIsUnitLevelById: Map<string, boolean> = new Map<
      string,
      boolean
    >();
    const accumulators: Map<string, MarkerAccumulator> = new Map<
      string,
      MarkerAccumulator
    >();

    for (const child of data.children) {
      childIds.add(child.id);
      childIsUnitLevelById.set(child.id, child.isUnitLevel);

      const accumulator: MarkerAccumulator = newAccumulator();
      const isOperational: boolean = applyStatus(
        accumulator,
        child.currentMonitorStatusId,
        data.statusById,
      );

      if (isUsableCoordinate(child.latitude, child.longitude)) {
        const point: GeoPoint = {
          latitude: child.latitude as number,
          longitude: child.longitude as number,
        };
        accumulator.ownPoint = point;
        accumulator.points.push(point);
        accumulator.locatedDescendantCount++;
      } else {
        accumulator.unlocatedDescendantCount++;
      }

      if (child.isUnitLevel) {
        accumulator.totalUnits = 1;
        accumulator.operationalUnits = isOperational ? 1 : 0;
      }

      accumulators.set(child.id, accumulator);
    }

    for (const row of data.descendants) {
      if (childIds.has(row.id)) {
        // The children themselves — already seeded above.
        continue;
      }

      const subtreeRoot: string | undefined = findSubtreeRoot(row, childIds);

      if (row.parentSiteId) {
        const parentAccumulator: MarkerAccumulator | undefined =
          accumulators.get(row.parentSiteId);
        if (parentAccumulator) {
          parentAccumulator.childSiteCount++;
        }
      }

      if (!subtreeRoot) {
        continue;
      }
      const accumulator: MarkerAccumulator = accumulators.get(subtreeRoot)!;

      const isOperational: boolean = applyStatus(
        accumulator,
        row.currentMonitorStatusId,
        data.statusById,
      );

      if (isUsableCoordinate(row.latitude, row.longitude)) {
        accumulator.points.push({
          latitude: row.latitude as number,
          longitude: row.longitude as number,
        });
        accumulator.locatedDescendantCount++;
      } else {
        accumulator.unlocatedDescendantCount++;
      }

      if (row.isUnitLevel && !childIsUnitLevelById.get(subtreeRoot)) {
        accumulator.totalUnits++;
        if (isOperational) {
          accumulator.operationalUnits++;
        }
      }
    }

    const result: Map<string, MapMarkerAggregate> = new Map<
      string,
      MapMarkerAggregate
    >();

    for (const [childId, accumulator] of accumulators) {
      /*
       * Explicit coordinates beat an inferred centroid: a customer who
       * pinned their regional office meant the marker to sit there, not at
       * the middle of the stores it happens to own.
       */
      const derived: GeoPoint | null = accumulator.ownPoint
        ? null
        : sphericalCentroid(accumulator.points);
      const position: GeoPoint | null = accumulator.ownPoint || derived;

      result.set(childId, {
        latitude: position ? position.latitude : null,
        longitude: position ? position.longitude : null,
        isDerivedLocation: Boolean(!accumulator.ownPoint && position),
        locatedDescendantCount: accumulator.locatedDescendantCount,
        unlocatedDescendantCount: accumulator.unlocatedDescendantCount,
        totalUnits: accumulator.totalUnits,
        operationalUnits: accumulator.operationalUnits,
        childSiteCount: accumulator.childSiteCount,
        worstStatusPriority: accumulator.worstStatusPriority,
        isOperational: accumulator.anyNonOperational
          ? false
          : accumulator.anyStatus && accumulator.anyOperational
            ? true
            : null,
      });
    }

    return result;
  }
}
