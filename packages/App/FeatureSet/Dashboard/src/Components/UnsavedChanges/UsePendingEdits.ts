import { SaveBeforeLeavingFunction } from "Common/UI/Utils/UseLeaveGuard";
import { MutableRefObject, useRef, useState } from "react";

/*
 * A page of parts edited one at a time, each with its own Save (an impact
 * assessment's parts, a framework's paragraphs, a store's record fields):
 * which of them a person is mid-edit on, with the words or value not saved
 * yet, so the page's leave question can offer Save Changes
 * (LeaveWithoutSavingQuestion's onSaveChanges, LeaveWithoutSavingQuestionGuard).
 *
 * Each part's editor tells it whether it holds unsaved words, and which
 * (track). saveAllWith saves every one of them with the part's own save, one
 * after another, and rejects with the first refusal: the parts before it are
 * saved, the rest are kept, and the question says why. The words are kept
 * aside from the page's state, so typing does not draw the page again; only
 * whether a part is unsaved does.
 */
export interface PendingEdits<TValue> {
  hasUnsaved: boolean;
  track: (key: string, isUnsaved: boolean, value: TValue) => void;
  saveAllWith: (
    save: (key: string, value: TValue) => Promise<void>,
  ) => SaveBeforeLeavingFunction;
  clear: () => void;
}

export default function usePendingEdits<TValue>(): PendingEdits<TValue> {
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const values: MutableRefObject<Map<string, TValue>> = useRef<
    Map<string, TValue>
  >(new Map<string, TValue>());

  return {
    hasUnsaved: Object.values(unsaved).some(Boolean),
    track: (key: string, isUnsaved: boolean, value: TValue): void => {
      if (isUnsaved) {
        values.current.set(key, value);
      } else {
        values.current.delete(key);
      }

      setUnsaved(
        (current: Record<string, boolean>): Record<string, boolean> => {
          return current[key] === isUnsaved
            ? current
            : { ...current, [key]: isUnsaved };
        },
      );
    },
    saveAllWith: (
      save: (key: string, value: TValue) => Promise<void>,
    ): SaveBeforeLeavingFunction => {
      return async (): Promise<void> => {
        for (const [key, value] of Array.from(values.current.entries())) {
          await save(key, value);
        }
      };
    },
    clear: (): void => {
      values.current.clear();
      setUnsaved({});
    },
  };
}
