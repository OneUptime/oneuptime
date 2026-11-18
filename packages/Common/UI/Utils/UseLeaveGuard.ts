import LeaveGuard, { LeavePageFunction } from "./LeaveGuard";
import {
  MutableRefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// The page's own save, as its Save button runs it: rejects with why it did not save.
export type SaveBeforeLeavingFunction = () => Promise<void>;

/*
 * A step away from the page, waiting for the reader's answer while the page
 * shows its question (LeaveWithoutSavingQuestion, in the page's own words).
 */
export interface LeavePrompt {
  // Someone tried to leave the page, and the page asks before they do.
  isAsking: boolean;
  // Keep Editing: they stay, and the step they tried is dropped.
  stay: () => void;
  // Discard Changes: the step goes ahead, and the unsaved work goes with the page.
  leave: () => void;
  /*
   * Save Changes: the page saves its work, and the step goes ahead only once
   * the save worked. A save that is refused rejects with why, and the reader
   * stays on the page, still asked, with nothing lost.
   *
   * The step is the one asked about when the save began. Saving lets the
   * guard go - nothing is unsaved any more - and with it what it was asked;
   * the step is taken all the same, as Discard Changes would have taken it.
   */
  saveAndLeave: (save: SaveBeforeLeavingFunction) => Promise<void>;
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

  const saveAndLeave: (save: SaveBeforeLeavingFunction) => Promise<void> =
    useCallback(async (save: SaveBeforeLeavingFunction): Promise<void> => {
      /*
       * Held from before the save: once it lands, the page draws with
       * nothing unsaved and lets the guard go, which drops what is waiting
       * on an answer (above) - often before this goes on.
       */
      const pending: PendingLeave | null = pendingLeaveRef.current;

      // Refused: the step waits, and the question with it.
      await save();

      setPendingLeave(null);
      pendingLeaveRef.current = null;
      pending?.leave();
    }, []);

  return {
    isAsking: hasUnsavedChanges && pendingLeave !== null,
    stay: stay,
    leave: leave,
    saveAndLeave: saveAndLeave,
  };
};

export default useLeaveGuard;
