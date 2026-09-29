import React from "react";

/**
 * How long a chart holds a single click open, waiting to see whether it is
 * really the first half of a double-click.
 *
 * Charts that accept `onTimeRangeReset` have to tell a bucket click apart
 * from a reset gesture, and the browser delivers BOTH clicks of a
 * double-click before it delivers `dblclick` — so the only way a
 * double-click can avoid also pinning a bucket twice is for the click path
 * to wait. Kept just above the ~200ms most platforms use as their
 * double-click threshold, and short enough that a real single click still
 * feels immediate. Charts with no reset handler skip the wait entirely.
 */
export const DOUBLE_CLICK_DISAMBIGUATION_MS: number = 250;

export interface DeferredChartClick {
  /*
   * Runs a click's action: at once while no double-click is on offer,
   * else once DOUBLE_CLICK_DISAMBIGUATION_MS pass with no dblclick. A
   * later click replaces a pending one.
   */
  run: (action: () => void) => void;
  // For the chart's dblclick: drops the clicks it was made of.
  cancel: () => void;
}

/**
 * Holds every click action on a chart's plot (a bucket click, a series,
 * dot or bar toggle) open while a double-click reset is on offer, so a
 * double-click is not also two clicks.
 *
 * Holding them also keeps the chart from re-rendering between the two
 * clicks and the dblclick. Chrome sends dblclick to the node the second
 * click landed on, straight after that click; an action that re-renders
 * the chart there (a series toggle - recharts re-keys a line's path when
 * its props change) takes that node out of the page first, the dblclick
 * never reaches the chart, and the zoom is not reset.
 */
export function useDeferredChartClick(isArmed: boolean): DeferredChartClick {
  const pendingClickRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel: () => void = React.useCallback((): void => {
    if (pendingClickRef.current !== null) {
      clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return cancel;
  }, [cancel]);

  const run: (action: () => void) => void = React.useCallback(
    (action: () => void): void => {
      if (!isArmed) {
        action();
        return;
      }
      cancel();
      pendingClickRef.current = setTimeout(() => {
        pendingClickRef.current = null;
        action();
      }, DOUBLE_CLICK_DISAMBIGUATION_MS);
    },
    [isArmed, cancel],
  );

  return React.useMemo((): DeferredChartClick => {
    return { run: run, cancel: cancel };
  }, [run, cancel]);
}
