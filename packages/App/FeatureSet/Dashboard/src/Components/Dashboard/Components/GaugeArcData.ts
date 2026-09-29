/*
 * Pure, React-free geometry for the gauge widget's arc. Kept out of the .tsx
 * so the maths — the part that decides whether the coloured value arc
 * actually lands on the grey background track — can be unit-tested in the
 * node test environment.
 */

/*
 * The gauge is a fixed half circle drawn left-to-right. Angles are measured
 * counter-clockwise from the positive x-axis, so the sweep runs from PI (the
 * left end of the track) down to 0 (the right end) as the value grows.
 */
export const GAUGE_START_ANGLE: number = Math.PI;
export const GAUGE_END_ANGLE: number = 0;
export const GAUGE_SWEEP_ANGLE: number = GAUGE_START_ANGLE - GAUGE_END_ANGLE;

export interface GaugeArcPoint {
  x: number;
  y: number;
}

/*
 * Where the value sits within min..max, clamped to [0, 1]. A non-positive
 * range has no meaningful position, so it reads as empty rather than
 * dividing by zero.
 */
export function computeGaugePercentage(
  value: number,
  minValue: number,
  maxValue: number,
): number {
  const range: number = maxValue - minValue;
  if (range <= 0) {
    return 0;
  }
  return Math.min(Math.max((value - minValue) / range, 0), 1);
}

// Map a [0, 1] position along the gauge onto its angle on the circle.
export function gaugeAngleForPercentage(percentage: number): number {
  return GAUGE_START_ANGLE - GAUGE_SWEEP_ANGLE * percentage;
}

export function gaugePointAtAngle(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): GaugeArcPoint {
  return {
    x: centerX + radius * Math.cos(angle),
    // SVG's y grows downward, so the upper half of the circle subtracts sin.
    y: centerY - radius * Math.sin(angle),
  };
}

/*
 * Build the SVG elliptical-arc command joining two points on the gauge circle.
 *
 * large-arc-flag is always 0. The gauge sweep is fixed at a half circle
 * (GAUGE_SWEEP_ANGLE === PI), so nothing drawn on it — the full background
 * track included — can ever exceed 180 degrees. Deriving the flag from the
 * value instead (`percentage > 0.5 ? 1 : 0`) asked the renderer for the long
 * way round between the same two endpoints, which is only satisfiable on a
 * *different* circle: past the midpoint the value arc left the track, bulged
 * away from it, and rejoined only at the indicator dot.
 *
 * sweep-flag is 1 because angles decrease as the value grows, which in
 * SVG's y-down space is the positive-angle (clockwise) direction.
 */
export function buildGaugeArcPath(
  from: GaugeArcPoint,
  to: GaugeArcPoint,
  radius: number,
): string {
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`;
}

export interface GaugeArcGeometryParams {
  // Width of the square the gauge is inscribed in, in px.
  gaugeSize: number;
  // Arc thickness in px; the track is inset by half of it on each side.
  strokeWidth: number;
  // Value position along the gauge, in [0, 1].
  percentage: number;
}

export interface GaugeArcGeometry {
  radius: number;
  centerX: number;
  centerY: number;
  currentAngle: number;
  arcStart: GaugeArcPoint;
  arcEnd: GaugeArcPoint;
  arcCurrent: GaugeArcPoint;
  backgroundPath: string;
  valuePath: string;
}

/*
 * Everything the gauge needs to draw: the track, the value arc that must lie
 * on top of it, and the point where the indicator dot goes.
 */
export function computeGaugeArcGeometry(
  params: GaugeArcGeometryParams,
): GaugeArcGeometry {
  const radius: number = (params.gaugeSize - params.strokeWidth) / 2;
  const centerX: number = params.gaugeSize / 2;
  const centerY: number = params.gaugeSize / 2;
  const currentAngle: number = gaugeAngleForPercentage(params.percentage);

  const arcStart: GaugeArcPoint = gaugePointAtAngle(
    centerX,
    centerY,
    radius,
    GAUGE_START_ANGLE,
  );
  const arcEnd: GaugeArcPoint = gaugePointAtAngle(
    centerX,
    centerY,
    radius,
    GAUGE_END_ANGLE,
  );
  const arcCurrent: GaugeArcPoint = gaugePointAtAngle(
    centerX,
    centerY,
    radius,
    currentAngle,
  );

  return {
    radius,
    centerX,
    centerY,
    currentAngle,
    arcStart,
    arcEnd,
    arcCurrent,
    backgroundPath: buildGaugeArcPath(arcStart, arcEnd, radius),
    valuePath: buildGaugeArcPath(arcStart, arcCurrent, radius),
  };
}
