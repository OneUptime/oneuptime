import OneUptimeDate from "../../../../Types/Date";

export interface HistogramSelectionWindow {
  startTime: Date;
  endTime: Date;
}

export interface HistogramSelectionInput {
  /** Label of the bar the selection started on: the START of its bucket. */
  fromBucket: string;
  /** Label of the bar the selection ended on: the START of its bucket. */
  toBucket: string;
  /*
   * How much time one bar covers. Unknown (or not a positive number) means
   * the selection can only run from label to label.
   */
  bucketIntervalMs?: number | undefined;
}

type GetHistogramSelectionWindowFunction = (
  input: HistogramSelectionInput,
) => HistogramSelectionWindow | null;

/**
 * The window of time a selection on a time histogram covers.
 *
 * Each bar is labelled with the start of its bucket, so read literally a
 * selection runs from the start of the first bar to the start of the last:
 * the last bar is dropped, and a click on a single bar becomes a window zero
 * seconds wide. That window matches no row at all, while the chart zoomed
 * into it goes on drawing the bar's volume - the "shows no logs" report in
 * issue #3914. With the bucket width known, the window runs to the END of
 * the last bar instead, so it holds every row the selected bars counted.
 *
 * Returns null when there is no window worth zooming into: a label that is
 * not a date, or a single bar whose width is unknown. A zero-width window is
 * never what the reader asked for.
 */
export const getHistogramSelectionWindow: GetHistogramSelectionWindowFunction =
  (input: HistogramSelectionInput): HistogramSelectionWindow | null => {
    const fromMs: number = OneUptimeDate.fromString(input.fromBucket).getTime();
    const toMs: number = OneUptimeDate.fromString(input.toBucket).getTime();

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return null;
    }

    const intervalMs: number =
      typeof input.bucketIntervalMs === "number" &&
      Number.isFinite(input.bucketIntervalMs) &&
      input.bucketIntervalMs > 0
        ? input.bucketIntervalMs
        : 0;

    const startMs: number = Math.min(fromMs, toMs);
    const endMs: number = Math.max(fromMs, toMs) + intervalMs;

    if (endMs <= startMs) {
      return null;
    }

    return { startTime: new Date(startMs), endTime: new Date(endMs) };
  };

type ClampHistogramSelectionToWindowEndFunction = (
  selection: HistogramSelectionWindow,
  windowEnd: Date,
) => HistogramSelectionWindow;

/**
 * Keeps a zoom from running past the end of the window it zooms out of.
 *
 * Buckets are aligned to the clock rather than to the window, so the newest
 * bar usually reaches past "now" (it is still filling up) and the last bar of
 * a fixed window can reach past that window's end. Zooming into it whole
 * would open a window that ends in the future, or one that shows rows the
 * bar never counted.
 *
 * Only the end is clamped. A relative window ("past hour") slides forward
 * with the clock, so its start moves on while the chart drawn a few minutes
 * earlier stays put; clamping the start as well would cut into bars the
 * reader can still see. Its end, "now", only ever grows, so it is always a
 * safe edge.
 *
 * A selection that starts at or after the window end - the chart is still
 * showing the buckets of a window the reader has since left - is returned
 * untouched: clamping it would leave nothing to show.
 */
export const clampHistogramSelectionToWindowEnd: ClampHistogramSelectionToWindowEndFunction =
  (
    selection: HistogramSelectionWindow,
    windowEnd: Date,
  ): HistogramSelectionWindow => {
    /*
     * Read through fromString: a window restored from a URL or a saved view
     * can carry its dates as ISO strings despite the type.
     */
    const startMs: number = OneUptimeDate.fromString(
      selection.startTime,
    ).getTime();
    const endMs: number = OneUptimeDate.fromString(selection.endTime).getTime();
    const windowEndMs: number = OneUptimeDate.fromString(windowEnd).getTime();

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      !Number.isFinite(windowEndMs)
    ) {
      return selection;
    }

    if (windowEndMs >= endMs || windowEndMs <= startMs) {
      return selection;
    }

    return { startTime: new Date(startMs), endTime: new Date(windowEndMs) };
  };
