import API from "../../Utils/API/API";
import React, { useCallback, useRef, useState } from "react";

/*
 * Whether the workflow open in the Builder is turned on, and the switch that
 * changes it.
 *
 * Off pauses the workflow's trigger, not a person testing it: Run Workflow
 * and Run just this step go ahead whether the workflow is on or off, and a
 * run started while it is off is a test run (Types/Workflow/WorkflowEnabled).
 * "Why do I have to enable a workflow in order to test run it?" - this hook
 * used to hold such a run behind a dialog that asked to turn the workflow on
 * first, which let its trigger loose just to try it once. It holds nothing
 * now: the Builder sends a run as it is asked for, and reads isEnabled only
 * to draw the switch, the notice above the canvas and the Run Workflow
 * panel's test-run note.
 */

export interface UseWorkflowEnabledOptions {
  // Saves the switch. Rejects with the API's error when the save is refused.
  saveIsEnabled: (isEnabled: boolean) => Promise<void>;
  // A switch that could not be saved: the page shows why.
  onError: (message: string) => void;
}

export interface UseWorkflowEnabledResult {
  // Null until the workflow has loaded, and whenever it is not known.
  isEnabled: boolean | null;
  // What the workflow said when the Builder loaded it.
  setLoadedIsEnabled: (isEnabled: boolean | null) => void;
  // The switch is being saved.
  isSaving: boolean;
  /*
   * The toolbar's switch and the notice's Turn on workflow. The switch moves
   * at once and moves back if the save is refused.
   */
  setIsEnabled: (isEnabled: boolean) => Promise<void>;
}

const useWorkflowEnabled: (
  options: UseWorkflowEnabledOptions,
) => UseWorkflowEnabledResult = (
  options: UseWorkflowEnabledOptions,
): UseWorkflowEnabledResult => {
  const [isEnabled, setIsEnabledState] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  /*
   * The callbacks below outlive the render that made them - a save resolves
   * after the switch has re-rendered - so they read these, not the state of
   * the render they were made in.
   */
  const isEnabledRef: React.MutableRefObject<boolean | null> = useRef<
    boolean | null
  >(null);
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const optionsRef: React.MutableRefObject<UseWorkflowEnabledOptions> =
    useRef<UseWorkflowEnabledOptions>(options);

  optionsRef.current = options;

  type UpdateIsEnabledFunction = (value: boolean | null) => void;

  const updateIsEnabled: UpdateIsEnabledFunction = (
    value: boolean | null,
  ): void => {
    isEnabledRef.current = value;
    setIsEnabledState(value);
  };

  const setLoadedIsEnabled: (value: boolean | null) => void = useCallback(
    (value: boolean | null): void => {
      updateIsEnabled(value);
    },
    [],
  );

  const setIsEnabled: (value: boolean) => Promise<void> = useCallback(
    async (value: boolean): Promise<void> => {
      if (isSavingRef.current) {
        return;
      }

      const previous: boolean | null = isEnabledRef.current;

      if (previous === value) {
        return;
      }

      isSavingRef.current = true;
      setIsSaving(true);
      updateIsEnabled(value);

      try {
        await optionsRef.current.saveIsEnabled(value);
      } catch (err) {
        updateIsEnabled(previous);
        optionsRef.current.onError(API.getFriendlyMessage(err));
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [],
  );

  return {
    isEnabled,
    setLoadedIsEnabled,
    isSaving,
    setIsEnabled,
  };
};

export default useWorkflowEnabled;
