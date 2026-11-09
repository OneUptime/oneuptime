import ChartReferenceLineProps from "../Types/ReferenceLineProps";

/*
 * The faint band a reference line shades on the side a rule matches
 * (ChartReferenceLineProps.shade): a monitor's "above 90" shades everything
 * above 90, so the stretches a metric spent past its threshold stand out,
 * and how close it came reads at a glance.
 *
 * As recharts' ReferenceArea bounds: the line's value on one side and the
 * edge of the plot on the other. Recharts reaches the plot's edge for a
 * bound it is not given - the top for a missing `y1`, the bottom for a
 * missing `y2` - so the band follows the axis wherever it goes.
 */

// Light enough to read the series through, in a line's own colour.
export const REFERENCE_LINE_SHADE_OPACITY: number = 0.07;

/*
 * Bounds are left out, never undefined: recharts reads a bound that is
 * there as one to draw to.
 */
export interface ReferenceLineShade {
  y1?: number;
  y2?: number;
  fill: string;
  fillOpacity: number;
  // A band shows where its line does: the axis takes it in when the line's does.
  ifOverflow?: "extendDomain";
}

export function getReferenceLineShade(
  line: ChartReferenceLineProps,
): ReferenceLineShade | null {
  if (
    (line.shade !== "above" && line.shade !== "below") ||
    typeof line.value !== "number" ||
    !Number.isFinite(line.value)
  ) {
    return null;
  }

  return {
    // Above: from the top of the plot down to the line; below: up to it.
    ...(line.shade === "above" ? { y2: line.value } : { y1: line.value }),
    fill: line.color,
    fillOpacity: REFERENCE_LINE_SHADE_OPACITY,
    ...(line.extendsDomain ? { ifOverflow: "extendDomain" as const } : {}),
  };
}
