/*
 * Pure, react-free map projections for the NetworkSite map views.
 *
 * Kept out of the map components so the math can be imported (and
 * unit-tested) in a plain Node/TypeScript environment — the App project does
 * not have `react` on its resolution path, so importing this logic from a
 * .tsx component would drag `react` into the App compile/test context and
 * fail to resolve.
 *
 * The constants here MUST stay in sync with Scripts/Geo/GenerateMapGeometry.js
 * — that script projects the checked-in UsStatesGeometry.json and
 * WorldCountriesGeometry.json outlines with the exact same math, which is
 * what guarantees that site pins projected at runtime land precisely on the
 * projected outlines.
 *
 * Both projections are deterministic: same input, same output, no randomness
 * and no clock access.
 */

// A projected [x, y] point in SVG viewBox coordinates.
export type ProjectedPoint = [number, number];

/*
 * AlbersUSA composite projection (d3.geoAlbersUsa layout): lower 48 as a
 * conic equal-area (parallels 29.5/45.5), with scaled Alaska and Hawaii
 * insets at the bottom left, fitted to a 975x610 viewBox via scale 1300 and
 * translate [487.5, 305] — the classic us-atlas layout.
 */
export const ALBERS_USA_VIEW_BOX_WIDTH: number = 975;
export const ALBERS_USA_VIEW_BOX_HEIGHT: number = 610;
export const ALBERS_USA_VIEW_BOX: string = `0 0 ${ALBERS_USA_VIEW_BOX_WIDTH} ${ALBERS_USA_VIEW_BOX_HEIGHT}`;

const ALBERS_USA_SCALE: number = 1300;
const ALBERS_USA_TRANSLATE_X: number = 487.5;
const ALBERS_USA_TRANSLATE_Y: number = 305;

// Robinson world projection fitted to a 960x500 viewBox, centred on 0,0.
export const ROBINSON_VIEW_BOX_WIDTH: number = 960;
export const ROBINSON_VIEW_BOX_HEIGHT: number = 500;
export const ROBINSON_VIEW_BOX: string = `0 0 ${ROBINSON_VIEW_BOX_WIDTH} ${ROBINSON_VIEW_BOX_HEIGHT}`;

const ROBINSON_X_FACTOR: number = 0.8487;
const ROBINSON_Y_FACTOR: number = 1.3523;
const ROBINSON_SCALE: number =
  ROBINSON_VIEW_BOX_WIDTH / (2 * ROBINSON_X_FACTOR * Math.PI);

/*
 * Robinson interpolation table: X (parallel length) / Y (parallel distance
 * from the equator) for every 5 degrees of latitude from 0 to 90, linearly
 * interpolated in between.
 */
const ROBINSON_X: Array<number> = [
  1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962,
  0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROBINSON_Y: Array<number> = [
  0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176,
  0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0,
];

const RADIANS: number = Math.PI / 180;

const normalizeLongitudeDegrees: (longitude: number) => number = (
  longitude: number,
): number => {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
};

const clamp: (value: number, min: number, max: number) => number = (
  value: number,
  min: number,
  max: number,
): number => {
  if (!Number.isFinite(value)) {
    return (min + max) / 2;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

/*
 * One zone of the AlbersUSA composite: a d3-style conic equal-area
 * projection (rotate -> raw conic -> scale/translate, recentred so `center`
 * projects to `translate`) plus the composite clip rectangle that decides
 * whether the zone owns a point.
 */
interface AlbersZone {
  n: number;
  c: number;
  r0: number;
  rotateLongitude: number;
  scale: number;
  translateX: number;
  translateY: number;
  rawCenterX: number;
  rawCenterY: number;
  clipX0: number;
  clipY0: number;
  clipX1: number;
  clipY1: number;
}

interface AlbersZoneOptions {
  parallel0: number;
  parallel1: number;
  rotateLongitude: number;
  centerLongitude: number;
  centerLatitude: number;
  scale: number;
  translateX: number;
  translateY: number;
  clipX0: number;
  clipY0: number;
  clipX1: number;
  clipY1: number;
}

const conicRaw: (
  n: number,
  c: number,
  r0: number,
  lambdaRadians: number,
  phiRadians: number,
) => ProjectedPoint = (
  n: number,
  c: number,
  r0: number,
  lambdaRadians: number,
  phiRadians: number,
): ProjectedPoint => {
  const r: number =
    Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phiRadians))) / n;
  const l: number = n * lambdaRadians;
  return [r * Math.sin(l), r0 - r * Math.cos(l)];
};

const makeAlbersZone: (options: AlbersZoneOptions) => AlbersZone = (
  options: AlbersZoneOptions,
): AlbersZone => {
  const sy0: number = Math.sin(options.parallel0 * RADIANS);
  const n: number = (sy0 + Math.sin(options.parallel1 * RADIANS)) / 2;
  const c: number = 1 + sy0 * (2 * n - sy0);
  const r0: number = Math.sqrt(c) / n;

  /*
   * The centre is projected through the raw conic without rotation (d3
   * projection.center semantics).
   */
  const rawCenter: ProjectedPoint = conicRaw(
    n,
    c,
    r0,
    options.centerLongitude * RADIANS,
    options.centerLatitude * RADIANS,
  );

  return {
    n: n,
    c: c,
    r0: r0,
    rotateLongitude: options.rotateLongitude,
    scale: options.scale,
    translateX: options.translateX,
    translateY: options.translateY,
    rawCenterX: rawCenter[0],
    rawCenterY: rawCenter[1],
    clipX0: options.clipX0,
    clipY0: options.clipY0,
    clipX1: options.clipX1,
    clipY1: options.clipY1,
  };
};

const projectThroughZone: (
  zone: AlbersZone,
  latitude: number,
  longitude: number,
) => ProjectedPoint = (
  zone: AlbersZone,
  latitude: number,
  longitude: number,
): ProjectedPoint => {
  const lambda: number = normalizeLongitudeDegrees(
    longitude + zone.rotateLongitude,
  );
  const point: ProjectedPoint = conicRaw(
    zone.n,
    zone.c,
    zone.r0,
    lambda * RADIANS,
    latitude * RADIANS,
  );
  return [
    zone.translateX + zone.scale * (point[0] - zone.rawCenterX),
    zone.translateY - zone.scale * (point[1] - zone.rawCenterY),
  ];
};

const buildAlbersUsaZones: () => Array<AlbersZone> = (): Array<AlbersZone> => {
  const k: number = ALBERS_USA_SCALE;
  const tx: number = ALBERS_USA_TRANSLATE_X;
  const ty: number = ALBERS_USA_TRANSLATE_Y;

  // Same composite as d3.geoAlbersUsa().scale(1300).translate([487.5, 305]).
  return [
    makeAlbersZone({
      parallel0: 29.5,
      parallel1: 45.5,
      rotateLongitude: 96,
      centerLongitude: -0.6,
      centerLatitude: 38.7,
      scale: k,
      translateX: tx,
      translateY: ty,
      clipX0: tx - 0.455 * k,
      clipY0: ty - 0.238 * k,
      clipX1: tx + 0.455 * k,
      clipY1: ty + 0.238 * k,
    }),
    makeAlbersZone({
      parallel0: 55,
      parallel1: 65,
      rotateLongitude: 154,
      centerLongitude: -2,
      centerLatitude: 58.5,
      scale: 0.35 * k,
      translateX: tx - 0.307 * k,
      translateY: ty + 0.201 * k,
      clipX0: tx - 0.425 * k,
      clipY0: ty + 0.12 * k,
      clipX1: tx - 0.214 * k,
      clipY1: ty + 0.234 * k,
    }),
    makeAlbersZone({
      parallel0: 8,
      parallel1: 18,
      rotateLongitude: 157,
      centerLongitude: -3,
      centerLatitude: 19.9,
      scale: k,
      translateX: tx - 0.205 * k,
      translateY: ty + 0.212 * k,
      clipX0: tx - 0.214 * k,
      clipY0: ty + 0.166 * k,
      clipX1: tx - 0.115 * k,
      clipY1: ty + 0.234 * k,
    }),
  ];
};

const ALBERS_USA_ZONES: Array<AlbersZone> = buildAlbersUsaZones();

/**
 * Project a lat/lon location through the AlbersUSA composite projection into
 * the 975x610 viewBox used by UsStatesGeometry.json. Returns null when the
 * location falls outside all three composite zones (lower 48 window, Alaska
 * inset, Hawaii inset) — e.g. London, or island territories such as Guam.
 */
export const projectAlbersUsa: (
  latitude: number,
  longitude: number,
) => ProjectedPoint | null = (
  latitude: number,
  longitude: number,
): ProjectedPoint | null => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  for (const zone of ALBERS_USA_ZONES) {
    const point: ProjectedPoint = projectThroughZone(zone, latitude, longitude);
    if (
      point[0] >= zone.clipX0 &&
      point[0] <= zone.clipX1 &&
      point[1] >= zone.clipY0 &&
      point[1] <= zone.clipY1
    ) {
      return point;
    }
  }

  return null;
};

/**
 * Project a lat/lon location through the Robinson projection into the
 * 960x500 viewBox used by WorldCountriesGeometry.json. Inputs are clamped to
 * [-90, 90] / [-180, 180] (non-finite values collapse to 0), so the result
 * always lands inside the viewBox.
 */
export const projectRobinson: (
  latitude: number,
  longitude: number,
) => ProjectedPoint = (latitude: number, longitude: number): ProjectedPoint => {
  const clampedLatitude: number = clamp(latitude, -90, 90);
  const clampedLongitude: number = clamp(longitude, -180, 180);

  const absoluteLatitude: number = Math.abs(clampedLatitude);
  const index: number = Math.min(17, Math.floor(absoluteLatitude / 5));
  const fraction: number = absoluteLatitude / 5 - index;
  const x: number =
    ROBINSON_X[index]! +
    fraction * (ROBINSON_X[index + 1]! - ROBINSON_X[index]!);
  const y: number =
    ROBINSON_Y[index]! +
    fraction * (ROBINSON_Y[index + 1]! - ROBINSON_Y[index]!);
  const sign: number = clampedLatitude < 0 ? -1 : 1;

  return [
    ROBINSON_VIEW_BOX_WIDTH / 2 +
      ROBINSON_X_FACTOR * ROBINSON_SCALE * x * (clampedLongitude * RADIANS),
    ROBINSON_VIEW_BOX_HEIGHT / 2 -
      ROBINSON_Y_FACTOR * ROBINSON_SCALE * y * sign,
  ];
};
