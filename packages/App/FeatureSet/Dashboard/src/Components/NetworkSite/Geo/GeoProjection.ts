/*
 * Pure, react-free map projection for the NetworkSite map view.
 *
 * Kept out of the map components so the math can be imported (and unit-tested)
 * in a plain Node/TypeScript environment — the App project does not have
 * `react` on its resolution path, so importing this logic from a .tsx
 * component would drag `react` into the App compile/test context and fail to
 * resolve.
 *
 * The map draws ONE projection of the whole world and frames itself to the
 * sites (see GeoViewport.ts), so Robinson is the only projection here — it is
 * a compromise projection built for exactly this job, world reference maps
 * that must look right everywhere rather than be exact anywhere.
 *
 * The constants here MUST stay in sync with Scripts/Geo/GenerateMapGeometry.js
 * — that script projects every checked-in geometry file
 * (WorldCountriesGeometry.json, WorldCountriesDetailGeometry.json and the
 * state and province lines in WorldSubdivisionsGeometry.json) with the exact
 * same math, which is what guarantees that site pins projected at runtime land
 * precisely on the projected outlines.
 *
 * Deterministic: same input, same output, no randomness and no clock access.
 */

// A projected [x, y] point in SVG viewBox coordinates.
export type ProjectedPoint = [number, number];

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

/**
 * Project a lat/lon location through the Robinson projection into the 960x500
 * viewBox used by the checked-in world geometry. Inputs are clamped to
 * [-90, 90] / [-180, 180] (non-finite values collapse to 0), so the result
 * always lands inside the viewBox — every finite coordinate on Earth has a
 * place on this map.
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
