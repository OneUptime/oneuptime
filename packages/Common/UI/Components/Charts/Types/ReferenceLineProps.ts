export default interface ChartReferenceLineProps {
  value: number;
  label?: string | undefined;
  color: string; // CSS color, e.g. "#f59e0b" or "red"
  // e.g. "4 4" for dashed; left out, the line takes DEFAULT_REFERENCE_LINE_DASH.
  strokeDasharray?: string | undefined;
  /*
   * Stretch the value axis to take the line in when it lies past the data
   * (recharts' ifOverflow "extendDomain"). Off by default, so a threshold
   * far above a dashboard's data never squeezes it: a monitor rule's
   * preview turns it on, since its line is the very thing being set.
   */
  extendsDomain?: boolean | undefined;
  /*
   * Shade the side of the line a rule matches, faintly in the line's
   * colour, to the edge of the plot: a monitor's threshold shades where it
   * alerts, so the stretches the metric spent past it stand out
   * (ReferenceLineShade). Left out, nothing is shaded.
   */
  shade?: "above" | "below" | undefined;
}

// The dash a reference line is drawn with when it names none of its own.
export const DEFAULT_REFERENCE_LINE_DASH: string = "4 4";

/*
 * Where a chart writes its reference lines' labels.
 *
 *   - OnLine: at the right end of each line, inside the plot - where a long
 *     label, or one in a language that words it longer, can sit on the
 *     series it marks, and a line at the bottom of the plot puts its label
 *     on the time axis's ticks.
 *   - Legend: in a legend under the chart, each label beside a short stroke
 *     drawn in its line's colour and dash. Nothing is written over the plot,
 *     and the legend wraps on a phone.
 */
export enum ReferenceLineLabelPlacement {
  OnLine = "OnLine",
  Legend = "Legend",
}
