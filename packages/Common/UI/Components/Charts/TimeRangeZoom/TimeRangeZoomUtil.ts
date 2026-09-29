import InBetween from "../../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../../Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";
import {
  HistogramSelectionWindow,
  clampHistogramSelectionToWindowEnd,
} from "../Utils/HistogramSelection";

export interface TimeRangeZoomSelection {
  /** One edge of the window dragged out on a chart. */
  startTime: Date;
  /** The other edge. A right-to-left drag hands them over reversed. */
  endTime: Date;
  /*
   * The range the page is on when the drag lands. The zoom never runs past
   * its end; see getZoomedRange.
   */
  currentRange?: RangeStartAndEndDateTime | undefined;
}

type ToEpochMsFunction = (value: unknown) => number;

/*
 * A range restored from a URL, a saved view or local storage can carry its
 * dates as ISO strings despite the type, so read every date through
 * OneUptimeDate.fromString. NaN for anything that is not a date.
 */
const toEpochMs: ToEpochMsFunction = (value: unknown): number => {
  if (value === undefined || value === null || value === "") {
    return Number.NaN;
  }

  try {
    return OneUptimeDate.fromString(value as Date).getTime();
  } catch {
    return Number.NaN;
  }
};

/**
 * The pure half of page-wide drag-to-zoom: what window a drag zooms to, and
 * whether the page is still on that window.
 */
export default class TimeRangeZoomUtil {
  /**
   * The custom range a drag-selection zooms the page to, or null when the
   * selection is not a usable window.
   *
   * - A drag right-to-left is the same window as left-to-right.
   * - A zero-width or invalid selection is not a window: a drag that never
   *   left its starting bucket can hand back one. Zooming to it would show
   *   nothing at all and spend a page-wide refetch doing so.
   * - The zoom never runs past the end of the range the page is on. The
   *   newest bucket is usually still filling up, so taken whole it reaches
   *   past "now" and would open a window that ends in the future (the same
   *   rule the log and trace histograms follow; see
   *   clampHistogramSelectionToWindowEnd).
   */
  public static getZoomedRange(
    selection: TimeRangeZoomSelection,
  ): RangeStartAndEndDateTime | null {
    const startMs: number = toEpochMs(selection.startTime);
    const endMs: number = toEpochMs(selection.endTime);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return null;
    }

    let window: HistogramSelectionWindow = {
      startTime: new Date(Math.min(startMs, endMs)),
      endTime: new Date(Math.max(startMs, endMs)),
    };

    if (window.startTime.getTime() === window.endTime.getTime()) {
      return null;
    }

    if (selection.currentRange) {
      const currentWindow: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(selection.currentRange);
      const currentWindowEndMs: number = toEpochMs(currentWindow.endValue);

      if (Number.isFinite(currentWindowEndMs)) {
        window = clampHistogramSelectionToWindowEnd(
          window,
          new Date(currentWindowEndMs),
        );
      }
    }

    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(window.startTime, window.endTime),
    };
  }

  /**
   * Whether two ranges describe the same window. A relative range ("past
   * hour") is the same range whatever dates it resolved to last time; a
   * custom range is the same when both edges are the same instant, however
   * they are represented.
   */
  public static isSameRange(
    first: RangeStartAndEndDateTime | null | undefined,
    second: RangeStartAndEndDateTime | null | undefined,
  ): boolean {
    if (!first || !second) {
      return !first && !second;
    }

    if (first === second) {
      return true;
    }

    if (first.range !== second.range) {
      return false;
    }

    if (first.range !== TimeRange.CUSTOM) {
      return true;
    }

    const firstStartMs: number = toEpochMs(first.startAndEndDate?.startValue);
    const firstEndMs: number = toEpochMs(first.startAndEndDate?.endValue);
    const secondStartMs: number = toEpochMs(second.startAndEndDate?.startValue);
    const secondEndMs: number = toEpochMs(second.startAndEndDate?.endValue);

    return (
      Number.isFinite(firstStartMs) &&
      Number.isFinite(firstEndMs) &&
      firstStartMs === secondStartMs &&
      firstEndMs === secondEndMs
    );
  }

  /**
   * A range's value as a string, for an effect to depend on: a page that
   * re-states its range in a new but equal object must not look like a
   * move. Two ranges isSameRange calls the same get the same key: a
   * relative range is keyed by its preset alone, whatever it last resolved
   * to, and a custom one by the instants of its edges.
   */
  public static getRangeKey(
    range: RangeStartAndEndDateTime | null | undefined,
  ): string {
    if (!range) {
      return "";
    }

    if (range.range !== TimeRange.CUSTOM) {
      return range.range;
    }

    return [
      range.range,
      toEpochMs(range.startAndEndDate?.startValue),
      toEpochMs(range.startAndEndDate?.endValue),
    ].join("|");
  }
}
