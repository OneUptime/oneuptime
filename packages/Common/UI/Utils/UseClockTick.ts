import { getMillisecondsUntilNextClockTick } from "../../Utils/Dashboard/ClockWidgetFormat";
import { useEffect, useState } from "react";

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
 */
export type UseClockTickFunction = (showSeconds: boolean) => Date;

const useClockTick: UseClockTickFunction = (showSeconds: boolean): Date => {
  const [now, setNow] = useState<Date>(() => {
    return new Date();
  });

  useEffect(() => {
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
  }, [showSeconds]);

  return now;
};

export default useClockTick;
