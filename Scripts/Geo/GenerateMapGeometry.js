/*
 * Map geometry generator for the NetworkSite map view.
 *
 * Decodes world-atlas TopoJSON, projects it with the exact same Robinson math
 * as the runtime pin projector
 * (App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection.ts)
 * and emits three checked-in SVG path geometry files, all in the SAME
 * 960x500 viewBox so the map can swap or stack them without moving a single
 * pin:
 *
 *   WorldCountriesGeometry.json        overview outlines (countries-110m,
 *                                      1 decimal) — what the map draws at
 *                                      continent-and-wider zoom.
 *   WorldCountriesDetailGeometry.json  detail outlines (countries-50m,
 *                                      2 decimals) — swapped in once the
 *                                      viewport is zoomed past
 *                                      DETAIL_GEOMETRY_MIN_ZOOM.
 *   WorldSubdivisionsGeometry.json     INTERNAL admin-1 boundaries — state,
 *                                      province and territory lines, drawn
 *                                      OVER the detail outlines once the
 *                                      viewport passes
 *                                      SUBDIVISION_GEOMETRY_MIN_ZOOM.
 *
 * The projection constants here MUST stay byte-for-byte in sync with
 * GeoProjection.ts — the whole point of generating our own geometry (instead
 * of shipping a pre-projected atlas) is that site pins projected at runtime
 * land exactly on the projected outlines.
 *
 * Run (network needed only for the downloads):
 *   curl -L -o /tmp/countries-110m.json https://unpkg.com/world-atlas@2/countries-110m.json
 *   curl -L -o /tmp/countries-50m.json https://unpkg.com/world-atlas@2/countries-50m.json
 *   curl -L -o /tmp/admin-1-50m.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson
 *   node ./Scripts/Geo/GenerateMapGeometry.js /tmp/countries-110m.json /tmp/countries-50m.json /tmp/admin-1-50m.geojson
 *
 * See ./README.md for data sources, licensing and output details.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NetworkSite",
  "Geo",
);

/*
 * ------------------------------------------------------------------
 * Projection constants — keep in sync with GeoProjection.ts.
 * ------------------------------------------------------------------
 */

const ROBINSON_VIEW_BOX_WIDTH = 960;
const ROBINSON_VIEW_BOX_HEIGHT = 500;
const ROBINSON_X_FACTOR = 0.8487;
const ROBINSON_Y_FACTOR = 1.3523;
const ROBINSON_SCALE =
  ROBINSON_VIEW_BOX_WIDTH / (2 * ROBINSON_X_FACTOR * Math.PI);

// Robinson interpolation table: X (parallel length) / Y (parallel distance
// from equator) for every 5 degrees of latitude from 0 to 90.
const ROBINSON_X = [
  1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962,
  0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROBINSON_Y = [
  0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176,
  0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0,
];

const RADIANS = Math.PI / 180;

/*
 * ------------------------------------------------------------------
 * Output tiers.
 * ------------------------------------------------------------------
 *
 * The map is a zoomable single world view, so one fixed resolution cannot
 * serve it: the whole-world frame wants the smallest file that still reads
 * as a world map, and a frame zoomed onto one country wants outlines that
 * do not fall apart. Two tiers, same viewBox, swapped at runtime.
 *
 * `decimals` is coordinate quantization in viewBox units. At the overview
 * tier 0.1 units (~40 km) is invisible; the detail tier's 0.01 units
 * (~4 km at the equator) stays sub-pixel at the map's maximum zoom.
 *
 * `simplifyTolerance` is a Douglas-Peucker tolerance in viewBox units,
 * applied BEFORE rounding. Rounding alone leaves long runs of near-collinear
 * points that cost bytes and draw nothing; dropping them at well under the
 * quantization step is free in appearance and large in file size.
 */
const OVERVIEW_TIER = {
  fileName: "WorldCountriesGeometry.json",
  decimals: 1,
  simplifyTolerance: 0.05,
  // Rings below this projected area (px²) are dropped as sub-pixel specks.
  minRingAreaPx2: 0.5,
};

const DETAIL_TIER = {
  fileName: "WorldCountriesDetailGeometry.json",
  decimals: 2,
  /*
   * 0.04 viewBox units of geometric error. The map's MAX_ZOOM (see
   * Geo/GeoViewport.ts) is set so that this stays around one screen pixel
   * at the deepest zoom the UI allows — the two numbers are chosen
   * together, so moving either means revisiting the other.
   */
  simplifyTolerance: 0.04,
  /*
   * The detail tier is only ever seen zoomed in, where a 0.5 px² island is
   * a visible landmass — keep far more of them than the overview does.
   */
  minRingAreaPx2: 0.05,
};

/*
 * State and province lines. Same precision and tolerance as the detail tier,
 * because they are drawn at the same zooms and on top of it: a coarser
 * subdivision line would visibly miss the coastline it ends on, and a finer
 * one would be paying for precision the outline underneath does not have.
 */
const SUBDIVISION_TIER = {
  fileName: "WorldSubdivisionsGeometry.json",
  decimals: 2,
  simplifyTolerance: 0.04,
};

function projectRobinson(longitude, latitude) {
  const absoluteLatitude = Math.min(90, Math.abs(latitude));
  const index = Math.min(17, Math.floor(absoluteLatitude / 5));
  const fraction = absoluteLatitude / 5 - index;
  const x =
    ROBINSON_X[index] + fraction * (ROBINSON_X[index + 1] - ROBINSON_X[index]);
  const y =
    ROBINSON_Y[index] + fraction * (ROBINSON_Y[index + 1] - ROBINSON_Y[index]);
  const sign = latitude < 0 ? -1 : 1;
  return [
    ROBINSON_VIEW_BOX_WIDTH / 2 +
      ROBINSON_X_FACTOR * ROBINSON_SCALE * x * (longitude * RADIANS),
    ROBINSON_VIEW_BOX_HEIGHT / 2 -
      ROBINSON_Y_FACTOR * ROBINSON_SCALE * y * sign,
  ];
}

/*
 * ------------------------------------------------------------------
 * TopoJSON decoding (quantized, delta-encoded arcs -> lon/lat rings).
 * ------------------------------------------------------------------
 */

function decodeArcs(topology) {
  const scaleX = topology.transform.scale[0];
  const scaleY = topology.transform.scale[1];
  const translateX = topology.transform.translate[0];
  const translateY = topology.transform.translate[1];

  return topology.arcs.map(function decodeArc(arc) {
    let x = 0;
    let y = 0;
    return arc.map(function decodePoint(delta) {
      x += delta[0];
      y += delta[1];
      return [x * scaleX + translateX, y * scaleY + translateY];
    });
  });
}

/*
 * A TopoJSON ring is a list of arc indexes; a negative index ~i means arc i
 * reversed. Consecutive arcs share their join point, which must be dropped.
 */
function ringFromArcIndexes(decodedArcs, arcIndexes) {
  const ring = [];
  for (const rawIndex of arcIndexes) {
    const arc =
      rawIndex >= 0
        ? decodedArcs[rawIndex]
        : decodedArcs[~rawIndex].slice().reverse();
    const start = ring.length > 0 ? 1 : 0;
    for (let i = start; i < arc.length; i++) {
      ring.push(arc[i]);
    }
  }
  return ring;
}

// Polygon -> [rings]; MultiPolygon -> [rings, rings, ...] flattened.
function ringsOfGeometry(decodedArcs, geometry) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.arcs]
      : geometry.type === "MultiPolygon"
        ? geometry.arcs
        : [];
  const rings = [];
  for (const polygon of polygons) {
    for (const arcIndexes of polygon) {
      rings.push(ringFromArcIndexes(decodedArcs, arcIndexes));
    }
  }
  return rings;
}

/*
 * A polyline that steps across the ±180° antimeridian (Fiji, and Russia's
 * Chukotka tip and Wrangel Island) reads as a single huge westward step, so
 * drawing it verbatim streaks a straight line back across the whole map.
 * Cut it at the meridian instead: each piece stays on one side, and because
 * the cut points are projected like any other point, the seam lands exactly
 * on the map's own curved edge.
 *
 * Rings go through splitRingAtAntimeridian below, which adds the rejoin that
 * only closed input needs.
 */
function cutAtAntimeridian(points) {
  const pieces = [];
  let current = [];

  for (const point of points) {
    if (current.length === 0) {
      current.push(point);
      continue;
    }

    const previous = current[current.length - 1];
    const delta = point[0] - previous[0];

    if (Math.abs(delta) <= 180) {
      current.push(point);
      continue;
    }

    /*
     * Unwrap the far end so the segment runs continuously, then interpolate
     * the latitude at which it meets the meridian. The sign of the unwrapped
     * span is the direction of travel, which is the edge the segment leaves
     * through: east through +180, west through -180.
     *
     * A zero span means the two ends unwrap onto each other — which can only
     * happen when this vertex sits exactly ON the meridian (Fiji has one).
     * There is no direction to read, and guessing an edge cuts the ring on
     * the wrong side of the map, leaving a piece that streaks the full width
     * of the world. The vertex itself is the crossing, so leave through the
     * edge it is already on.
     */
    const unwrappedLongitude = point[0] + (delta > 0 ? -360 : 360);
    const span = unwrappedLongitude - previous[0];
    const edge = span > 0 ? 180 : span < 0 ? -180 : previous[0];
    const ratio = span === 0 ? 0 : (edge - previous[0]) / span;
    const latitude = previous[1] + (point[1] - previous[1]) * ratio;

    current.push([edge, latitude]);
    pieces.push(current);
    current = [[-edge, latitude], point];
  }

  if (current.length > 0) {
    pieces.push(current);
  }

  return pieces;
}

function splitRingAtAntimeridian(ring) {
  const pieces = cutAtAntimeridian(ring);

  if (pieces.length <= 1) {
    return [ring];
  }

  /*
   * Crossings of a closed ring always come in pairs, so its last piece runs
   * back into its first one on the same side of the meridian — rejoin them
   * so that side renders as one polygon rather than two open wedges.
   */
  const first = pieces[0];
  const last = pieces.pop();
  const lastPoint = last[last.length - 1];
  const isClosed = lastPoint[0] === first[0][0] && lastPoint[1] === first[0][1];
  pieces[0] = last.concat(isClosed ? first.slice(1) : first);

  return pieces;
}

/*
 * ------------------------------------------------------------------
 * Simplification and path assembly.
 * ------------------------------------------------------------------
 */

// Perpendicular distance from `point` to the segment a->b, in viewBox units.
function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }
  const t =
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(
    point[0] - (a[0] + clamped * dx),
    point[1] - (a[1] + clamped * dy),
  );
}

/*
 * Douglas-Peucker, iterative so a 30 000-point Russian coastline cannot blow
 * the stack. Endpoints are always kept, so a ring's two anchors survive and
 * neighbouring countries keep sharing them — and a subdivision line still
 * starts and ends exactly on the border it branches off.
 */
function simplifyPolyline(ring, tolerance) {
  if (tolerance <= 0 || ring.length <= 2) {
    return ring;
  }

  const keep = new Array(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;

  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = start + 1; i < end; i++) {
      const distance = distanceToSegment(ring[i], ring[start], ring[end]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([start, farthest]);
      stack.push([farthest, end]);
    }
  }

  return ring.filter(function isKept(_point, index) {
    return keep[index];
  });
}

function roundToDecimals(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/*
 * Round to the tier's precision and drop consecutive duplicate points —
 * rounding a dense coastline collapses neighbouring vertices onto each other.
 */
function roundAndDedupe(projectedPoints, decimals) {
  const out = [];
  for (const point of projectedPoints) {
    const x = roundToDecimals(point[0], decimals);
    const y = roundToDecimals(point[1], decimals);
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) {
      continue;
    }
    out.push([x, y]);
  }
  return out;
}

// As above, plus the closing point a ring does not need — SVG "Z" closes it.
function roundRing(projectedRing, decimals) {
  const out = roundAndDedupe(projectedRing, decimals);
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    out.pop();
  }
  return out;
}

function ringAreaPx2(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum / 2);
}

/*
 * Shortest legal spelling of a coordinate: SVG allows a leading "." on a
 * fractional number, and these files are dominated by small relative steps
 * like "0.03" — dropping that zero is ~8% of the detail tier.
 */
function formatNumber(value) {
  const text = String(value);
  if (text.startsWith("0.")) {
    return text.slice(1);
  }
  if (text.startsWith("-0.")) {
    return "-" + text.slice(2);
  }
  return text;
}

/*
 * One ring or line as an SVG subpath: an absolute moveto followed by ONE
 * relative polyline. Relative steps are what make the detail tier affordable
 * — a coastline step is "l.03,-.05" instead of "L245.67,123.45".
 *
 * Each step is emitted from the position the renderer is actually at (the
 * running sum of already-rounded deltas), not from the ideal ring, so
 * rounding error can never accumulate along a 30 000-point coastline. Every
 * subpath re-anchors with its own absolute M, so error cannot cross rings
 * either.
 *
 * `isClosed` decides the trailing "Z". Country outlines are closed rings;
 * a subdivision boundary is an OPEN line whose two ends are junctions with
 * other borders, and closing it would draw a chord straight back across the
 * state.
 */
function pointsToPathSegment(points, decimals, isClosed) {
  let d = "M" + formatNumber(points[0][0]) + "," + formatNumber(points[0][1]);

  let currentX = points[0][0];
  let currentY = points[0][1];
  const steps = [];

  for (let i = 1; i < points.length; i++) {
    const dx = roundToDecimals(points[i][0] - currentX, decimals);
    const dy = roundToDecimals(points[i][1] - currentY, decimals);
    if (dx === 0 && dy === 0) {
      continue;
    }
    steps.push(formatNumber(dx) + "," + formatNumber(dy));
    currentX = roundToDecimals(currentX + dx, decimals);
    currentY = roundToDecimals(currentY + dy, decimals);
  }

  if (steps.length === 0) {
    return null;
  }

  return d + "l" + steps.join(" ") + (isClosed ? "Z" : "");
}

/*
 * Turns projected rings into one SVG path string, dropping degenerate rings
 * and specks below the tier's threshold (but always keeping the feature's
 * largest ring). Returns null when nothing drawable remains.
 */
function ringsToPath(projectedRings, tier) {
  const rounded = projectedRings
    .map(function simplifyThenRound(ring) {
      return roundRing(
        simplifyPolyline(ring, tier.simplifyTolerance),
        tier.decimals,
      );
    })
    .filter(function hasArea(ring) {
      return ring.length >= 3;
    })
    .map(function withArea(ring) {
      return { ring: ring, area: ringAreaPx2(ring) };
    });

  if (rounded.length === 0) {
    return null;
  }

  const largestArea = Math.max(
    ...rounded.map(function area(entry) {
      return entry.area;
    }),
  );

  const kept = rounded.filter(function bigEnough(entry) {
    return entry.area >= tier.minRingAreaPx2 || entry.area === largestArea;
  });

  const path = kept
    .map(function toSegment(entry) {
      return pointsToPathSegment(entry.ring, tier.decimals, true);
    })
    .filter(Boolean)
    .join("");

  return path.length > 0 ? path : null;
}

/*
 * Turns projected subdivision lines into one SVG path string. Unlike
 * ringsToPath there is no speck threshold: a short line is not a sub-pixel
 * island nobody would miss, it is a fragment of a border, and dropping it
 * leaves a gap in the middle of a boundary somebody has zoomed in to read.
 *
 * A line whose ends coincide is a subdivision entirely surrounded by its own
 * country's other subdivisions (Nebraska, Madhya Pradesh) — closed with "Z"
 * so the loop joins up cleanly instead of showing a hairline seam.
 */
function linesToPath(projectedLines, tier) {
  const segments = [];

  for (const line of projectedLines) {
    const points = roundAndDedupe(
      simplifyPolyline(line, tier.simplifyTolerance),
      tier.decimals,
    );
    if (points.length < 2) {
      continue;
    }

    const first = points[0];
    const last = points[points.length - 1];
    const isClosed = first[0] === last[0] && first[1] === last[1];
    if (isClosed) {
      points.pop();
    }
    if (points.length < 2) {
      continue;
    }

    const segment = pointsToPathSegment(points, tier.decimals, isClosed);
    if (segment) {
      segments.push(segment);
    }
  }

  return segments.length > 0 ? segments.join("") : null;
}

/*
 * ------------------------------------------------------------------
 * Feature builder.
 * ------------------------------------------------------------------
 */

function buildWorldCountries(topology, tier) {
  const decodedArcs = decodeArcs(topology);
  const features = [];

  for (const geometry of topology.objects.countries.geometries) {
    const rings = ringsOfGeometry(decodedArcs, geometry);
    const projectedRings = [];
    for (const ring of rings) {
      for (const piece of splitRingAtAntimeridian(ring)) {
        projectedRings.push(
          piece.map(function projectPoint(point) {
            return projectRobinson(point[0], point[1]);
          }),
        );
      }
    }
    if (projectedRings.length === 0) {
      continue;
    }
    const pathD = ringsToPath(projectedRings, tier);
    if (!pathD) {
      continue;
    }
    /*
     * A few disputed territories (N. Cyprus, Somaliland, Kosovo) carry no
     * ISO 3166-1 numeric id in Natural Earth — fall back to their name so
     * they still render and keep a stable, unique id.
     */
    const id =
      geometry.id === undefined || geometry.id === null
        ? geometry.properties.name
        : String(geometry.id);
    features.push({
      id: id,
      name: geometry.properties.name,
      path: pathD,
    });
  }

  features.sort(function byId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    viewBox: "0 0 " + ROBINSON_VIEW_BOX_WIDTH + " " + ROBINSON_VIEW_BOX_HEIGHT,
    features: features,
  };
}

/*
 * ------------------------------------------------------------------
 * Subdivision (state / province) boundaries.
 * ------------------------------------------------------------------
 *
 * WHY THIS TIER EXISTS
 *
 * Zoomed out, a country outline is the whole map. Zoomed into one country it
 * is a single closed curve around a blank field, and a reader looking at a
 * pin somewhere in the middle of the United States or India has nothing to
 * place it against. State lines are the next reference frame down, and the
 * only one that works for every country at once — no city list to curate, no
 * language to translate, no label to collide with a marker.
 *
 * WHY THE SOURCE PICKS THE COUNTRIES
 *
 * There is no "large countries" list here to argue about. Natural Earth's
 * 50m admin-1 file covers exactly the nine countries whose subdivisions are
 * legible at 1:50m — Russia, the US, India, Indonesia, China, Brazil,
 * Canada, Australia and South Africa — so the data answers the question the
 * old "United States / World" toggle used to answer badly.
 *
 * WHY INTERNAL BOUNDARIES ONLY
 *
 * Every subdivision polygon also traces its country's coastline and
 * international borders, which the country tier already draws underneath. Two
 * strokes on one line is a heavier, slightly-offset double edge (the two
 * sources simplify differently), and storing the shared inner borders twice —
 * once from each neighbour — is the other half of the waste. So this keeps
 * only the boundaries INTERIOR to a country: the segments that appear in two
 * of its subdivisions.
 */

// Consistent identity for a lon/lat vertex, so shared segments compare equal.
function pointKey(point) {
  return point[0] + "," + point[1];
}

/*
 * Identity for an undirected segment. Neighbouring subdivisions trace the
 * border they share in OPPOSITE directions, so the endpoints have to be
 * ordered before they are compared.
 */
function segmentKey(a, b) {
  const first = pointKey(a);
  const second = pointKey(b);
  return first < second ? first + "|" + second : second + "|" + first;
}

// GeoJSON Polygon -> [rings]; MultiPolygon -> [rings, rings, ...] flattened.
function ringsOfGeoJsonGeometry(geometry) {
  if (!geometry) {
    return [];
  }
  if (geometry.type === "Polygon") {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat();
  }
  return [];
}

/*
 * A GeoJSON ring repeats its first point at the end. Everything below treats
 * a ring as a cycle of n points and n segments, so that duplicate has to go;
 * a ring that arrives unclosed (not legal GeoJSON, but cheap to survive)
 * gains one closing segment that no neighbour shares, and is therefore
 * discarded as an outer edge rather than drawn.
 */
function cycleOfRing(ring) {
  if (
    ring.length > 1 &&
    pointKey(ring[0]) === pointKey(ring[ring.length - 1])
  ) {
    return ring.slice(0, -1);
  }
  return ring;
}

/*
 * Counts how many subdivisions trace each segment, and whether they belong to
 * the same country.
 *
 * A segment traced twice by one country's subdivisions is an internal border.
 * Traced twice across two countries it is an INTERNATIONAL border — the US
 * and Canada both carry the 49th parallel — which the country tier already
 * draws, so it must not be drawn again here.
 */
function countSharedSegments(geojson) {
  const segments = new Map();

  for (const feature of geojson.features) {
    const country = feature.properties.admin;
    for (const ring of ringsOfGeoJsonGeometry(feature.geometry)) {
      const cycle = cycleOfRing(ring);
      for (let i = 0; i < cycle.length; i++) {
        const key = segmentKey(cycle[i], cycle[(i + 1) % cycle.length]);
        const existing = segments.get(key);
        if (!existing) {
          segments.set(key, {
            count: 1,
            country: country,
            isInternational: false,
          });
          continue;
        }
        existing.count += 1;
        if (existing.country !== country) {
          existing.isInternational = true;
        }
      }
    }
  }

  return segments;
}

/*
 * The runs of consecutive internal-boundary segments in one ring, as
 * polylines.
 *
 * Runs rather than loose segments for two reasons: Douglas-Peucker can only
 * straighten a line it can see the whole of, and one "M" per border beats one
 * per segment. `emitted` is shared across the whole file so the second
 * subdivision to trace a border skips it — otherwise every internal line
 * would be stored twice, mirrored.
 */
function internalBoundaryRuns(cycle, segments, emitted) {
  const count = cycle.length;

  const isInternal = function isInternal(index) {
    const entry = segments.get(
      segmentKey(cycle[index], cycle[(index + 1) % count]),
    );
    return Boolean(entry && entry.count >= 2 && !entry.isInternational);
  };

  /*
   * Start walking at an OUTER segment where there is one, so a run that
   * straddles the ring's arbitrary first vertex is not cut in half there. A
   * cycle with no outer segment at all is a subdivision fully enclosed by its
   * own country's others, and walks round as a single closed run.
   */
  let startAt = 0;
  for (let i = 0; i < count; i++) {
    if (!isInternal(i)) {
      startAt = i;
      break;
    }
  }

  const runs = [];
  let current = null;

  for (let step = 0; step < count; step++) {
    const index = (startAt + step) % count;
    const from = cycle[index];
    const to = cycle[(index + 1) % count];
    const key = segmentKey(from, to);

    if (isInternal(index) && !emitted.has(key)) {
      emitted.add(key);
      if (current) {
        current.push(to);
      } else {
        current = [from, to];
      }
      continue;
    }

    if (current) {
      runs.push(current);
      current = null;
    }
  }

  if (current) {
    runs.push(current);
  }

  return runs;
}

function buildWorldSubdivisions(geojson, tier) {
  const segments = countSharedSegments(geojson);
  const emitted = new Set();
  const byCountry = new Map();

  for (const feature of geojson.features) {
    /*
     * One feature per COUNTRY, not per subdivision: a border belongs to the
     * two subdivisions on either side of it, so attributing it to one of them
     * would be a coin toss. The country is the honest owner, and it is also
     * the granularity the map draws at.
     */
    const id = feature.properties.adm0_a3;
    const name = feature.properties.admin;
    if (!id || !name) {
      continue;
    }

    for (const ring of ringsOfGeoJsonGeometry(feature.geometry)) {
      const cycle = cycleOfRing(ring);
      if (cycle.length < 3) {
        continue;
      }
      const runs = internalBoundaryRuns(cycle, segments, emitted);
      if (runs.length === 0) {
        continue;
      }
      const entry = byCountry.get(id) || { id: id, name: name, lines: [] };
      for (const run of runs) {
        entry.lines.push(run);
      }
      byCountry.set(id, entry);
    }
  }

  const features = [];
  for (const entry of byCountry.values()) {
    const projectedLines = [];
    for (const line of entry.lines) {
      for (const piece of cutAtAntimeridian(line)) {
        if (piece.length < 2) {
          continue;
        }
        projectedLines.push(
          piece.map(function projectPoint(point) {
            return projectRobinson(point[0], point[1]);
          }),
        );
      }
    }
    const pathD = linesToPath(projectedLines, tier);
    if (!pathD) {
      continue;
    }
    features.push({ id: entry.id, name: entry.name, path: pathD });
  }

  features.sort(function byId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    viewBox: "0 0 " + ROBINSON_VIEW_BOX_WIDTH + " " + ROBINSON_VIEW_BOX_HEIGHT,
    features: features,
  };
}

/*
 * ------------------------------------------------------------------
 * Main.
 * ------------------------------------------------------------------
 */

/*
 * Compact JSON: these files are machine-generated and never hand-edited, and
 * the detail tier's pretty-printed form is megabytes of indentation.
 */
function writeGeometry(geometry, tier) {
  const outputPath = path.join(OUTPUT_DIR, tier.fileName);
  fs.writeFileSync(outputPath, JSON.stringify(geometry) + "\n");

  const bytes = fs.statSync(outputPath).size;
  console.log(
    outputPath +
      ": " +
      geometry.features.length +
      " features, " +
      (bytes / 1024).toFixed(1) +
      " KB",
  );
}

function main() {
  const overviewPath = process.argv[2];
  const detailPath = process.argv[3];
  const subdivisionPath = process.argv[4];

  if (!overviewPath || !detailPath || !subdivisionPath) {
    console.error(
      "Usage: node Scripts/Geo/GenerateMapGeometry.js <countries-110m.json> <countries-50m.json> <ne_50m_admin_1_states_provinces.geojson>",
    );
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [sourcePath, tier] of [
    [overviewPath, OVERVIEW_TIER],
    [detailPath, DETAIL_TIER],
  ]) {
    const topology = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    writeGeometry(buildWorldCountries(topology, tier), tier);
  }

  const admin1 = JSON.parse(fs.readFileSync(subdivisionPath, "utf8"));
  writeGeometry(
    buildWorldSubdivisions(admin1, SUBDIVISION_TIER),
    SUBDIVISION_TIER,
  );
}

main();
