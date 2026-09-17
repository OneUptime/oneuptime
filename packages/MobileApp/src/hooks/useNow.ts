import { useEffect, useState } from "react";

/*
 * A clock the countdowns can re-render from.
 *
 * Without it, "2h 14m left" is written once when the screen mounts and then
 * sits there being wrong - and a stale handoff countdown is worse than none,
 * because the whole reason to put one on the screen is that the reader is
 * about to make a decision based on it.
 *
 * A minute is the resolution the format actually has, so ticking faster would
 * only re-render for nothing.
 */
const DEFAULT_INTERVAL_MS: number = 30 * 1000;

export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const [now, setNow] = useState<number>(() => {
    return Date.now();
  });

  useEffect((): (() => void) => {
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      setNow(Date.now());
    }, intervalMs);

    return (): void => {
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
