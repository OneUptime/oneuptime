import { SaveBeforeLeavingFunction } from "Common/UI/Utils/UseLeaveGuard";
import { MutableRefObject, useCallback, useRef, useState } from "react";

/*
 * A PAGE OF PARTS, EACH WITH ITS OWN EDIT AND SAVE, AND THE ONE QUESTION
 * BEFORE THEIR UNSAVED WORDS ARE LOST (#7402).
 *
 * A store's record field by field, an impact assessment's parts, a
 * framework's paragraphs, a case's breach notices (#10375, #10377): a part
 * is edited in place and saved with its own Save. The page holds the leave
 * guard while any part holds words not saved yet, and its question
 * (LeaveWithoutSavingQuestion) offers Save Changes, as every editor's does:
 * each of those parts saved as its own Save saves it, one after another,
 * then on to where the reader was going. The first save refused stops it:
 * the reader stays, still asked, with why - and what was not saved yet is
 * still in its editor.
 */

export interface UnsavedParts {
  // Whether a part holds words not saved yet: what the page's leave guard holds.
  hasUnsaved: boolean;
  /*
   * A part says whether it holds words not saved yet, and how they are
   * saved: its own Save, which rejects with why it did not save.
   */
  onPartChange: (
    part: string,
    hasUnsaved: boolean,
    save: SaveBeforeLeavingFunction,
  ) => void;
  // Save Changes in the leave question: every part's save, one after another.
  saveAll: SaveBeforeLeavingFunction;
  // The page shows other parts now (another framework, say): none is unsaved.
  forgetAll: () => void;
}

const useUnsavedParts: () => UnsavedParts = (): UnsavedParts => {
  const [unsavedParts, setUnsavedParts] = useState<Array<string>>([]);

  // The save of each part's words, as they were when it last said: never drawn.
  const savesRef: MutableRefObject<Map<string, SaveBeforeLeavingFunction>> =
    useRef<Map<string, SaveBeforeLeavingFunction>>(new Map());

  const onPartChange: (
    part: string,
    hasUnsaved: boolean,
    save: SaveBeforeLeavingFunction,
  ) => void = useCallback(
    (part: string, hasUnsaved: boolean, save: SaveBeforeLeavingFunction) => {
      if (hasUnsaved) {
        savesRef.current.set(part, save);
      } else {
        savesRef.current.delete(part);
      }

      setUnsavedParts((current: Array<string>): Array<string> => {
        if (current.includes(part) === hasUnsaved) {
          return current;
        }

        return hasUnsaved
          ? [...current, part]
          : current.filter((unsavedPart: string): boolean => {
              return unsavedPart !== part;
            });
      });
    },
    [],
  );

  const saveAll: SaveBeforeLeavingFunction =
    useCallback(async (): Promise<void> => {
      // In the order the reader started on them; each saved part says so as it closes.
      for (const save of Array.from(savesRef.current.values())) {
        await save();
      }
    }, []);

  const forgetAll: () => void = useCallback((): void => {
    savesRef.current.clear();
    setUnsavedParts((current: Array<string>): Array<string> => {
      return current.length === 0 ? current : [];
    });
  }, []);

  return {
    hasUnsaved: unsavedParts.length > 0,
    onPartChange: onPartChange,
    saveAll: saveAll,
    forgetAll: forgetAll,
  };
};

export default useUnsavedParts;
