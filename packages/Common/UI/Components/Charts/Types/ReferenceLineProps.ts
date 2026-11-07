export default interface ChartReferenceLineProps {
  value: number;
  label?: string | undefined;
  color: string; // CSS color, e.g. "#f59e0b" or "red"
  strokeDasharray?: string | undefined; // e.g. "4 4" for dashed
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
