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

/*
 * The part of a press or release a chart's handlers read. recharts hands a
 * chart-level mouse handler the React event as its second argument.
 */
export interface ChartPointerEvent {
  // The browser's click count: 2 on both halves of a double-click's second click.
  detail?: number | undefined;
  clientX?: number | undefined;
  button?: number | undefined;
}

/**
 * Whether a press is the second of a double-click, by the browser's own
 * count (MouseEvent.detail), so the platform's double-click time and
 * distance decide, exactly as they decide when `dblclick` is sent: at a
 * count of 2, not at the third press of a triple-click.
 */
export function isSecondPressOfDoubleClick(
  event?: ChartPointerEvent | null,
): boolean {
  if (!event || event.detail !== 2) {
    return false;
  }

  // Only the main button: a right-click opens a context menu.
  return !event.button;
}

export interface DoubleClickReset {
  /*
   * For every press on the chart. True when the press is the second of a
   * double-click while a reset is on offer: that press IS the reset, so
   * it must neither start a selection nor count as a click.
   */
  onPress: (event?: ChartPointerEvent | null) => boolean;
  /*
   * For the release of a press on the chart, or heard by the page. True
   * when it ended the reset press, which the caller must then not handle
   * as anything else.
   */
  onRelease: (event?: ChartPointerEvent | null) => boolean;
  // The chart's dblclick handler.
  onDoubleClick: () => void;
}

/**
 * Double-click to reset, without depending on the browser's `dblclick`
 * arriving.
 *
 * Chrome sends `dblclick` to the node the second click landed on, straight
 * after that click, and sends neither when that node left the page during
 * the press. A chart re-renders under a press whenever fresh data lands:
 * recharts re-keys a histogram's bars and a line's path when their data
 * changes. And fresh data lands right after a zoom - the very moment a
 * reader double-clicks to undo it - so the reset was lost at random, and
 * the chart stayed zoomed (issue #4116).
 *
 * The second press itself always arrives, counted: MouseEvent.detail is 2
 * whatever becomes of the node it landed on. Its release arms a reset for
 * the next task. Chrome sends the release's click and `dblclick` before
 * then, and the `dblclick` resets and stands the fallback down, so a
 * double-click that keeps its `dblclick` resets exactly as it always has,
 * and one that lost it still resets.
 *
 * `reset` is read when the reset happens, so a chart can hand a new one
 * every render; with none, there is no reset on offer.
 */
export function useDoubleClickReset(
  reset: (() => void) | undefined,
): DoubleClickReset {
  const resetRef: React.MutableRefObject<(() => void) | undefined> =
    React.useRef<(() => void) | undefined>(reset);
  resetRef.current = reset;

  // Whether the press in progress is the second of a double-click.
  const isResetPressRef: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const fallbackRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const standDown: () => void = React.useCallback((): void => {
    if (fallbackRef.current !== null) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return standDown;
  }, [standDown]);

  const onPress: (event?: ChartPointerEvent | null) => boolean =
    React.useCallback((event?: ChartPointerEvent | null): boolean => {
      isResetPressRef.current =
        Boolean(resetRef.current) && isSecondPressOfDoubleClick(event);
      return isResetPressRef.current;
    }, []);

  const onRelease: (event?: ChartPointerEvent | null) => boolean =
    React.useCallback(
      (event?: ChartPointerEvent | null): boolean => {
        if (!isResetPressRef.current) {
          return false;
        }

        isResetPressRef.current = false;

        /*
         * The release of a fresh single click cannot end the second press:
         * that press's own release never came (the window lost focus while
         * the button was down, say), and this one belongs to a later click.
         * It ends the reset press without resetting.
         */
        if (event && event.detail === 1) {
          return true;
        }

        standDown();
        fallbackRef.current = setTimeout(() => {
          fallbackRef.current = null;
          resetRef.current?.();
        }, 0);
        return true;
      },
      [standDown],
    );

  const onDoubleClick: () => void = React.useCallback((): void => {
    standDown();
    resetRef.current?.();
  }, [standDown]);

  return React.useMemo((): DoubleClickReset => {
    return {
      onPress: onPress,
      onRelease: onRelease,
      onDoubleClick: onDoubleClick,
    };
  }, [onPress, onRelease, onDoubleClick]);
}
