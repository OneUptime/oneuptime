import API from "../../Utils/API/API";
import { SaveState } from "./SaveStatus";
import { MutableRefObject, useRef, useState } from "react";

/*
 * A setting that saves the moment it changes - a dropdown, a set of chips -
 * with no Edit button, no dialog and no Save button: what the control
 * shows, where its last change is ("Saving…", "Saved", for SaveStatus
 * beside it), and why a change did not save.
 *
 * - A change shows at once and is saved at once. The control is never
 *   locked while it saves, so keyboard focus stays on it: a change made
 *   before the last one is saved waits its turn, and only the latest waiting
 *   change is sent after it, so the record ends up with the last thing
 *   picked, one request at a time.
 * - A change to what the record already has sends nothing.
 * - A change the server refuses puts back what the record has, with the
 *   server's reason; a change waiting its turn goes with it.
 * - A change the setting itself will not take (taking the last status off a
 *   list that needs one) is turned down with `refuse`, which shows what the
 *   record has again, with why. A control that keeps a copy of its own
 *   value (react-select does) is told to follow through `revision`, which
 *   moves every time the setting goes back to what the record has.
 */

export interface SaveOnChange<T> {
  // What the control shows: what the record has, or a change being saved.
  value: T;
  // What the record has, as first read or last saved.
  savedValue: T;
  saveState: SaveState;
  // Why the last change was not saved, or "".
  error: string;
  // Changes over every time the control goes back to what the record has.
  revision: number;
  // Shows `value` and saves it: now, or after the save on its way.
  change: (value: T) => void;
  // Turns down a change without saving it, saying why.
  refuse: (reason: string) => void;
}

export interface SaveOnChangeOptions<T> {
  // What the record has when the control first draws.
  initialValue: T;
  // Writes the value; throws (with the server's reason) when refused.
  save: (value: T) => Promise<void>;
  // Whether two values are the same setting (a list in another order).
  isSame?: ((first: T, second: T) => boolean) | undefined;
  // Told after each change is saved.
  onSaved?: ((value: T) => void) | undefined;
}

const useSaveOnChange: <T>(options: SaveOnChangeOptions<T>) => SaveOnChange<T> =
  <T>(options: SaveOnChangeOptions<T>): SaveOnChange<T> => {
    const [value, setValue] = useState<T>(options.initialValue);
    const [savedValue, setSavedValue] = useState<T>(options.initialValue);
    const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);
    const [error, setError] = useState<string>("");
    const [revision, setRevision] = useState<number>(0);

    /*
     * Set at once, where the state above lands on the next render: whether a
     * save is on its way, what the record has, the last change asked for,
     * and a change waiting its turn.
     */
    const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);
    const savedValueRef: MutableRefObject<T> = useRef<T>(options.initialValue);
    const latestValueRef: MutableRefObject<T> = useRef<T>(
      options.initialValue,
    );
    const waitingRef: MutableRefObject<{ value: T } | null> = useRef<{
      value: T;
    } | null>(null);

    // The options of the latest render, for a save that outlives it.
    const optionsRef: MutableRefObject<SaveOnChangeOptions<T>> =
      useRef<SaveOnChangeOptions<T>>(options);
    optionsRef.current = options;

    const isSame: (first: T, second: T) => boolean = (
      first: T,
      second: T,
    ): boolean => {
      const compare: ((first: T, second: T) => boolean) | undefined =
        optionsRef.current.isSame;

      return compare ? compare(first, second) : first === second;
    };

    const saveUntilSettled: (first: T) => Promise<void> = async (
      first: T,
    ): Promise<void> => {
      isSavingRef.current = true;

      let next: { value: T } | null = { value: first };

      while (next) {
        const target: T = next.value;

        // A waiting change back to what the record now has sends nothing.
        if (isSame(target, savedValueRef.current)) {
          next = waitingRef.current;
          waitingRef.current = null;
          continue;
        }

        setSaveState(SaveState.Saving);

        try {
          await optionsRef.current.save(target);

          savedValueRef.current = target;
          setSavedValue(target);
          setSaveState(SaveState.Saved);
          optionsRef.current.onSaved?.(target);
        } catch (err) {
          // Back to what the record has, with the reason; a waiting change goes too.
          waitingRef.current = null;
          latestValueRef.current = savedValueRef.current;
          setValue(savedValueRef.current);
          setSaveState(SaveState.Idle);
          setError(API.getFriendlyMessage(err));
          setRevision((current: number): number => {
            return current + 1;
          });
          break;
        }

        next = waitingRef.current;
        waitingRef.current = null;
      }

      isSavingRef.current = false;
    };

    const change: (next: T) => void = (next: T): void => {
      latestValueRef.current = next;
      setValue(next);
      setError("");

      if (isSavingRef.current) {
        waitingRef.current = { value: next };
        return;
      }

      if (isSame(next, savedValueRef.current)) {
        return;
      }

      void saveUntilSettled(next);
    };

    const refuse: (reason: string) => void = (reason: string): void => {
      // What was last asked for stays: the change being saved, or the record's.
      setValue(latestValueRef.current);
      setError(reason);
      setRevision((current: number): number => {
        return current + 1;
      });

      if (!isSavingRef.current) {
        setSaveState(SaveState.Idle);
      }
    };

    return {
      value,
      savedValue,
      saveState,
      error,
      revision,
      change,
      refuse,
    };
  };

export default useSaveOnChange;
