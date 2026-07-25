/*
 * Map geometry generator for the NetworkSite map views.
 *
 * Decodes TopoJSON atlases (us-atlas / world-atlas), projects them with the
 * exact same AlbersUSA and Robinson math as the runtime pin projector
 * (App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection.ts)
 * and emits checked-in SVG path geometry:
 *
 *   UsStatesGeometry.json      975x610 viewBox, {id: FIPS, name, path}
 *   WorldCountriesGeometry.json 960x500 viewBox, {id: ISO numeric, name, path}
 *
 * The projection constants here MUST stay byte-for-byte in sync with
 * GeoProjection.ts — the whole point of generating our own geometry (instead
 * of shipping a pre-projected atlas) is that site pins projected at runtime
 * land exactly on the projected outlines.
 *
 * Run (network needed only for the two downloads):
 *   curl -L -o /tmp/states-10m.json https://unpkg.com/us-atlas@3/states-10m.json
 *   curl -L -o /tmp/countries-110m.json https://unpkg.com/world-atlas@2/countries-110m.json
 *   node ./Scripts/Geo/GenerateMapGeometry.js /tmp/states-10m.json /tmp/countries-110m.json
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

const ALBERS_USA_VIEW_BOX_WIDTH = 975;
const ALBERS_USA_VIEW_BOX_HEIGHT = 610;
const ALBERS_USA_SCALE = 1300;
const ALBERS_USA_TRANSLATE_X = 487.5;
const ALBERS_USA_TRANSLATE_Y = 305;

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

/*
 * Rings whose projected (rounded) area is below this many square pixels are
 * dropped — they are sub-pixel specks that cost bytes but render as nothing.
 * The largest ring of every feature is always kept, so no state or country
 * disappears entirely.
 */
const MIN_RING_AREA_PX2 = 0.5;

const RADIANS = Math.PI / 180;

function normalizeLongitudeDegrees(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/*
 * d3-style conic equal-area zone (rotate -> raw conic -> scale/translate,
 * recentred so `center` projects to `translate`), plus the composite clip
 * rectangle that decides which zone owns a point.
 */
function makeConicZone(options) {
  const sy0 = Math.sin(options.parallel0 * RADIANS);
  const n = (sy0 + Math.sin(options.parallel1 * RADIANS)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;

  function raw(lambdaRadians, phiRadians) {
    const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phiRadians))) / n;
    const l = n * lambdaRadians;
    return [r * Math.sin(l), r0 - r * Math.cos(l)];
  }

  // The centre is projected through the raw conic without rotation (d3
  // projection.center semantics).
  const rawCenter = raw(
    options.centerLongitude * RADIANS,
    options.centerLatitude * RADIANS,
  );

  return {
    clip: options.clip,
    project: function project(longitude, latitude) {
      const lambda = normalizeLongitudeDegrees(
        longitude + options.rotateLongitude,
      );
      const point = raw(lambda * RADIANS, latitude * RADIANS);
      return [
        options.translateX + options.scale * (point[0] - rawCenter[0]),
        options.translateY - options.scale * (point[1] - rawCenter[1]),
      ];
    },
  };
}

function makeAlbersUsaZones() {
  const k = ALBERS_USA_SCALE;
  const tx = ALBERS_USA_TRANSLATE_X;
  const ty = ALBERS_USA_TRANSLATE_Y;

  // Same composite as d3.geoAlbersUsa().scale(1300).translate([487.5, 305]).
  return [
    makeConicZone({
      parallel0: 29.5,
      parallel1: 45.5,
      rotateLongitude: 96,
      centerLongitude: -0.6,
      centerLatitude: 38.7,
      scale: k,
      translateX: tx,
      translateY: ty,
      clip: [tx - 0.455 * k, ty - 0.238 * k, tx + 0.455 * k, ty + 0.238 * k],
    }),
    makeConicZone({
      parallel0: 55,
      parallel1: 65,
      rotateLongitude: 154,
      centerLongitude: -2,
      centerLatitude: 58.5,
      scale: 0.35 * k,
      translateX: tx - 0.307 * k,
      translateY: ty + 0.201 * k,
      clip: [tx - 0.425 * k, ty + 0.12 * k, tx - 0.214 * k, ty + 0.234 * k],
    }),
    makeConicZone({
      parallel0: 8,
      parallel1: 18,
      rotateLongitude: 157,
      centerLongitude: -3,
      centerLatitude: 19.9,
      scale: k,
      translateX: tx - 0.205 * k,
      translateY: ty + 0.212 * k,
      clip: [tx - 0.214 * k, ty + 0.166 * k, tx - 0.115 * k, ty + 0.234 * k],
    }),
  ];
}

const ALBERS_USA_ZONES = makeAlbersUsaZones();

// Returns the index of the composite zone that owns the point, or -1.
function albersUsaZoneIndex(longitude, latitude) {
  for (let i = 0; i < ALBERS_USA_ZONES.length; i++) {
    const zone = ALBERS_USA_ZONES[i];
    const point = zone.project(longitude, latitude);
    if (
      point[0] >= zone.clip[0] &&
      point[0] <= zone.clip[2] &&
      point[1] >= zone.clip[1] &&
      point[1] <= zone.clip[3]
    ) {
      return i;
    }
  }
  return -1;
}

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
 * A ring that steps across the ±180° antimeridian (Fiji, and Russia's
 * Chukotka tip and Wrangel Island) reads as a single huge westward step, so
 * drawing it verbatim streaks a straight line back across the whole map.
 * Cut such rings at the meridian instead: each piece stays on one side, and
 * because the cut points are projected like any other point, the seam lands
 * exactly on the map's own curved edge.
 */
function splitRingAtAntimeridian(ring) {
  const pieces = [];
  let current = [];

  for (const point of ring) {
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

    // Unwrap the far end so the segment runs continuously, then interpolate
    // the latitude at which it meets the meridian.
    const unwrappedLongitude = point[0] + (delta > 0 ? -360 : 360);
    const span = unwrappedLongitude - previous[0];
    const edge = span < 0 ? -180 : 180;
    const ratio = span === 0 ? 0 : (edge - previous[0]) / span;
    const latitude = previous[1] + (point[1] - previous[1]) * ratio;

    current.push([edge, latitude]);
    pieces.push(current);
    current = [[-edge, latitude], point];
  }

  if (current.length > 0) {
    pieces.push(current);
  }

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
 * Path assembly.
 * ------------------------------------------------------------------
 */

function roundTo1Decimal(value) {
  return Math.round(value * 10) / 10;
}

// Round to 1 decimal and drop consecutive duplicate points (and the closing
// point — SVG "Z" closes the ring). This is the resolution-appropriate
// simplification that keeps the files small.
function roundAndDedupe(projectedRing) {
  const out = [];
  for (const point of projectedRing) {
    const x = roundTo1Decimal(point[0]);
    const y = roundTo1Decimal(point[1]);
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) {
      continue;
    }
    out.push([x, y]);
  }
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

function ringToPathSegment(ring) {
  let d = "M" + ring[0][0] + "," + ring[0][1];
  for (let i = 1; i < ring.length; i++) {
    d += "L" + ring[i][0] + "," + ring[i][1];
  }
  return d + "Z";
}

/*
 * Turns projected rings into one SVG path string, dropping degenerate rings
 * and sub-pixel specks (but always keeping the feature's largest ring).
 * Returns null when nothing drawable remains.
 */
function ringsToPath(projectedRings) {
  const rounded = projectedRings
    .map(roundAndDedupe)
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
    return entry.area >= MIN_RING_AREA_PX2 || entry.area === largestArea;
  });

  return kept
    .map(function toSegment(entry) {
      return ringToPathSegment(entry.ring);
    })
    .join("");
}

/*
 * ------------------------------------------------------------------
 * Feature builders.
 * ------------------------------------------------------------------
 */

function buildUsStates(topology) {
  const decodedArcs = decodeArcs(topology);
  const features = [];

  for (const geometry of topology.objects.states.geometries) {
    const rings = ringsOfGeometry(decodedArcs, geometry);
    const projectedRings = [];

    for (const ring of rings) {
      /*
       * Assign the whole ring to the composite zone that owns the majority
       * of its vertexes, then project every vertex through that single zone
       * without clipping — clipping mid-ring would tear the outline. Rings
       * fully outside the composite (island territories: AS, GU, MP, PR,
       * VI) are dropped.
       */
      const votes = [0, 0, 0];
      let hits = 0;
      for (const point of ring) {
        const zoneIndex = albersUsaZoneIndex(point[0], point[1]);
        if (zoneIndex >= 0) {
          votes[zoneIndex]++;
          hits++;
        }
      }
      if (hits === 0) {
        continue;
      }
      let winner = 0;
      for (let i = 1; i < votes.length; i++) {
        if (votes[i] > votes[winner]) {
          winner = i;
        }
      }
      const zone = ALBERS_USA_ZONES[winner];
      projectedRings.push(
        ring.map(function projectPoint(point) {
          return zone.project(point[0], point[1]);
        }),
      );
    }

    if (projectedRings.length === 0) {
      continue;
    }
    const pathD = ringsToPath(projectedRings);
    if (!pathD) {
      continue;
    }
    features.push({
      id: String(geometry.id),
      name: geometry.properties.name,
      path: pathD,
    });
  }

  features.sort(function byId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    viewBox:
      "0 0 " + ALBERS_USA_VIEW_BOX_WIDTH + " " + ALBERS_USA_VIEW_BOX_HEIGHT,
    features: features,
  };
}

function buildWorldCountries(topology) {
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
    const pathD = ringsToPath(projectedRings);
    if (!pathD) {
      continue;
    }
    /*
     * Three disputed territories (N. Cyprus, Somaliland, Kosovo) carry no
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
 * Main.
 * ------------------------------------------------------------------
 */

function main() {
  const statesPath = process.argv[2];
  const worldPath = process.argv[3];

  if (!statesPath || !worldPath) {
    console.error(
      "Usage: node Scripts/Geo/GenerateMapGeometry.js <states-10m.json> <countries-110m.json>",
    );
    process.exit(1);
  }

  const statesTopology = JSON.parse(fs.readFileSync(statesPath, "utf8"));
  const worldTopology = JSON.parse(fs.readFileSync(worldPath, "utf8"));

  const usStates = buildUsStates(statesTopology);
  const worldCountries = buildWorldCountries(worldTopology);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const usOutputPath = path.join(OUTPUT_DIR, "UsStatesGeometry.json");
  const worldOutputPath = path.join(OUTPUT_DIR, "WorldCountriesGeometry.json");

  fs.writeFileSync(usOutputPath, JSON.stringify(usStates, null, 2) + "\n");
  fs.writeFileSync(
    worldOutputPath,
    JSON.stringify(worldCountries, null, 2) + "\n",
  );

  for (const [outputPath, data] of [
    [usOutputPath, usStates],
    [worldOutputPath, worldCountries],
  ]) {
    const bytes = fs.statSync(outputPath).size;
    console.log(
      outputPath +
        ": " +
        data.features.length +
        " features, " +
        (bytes / 1024).toFixed(1) +
        " KB",
    );
  }
}

main();
