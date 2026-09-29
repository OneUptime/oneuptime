import { useCallback, useSyncExternalStore } from "react";
import {
  ReplayClockListener,
  ReplayEngineListener,
  ReplayEngineSnapshot,
} from "./Engine/ReplayEngineTypes";

/*
 * Reading the playhead without re-rendering the player for it.
 *
 * The engine publishes at most every 33ms while playing, and every publish
 * used to reach the composition root through useSyncExternalStore over the
 * WHOLE snapshot - a new object each time, so React re-rendered the header,
 * the overlays, the stage, the scrubber, the timeline and the rail about
 * thirty times a second, synchronously, in the same frame rrweb was using
 * to cast mutations. Most of that work existed to move readouts that change
 * once a second.
 *
 * The engine now publishes on two channels: a structural snapshot whose
 * identity only changes when something OTHER than the playhead changed, and
 * a clock channel carrying the playhead alone. The root subscribes to the
 * structural one; everything that needs the time calls this hook with the
 * coarsest quantum it can live with, and re-renders only when THAT value
 * changes. The returned number is a primitive, so React's own bail-out does
 * the rest: a 250ms quantum is at most four renders a second however fast
 * the engine publishes.
 *
 * Quanta in use (see SessionReplayPlayer): 16ms for the timeline's needle,
 * which has to move every frame; 100ms for the transport's readout; 250ms
 * for the header, the rail and the overlays, whose text is whole seconds.
 */

/*
 * The slice of the engine this hook needs. Declared structurally, with the
 * clock methods optional, so a fake engine written against the original
 * contract still satisfies it and falls back to the whole-snapshot channel.
 */
export interface ReplayClockLike {
  subscribe: (listener: ReplayEngineListener) => () => void;
  getSnapshot: () => ReplayEngineSnapshot;
  subscribeClock?: ((listener: ReplayClockListener) => () => void) | undefined;
  getCurrentTimeMs?: (() => number) | undefined;
}

/* A quantum of 1 (or less) means "every millisecond the engine reports". */
export function quantiseReplayClock(
  currentTimeMs: number,
  quantumMs: number,
): number {
  if (!isFinite(currentTimeMs)) {
    return 0;
  }

  if (!isFinite(quantumMs) || quantumMs <= 1) {
    return currentTimeMs;
  }

  return Math.floor(currentTimeMs / quantumMs) * quantumMs;
}

export function useReplayClock(
  clock: ReplayClockLike | null | undefined,
  quantumMs: number,
): number {
  const subscribe: (onStoreChange: () => void) => () => void = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (!clock) {
        return (): void => {
          // Nothing to unsubscribe from before the engine exists.
        };
      }

      /*
       * The clock channel when the engine offers one, the whole-snapshot
       * channel otherwise. Both fire once per publish; the difference is
       * only what they carry, and the getter below reads the time either
       * way, so a fake engine behaves identically (just less cheaply).
       */
      if (clock.subscribeClock) {
        return clock.subscribeClock((): void => {
          onStoreChange();
        });
      }

      return clock.subscribe((): void => {
        onStoreChange();
      });
    },
    [clock],
  );

  const getSnapshot: () => number = useCallback((): number => {
    if (!clock) {
      return 0;
    }

    const currentTimeMs: number = clock.getCurrentTimeMs
      ? clock.getCurrentTimeMs()
      : clock.getSnapshot().currentTimeMs;

    return quantiseReplayClock(currentTimeMs, quantumMs);
  }, [clock, quantumMs]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export default useReplayClock;
