import { MutableRefObject, useCallback, useEffect, useRef } from "react";

/*
 * Runs an update once the press going on, if any, is over: for what a field
 * shows once it has been left.
 *
 * A field that says what it needs once it is left ("Pick or type the value
 * to check.") grows by a line when the message appears. Left by pressing a
 * button below it - Add case, a case's remove button - the message pushed
 * the button down between the press and the release, so the click landed on
 * nothing and the first press did nothing at all.
 *
 * So the update waits. While a mouse button is down, until it is released
 * and the click that release makes has been handled; otherwise - the
 * keyboard, or a tap, whose press is over before the focus moves and whose
 * click follows at once - until the events already on their way are.
 */
export type AfterPressFunction = (update: () => void) => void;

const PRESS_EVENTS: Array<string> = ["pointerdown", "mousedown"];
const RELEASE_EVENTS: Array<string> = ["pointerup", "mouseup", "pointercancel"];

const useAfterPress: () => AfterPressFunction = (): AfterPressFunction => {
  const isPressedRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const waitingRef: MutableRefObject<Array<() => void>> = useRef<
    Array<() => void>
  >([]);

  type RunLaterFunction = (updates: Array<() => void>) => void;

  // After the events already dispatched, the release's click among them.
  const runLater: RunLaterFunction = useCallback(
    (updates: Array<() => void>): void => {
      window.setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }

        for (const update of updates) {
          update();
        }
      }, 0);
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;

    const onPress: () => void = (): void => {
      isPressedRef.current = true;
    };

    const onRelease: () => void = (): void => {
      isPressedRef.current = false;

      if (waitingRef.current.length === 0) {
        return;
      }

      const updates: Array<() => void> = waitingRef.current;
      waitingRef.current = [];
      runLater(updates);
    };

    for (const name of PRESS_EVENTS) {
      document.addEventListener(name, onPress, true);
    }

    for (const name of RELEASE_EVENTS) {
      document.addEventListener(name, onRelease, true);
    }

    return () => {
      isMountedRef.current = false;
      waitingRef.current = [];

      for (const name of PRESS_EVENTS) {
        document.removeEventListener(name, onPress, true);
      }

      for (const name of RELEASE_EVENTS) {
        document.removeEventListener(name, onRelease, true);
      }
    };
  }, []);

  return useCallback((update: () => void): void => {
    if (isPressedRef.current) {
      waitingRef.current.push(update);
      return;
    }

    runLater([update]);
  }, []);
};

export default useAfterPress;
