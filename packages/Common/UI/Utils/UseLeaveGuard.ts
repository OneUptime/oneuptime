import LeaveGuard, { LeavePageFunction } from "./LeaveGuard";
import {
  MutableRefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * A step away from the page, waiting for the reader's answer while the page
 * shows its question (a ConfirmModal in the page's own words).
 */
export interface LeavePrompt {
  // Someone tried to leave the page, and the page asks before they do.
  isAsking: boolean;
  // Keep Editing: they stay, and the step they tried is dropped.
  stay: () => void;
  // Discard Changes: the step goes ahead, and the unsaved work goes with the page.
  leave: () => void;
}

interface PendingLeave {
  leave: LeavePageFunction;
}

/*
 * Holds the leave guard (LeaveGuard) while `hasUnsavedChanges` is true: the
 * page asks before it is left, and the browser asks before the tab closes or
 * reloads. Returns what the page needs to ask.
 *
 * A layout effect, so a page leaving the screen lets go in the same commit
 * that removes it, as useUnsavedChanges does - before anything that runs
 * after the commit asks.
 */
const useLeaveGuard: (hasUnsavedChanges: boolean) => LeavePrompt = (
  hasUnsavedChanges: boolean,
): LeavePrompt => {
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);

  const pendingLeaveRef: MutableRefObject<PendingLeave | null> =
    useRef<PendingLeave | null>(null);
  pendingLeaveRef.current = pendingLeave;

  useLayoutEffect(() => {
    if (!hasUnsavedChanges) {
      return undefined;
    }

    const release: () => void = LeaveGuard.hold(
      (leave: LeavePageFunction): void => {
        // The latest step asked about is the one Discard Changes takes.
        setPendingLeave({ leave: leave });
      },
    );

    return () => {
      release();
      // Nothing is waiting on an answer once nothing is unsaved.
      setPendingLeave(null);
    };
  }, [hasUnsavedChanges]);

  /*
   * Every time the page draws while it holds the guard, the history entry
   * it is shown at: a step inside the page (a query, a hash) can move it.
   */
  useLayoutEffect(() => {
    if (hasUnsavedChanges) {
      LeaveGuard.noteShownEntry();
    }
  });

  const stay: () => void = useCallback((): void => {
    setPendingLeave(null);
  }, []);

  const leave: () => void = useCallback((): void => {
    const pending: PendingLeave | null = pendingLeaveRef.current;

    setPendingLeave(null);
    pendingLeaveRef.current = null;
    pending?.leave();
  }, []);

  return {
    isAsking: hasUnsavedChanges && pendingLeave !== null,
    stay: stay,
    leave: leave,
  };
};

export default useLeaveGuard;
