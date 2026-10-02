import { getMillisecondsUntilNextClockTick } from "../../Utils/Dashboard/ClockWidgetFormat";
import { useEffect, useState } from "react";

export interface UseClockTickOptions {
  /*
   * False stops the clock: no timer is armed, nothing listens for the tab
   * coming back, and the time last read is handed back unchanged. Defaults
   * to true. A live duration whose end has arrived turns it off, so a table
   * of finished rows costs no timers at all.
   */
  isEnabled?: boolean | undefined;
}

/**
 * The current time, re-read once a second (or once a minute) and kept honest.
 *
 * Two things go wrong with the obvious `setInterval(1000)` version, and both
 * are handled here rather than in the widget that renders the digits:
 *
 * 1. Drift. An interval accumulates every scheduling delay, so a clock left
 *    open all day slides behind the real one and eventually skips a second
 *    outright. Re-arming a timeout to the next real boundary after each tick
 *    keeps the displayed second in step however late a callback runs.
 *
 * 2. Background tabs. Browsers throttle timers hard in a tab that is not
 *    visible — to once a minute or less, and effectively not at all in a tab
 *    that has stopped compositing. A dashboard left on a second monitor and
 *    come back to would otherwise show a time minutes out of date until its
 *    next throttled tick, which is the one moment a clock must not lie. The
 *    visibilitychange listener re-reads the time and re-arms the moment the
 *    tab comes back.
 *
 * @param showSeconds - tick every second when true, every minute when false.
 * @param options - `isEnabled: false` pauses the clock (see above).
 */
export type UseClockTickFunction = (
  showSeconds: boolean,
  options?: UseClockTickOptions | undefined,
) => Date;

const useClockTick: UseClockTickFunction = (
  showSeconds: boolean,
  options?: UseClockTickOptions | undefined,
): Date => {
  const isEnabled: boolean = options?.isEnabled !== false;

  const [now, setNow] = useState<Date>(() => {
    return new Date();
  });

  const [wasEnabled, setWasEnabled] = useState<boolean>(isEnabled);

  /*
   * Switched back on after a pause: the time read before it stopped is as
   * stale as the pause was long. Re-read it during this render rather than in
   * the effect below, so not even one frame is painted with the old time.
   */
  if (wasEnabled !== isEnabled) {
    setWasEnabled(isEnabled);

    if (isEnabled) {
      setNow(new Date());
    }
  }

  useEffect(() => {
    if (!isEnabled) {
      return () => {
        // Nothing was armed, so there is nothing to clean up.
      };
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearPendingTick: () => void = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleNextTick: () => void = (): void => {
      const current: Date = new Date();

      setNow(current);

      timeoutId = setTimeout(
        scheduleNextTick,
        getMillisecondsUntilNextClockTick({
          date: current,
          showSeconds: showSeconds,
        }),
      );
    };

    const resyncOnVisible: () => void = (): void => {
      if (document.visibilityState !== "visible") {
        return;
      }

      // Drop the throttled timer and restart from the real current time.
      clearPendingTick();
      scheduleNextTick();
    };

    scheduleNextTick();
    document.addEventListener("visibilitychange", resyncOnVisible);

    return () => {
      clearPendingTick();
      document.removeEventListener("visibilitychange", resyncOnVisible);
    };
  }, [showSeconds, isEnabled]);

  return now;
};

export default useClockTick;
