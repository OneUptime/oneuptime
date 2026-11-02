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

/*
 * How large the gauge is drawn in its widget: the size of the square its
 * arc is inscribed in, from the tile the canvas hands the widget.
 *
 * Across, it is the tile's width less 24px, as it always was. Down, it is
 * the largest gauge whose arc, value and status under it, title above it
 * and min and max labels fit the tile's height: the card takes
 * GAUGE_CARD_CHROME_HEIGHT_IN_PX of it and the gauge's own padding
 * GAUGE_VIEW_PADDING_HEIGHT_IN_PX. The height used to be read as 1.8px of
 * gauge for every px left after 50px, which overflowed a wide, short
 * widget - a gauge as wide as a phone's screen, where a dashboard shows its
 * widgets one under another - and cut its status off.
 */
export const GAUGE_MIN_SIZE_IN_PX: number = 96;

// What the widget's card takes of its height: its border and its padding.
export const GAUGE_CARD_CHROME_HEIGHT_IN_PX: number = 26;

// The gauge view's own padding, above and below (py-2).
export const GAUGE_VIEW_PADDING_HEIGHT_IN_PX: number = 16;

// The title's line (11px text), and the min and max labels' (10px).
export const GAUGE_TITLE_LINE_HEIGHT_IN_PX: number = 16.5;
export const GAUGE_FOOTER_LINE_HEIGHT_IN_PX: number = 15;

// The status under the value: its gap above (mt-2) and its 10px line.
const GAUGE_STATUS_HEIGHT_IN_PX: number = 8 + 15;

// The value's font, a share of the gauge's size and never under 22px.
export function computeGaugeValueFontPx(gaugeSize: number): number {
  return Math.max(gaugeSize * 0.22, 22);
}

// The arc's thickness, a share of the gauge's size and never under 7px.
export function computeGaugeStrokeWidth(gaugeSize: number): number {
  return Math.max(gaugeSize * 0.06, 7);
}

/*
 * The height a gauge of this size needs inside the gauge view's padding.
 * The view stacks the title, the arc and the min and max labels, spread
 * apart by what height is left over; the value and the status are drawn
 * from the arc's centre down, past the arc's own box.
 */
export function computeGaugeContentHeightInPx(data: {
  gaugeSize: number;
  hasTitle: boolean;
}): number {
  const valueFontPx: number = computeGaugeValueFontPx(data.gaugeSize);
  const arcBoxHeight: number =
    data.gaugeSize / 2 + computeGaugeStrokeWidth(data.gaugeSize) + 12;
  // From the top of the arc's box to the bottom of the status.
  const valueBottom: number =
    data.gaugeSize / 2 + 0.45 * valueFontPx + GAUGE_STATUS_HEIGHT_IN_PX;

  if (!data.hasTitle) {
    return Math.max(arcBoxHeight + GAUGE_FOOTER_LINE_HEIGHT_IN_PX, valueBottom);
  }

  /*
   * With a title, the arc sits halfway between the title and the labels,
   * so a status that runs past the arc's box needs twice what it runs past
   * by.
   */
  const stacked: number =
    GAUGE_TITLE_LINE_HEIGHT_IN_PX +
    arcBoxHeight +
    GAUGE_FOOTER_LINE_HEIGHT_IN_PX;

  return Math.max(
    stacked,
    GAUGE_TITLE_LINE_HEIGHT_IN_PX -
      GAUGE_FOOTER_LINE_HEIGHT_IN_PX -
      arcBoxHeight +
      2 * valueBottom,
  );
}

export function computeGaugeSize(data: {
  // The widget's tile, in px.
  widthInPx: number;
  heightInPx: number;
  hasTitle: boolean;
}): number {
  const widest: number = Math.floor(data.widthInPx - 24);

  const contentHeight: number =
    data.heightInPx -
    GAUGE_CARD_CHROME_HEIGHT_IN_PX -
    GAUGE_VIEW_PADDING_HEIGHT_IN_PX;

  const fits: (gaugeSize: number) => boolean = (gaugeSize: number): boolean => {
    return (
      computeGaugeContentHeightInPx({ gaugeSize, hasTitle: data.hasTitle }) <=
      contentHeight
    );
  };

  if (!Number.isFinite(widest) || widest <= GAUGE_MIN_SIZE_IN_PX) {
    return GAUGE_MIN_SIZE_IN_PX;
  }

  if (fits(widest)) {
    return widest;
  }

  // The largest whole size that fits, found by halving: the need only grows with the size.
  let low: number = GAUGE_MIN_SIZE_IN_PX;
  let high: number = widest;

  while (high - low > 1) {
    const middle: number = Math.floor((low + high) / 2);

    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return low;
}
