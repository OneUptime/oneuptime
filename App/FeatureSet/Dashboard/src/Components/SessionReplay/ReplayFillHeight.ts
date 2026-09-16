import {
  MutableRefObject,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { observeReplayFillHeight } from "./ReplayFillHeightMeasure";

/*
 * The React hook that keeps the player's fill height current. The
 * measurement it subscribes to lives in ReplayFillHeightMeasure.ts, which
 * stays free of React so App's node-environment tests can import it; it is
 * re-exported here so the player keeps a single import.
 */
export {
  REPLAY_FILL_BOTTOM_GUTTER_PX,
  REPLAY_FILL_HEIGHT_CSS_VAR,
  REPLAY_FILL_MIN_HEIGHT_PX,
  computeReplayFillHeight,
  measureReplayFillHeight,
  observeReplayFillHeight,
} from "./ReplayFillHeightMeasure";
export type {
  ReplayFillHeightElementLike,
  ReplayFillHeightResizeObserverConstructor,
  ReplayFillHeightResizeObserverLike,
  ReplayFillHeightViewLike,
} from "./ReplayFillHeightMeasure";

interface FillHeightSubscription {
  element: HTMLElement;
  dispose: () => void;
}

/*
 * The fill height for the element behind `ref`, kept current; null before
 * the first measurement, while the ref is empty, and whenever `isEnabled`
 * is false (theater mode sizes itself to the fullscreen element).
 *
 * The effect runs after every render but only resubscribes when the
 * element or the flag changed: the shell swaps its loading skeleton for
 * the real player under the same ref, and an effect keyed on the ref
 * object alone would keep observing the skeleton's detached node.
 */
export function useReplayFillHeight(
  ref: RefObject<HTMLElement | null>,
  isEnabled: boolean,
): number | null {
  const [height, setHeight] = useState<number | null>(null);
  const heightRef: MutableRefObject<number | null> = useRef<number | null>(
    null,
  );
  const subscriptionRef: MutableRefObject<FillHeightSubscription | null> =
    useRef<FillHeightSubscription | null>(null);

  useEffect(() => {
    const element: HTMLElement | null = isEnabled ? ref.current : null;
    const current: FillHeightSubscription | null = subscriptionRef.current;

    if (current && current.element === element) {
      return;
    }

    if (current) {
      current.dispose();
      subscriptionRef.current = null;
    }

    if (!element || typeof window === "undefined") {
      if (heightRef.current !== null) {
        heightRef.current = null;
        setHeight(null);
      }

      return;
    }

    subscriptionRef.current = {
      element: element,
      dispose: observeReplayFillHeight({
        element: element,
        view: window,
        onChange: (next: number): void => {
          heightRef.current = next;
          setHeight(next);
        },
      }),
    };
  });

  useEffect(() => {
    return (): void => {
      if (subscriptionRef.current) {
        subscriptionRef.current.dispose();
        subscriptionRef.current = null;
      }
    };
  }, []);

  return isEnabled ? height : null;
}
