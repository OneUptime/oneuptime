import API from "../../Utils/API/API";
import React, { useCallback, useRef, useState } from "react";

/*
 * Whether the workflow open in the Builder is turned on, the switch that
 * changes it, and what happens when someone runs the workflow, or one of its
 * steps, while it is off.
 *
 * The server refuses to run a workflow that is off (QueueWorkflow), and that
 * rule stays: off is how a workflow is built without its trigger firing on
 * real events, and how one is paused. What changes is what the Builder does
 * about it. It used to send the run anyway and show the refusal, "This
 * workflow is not enabled", in an Error dialog whose only button closed it:
 * nothing said how to turn the workflow on, or where. Now a run started while
 * the workflow is off is held, and a dialog offers to turn the workflow on
 * and then finish the run: the step the user asked for, with the values they
 * gave it.
 *
 * The Builder knows the switch from loading the workflow, so a run is held
 * before anything is sent. A run the server refuses anyway (someone turned
 * the workflow off in another tab) is checked against the switch, read
 * again, rather than against the wording of the refusal, and held the same
 * way.
 */

export enum WorkflowRunKind {
  // Run Workflow, from the run panel the toolbar opens.
  Workflow = "Workflow",
  // Run just this step, from a step's settings.
  Step = "Step",
}

export interface WorkflowRunAttempt {
  kind: WorkflowRunKind;
  // The step's title, for a step. The dialog names it.
  stepTitle?: string | undefined;
  /*
   * Sends the run, and rejects with the API's error when the server refuses
   * it. Called again, as it is, once the workflow has been turned on.
   */
  run: () => Promise<void>;
}

export interface UseWorkflowEnabledOptions {
  // Saves the switch. Rejects with the API's error when the save is refused.
  saveIsEnabled: (isEnabled: boolean) => Promise<void>;
  /*
   * Reads the switch from the server again, after a run was refused. Null
   * when it cannot be read.
   */
  fetchIsEnabled: () => Promise<boolean | null>;
  /*
   * Something went wrong that the page has to show: a run refused for another
   * reason, or a switch that could not be saved.
   */
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
  // Sends a run, or holds it while the workflow is off.
  run: (attempt: WorkflowRunAttempt) => Promise<void>;
  // The run being held. The turn-on dialog is open while there is one.
  heldRun: WorkflowRunAttempt | null;
  isTurningOn: boolean;
  // Why the workflow could not be turned on, for the dialog to show.
  turnOnError: string;
  // Turns the workflow on, then sends the held run.
  turnOnAndRun: () => Promise<void>;
  // Closes the dialog. The held run is dropped.
  dismissHeldRun: () => void;
}

const useWorkflowEnabled: (
  options: UseWorkflowEnabledOptions,
) => UseWorkflowEnabledResult = (
  options: UseWorkflowEnabledOptions,
): UseWorkflowEnabledResult => {
  const [isEnabled, setIsEnabledState] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [heldRun, setHeldRunState] = useState<WorkflowRunAttempt | null>(null);
  const [isTurningOn, setIsTurningOn] = useState<boolean>(false);
  const [turnOnError, setTurnOnError] = useState<string>("");

  /*
   * The callbacks below outlive the render that made them - a run's
   * continuation is called after a dialog has come and gone - so they read
   * these, not the state of the render they were made in.
   */
  const isEnabledRef: React.MutableRefObject<boolean | null> = useRef<
    boolean | null
  >(null);
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const heldRunRef: React.MutableRefObject<WorkflowRunAttempt | null> =
    useRef<WorkflowRunAttempt | null>(null);
  const isTurningOnRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
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

  type HoldRunFunction = (attempt: WorkflowRunAttempt | null) => void;

  const holdRun: HoldRunFunction = (
    attempt: WorkflowRunAttempt | null,
  ): void => {
    heldRunRef.current = attempt;
    setHeldRunState(attempt);
  };

  type UpdateIsTurningOnFunction = (value: boolean) => void;

  const updateIsTurningOn: UpdateIsTurningOnFunction = (
    value: boolean,
  ): void => {
    isTurningOnRef.current = value;
    setIsTurningOn(value);
  };

  const setLoadedIsEnabled: (value: boolean | null) => void = useCallback(
    (value: boolean | null): void => {
      updateIsEnabled(value);
    },
    [],
  );

  const setIsEnabled: (value: boolean) => Promise<void> = useCallback(
    async (value: boolean): Promise<void> => {
      if (isSavingRef.current || isTurningOnRef.current) {
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

  const run: (attempt: WorkflowRunAttempt) => Promise<void> = useCallback(
    async (attempt: WorkflowRunAttempt): Promise<void> => {
      if (isEnabledRef.current === false) {
        setTurnOnError("");
        holdRun(attempt);
        return;
      }

      try {
        await attempt.run();
      } catch (err) {
        /*
         * Refused. If the workflow is off after all, that is why: ask to turn
         * it on, as if the Builder had known. Anything else is shown as it is.
         */
        let isOnNow: boolean | null = null;

        try {
          isOnNow = await optionsRef.current.fetchIsEnabled();
        } catch {
          isOnNow = null;
        }

        if (isOnNow === false) {
          updateIsEnabled(false);
          setTurnOnError("");
          holdRun(attempt);
          return;
        }

        if (isOnNow === true) {
          updateIsEnabled(true);
        }

        optionsRef.current.onError(API.getFriendlyMessage(err));
      }
    },
    [],
  );

  const turnOnAndRun: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const attempt: WorkflowRunAttempt | null = heldRunRef.current;

      if (!attempt || isTurningOnRef.current) {
        return;
      }

      updateIsTurningOn(true);
      setTurnOnError("");

      try {
        await optionsRef.current.saveIsEnabled(true);
      } catch (err) {
        // The dialog stays open with the reason; the run is still held.
        setTurnOnError(API.getFriendlyMessage(err));
        updateIsTurningOn(false);
        return;
      }

      updateIsEnabled(true);
      updateIsTurningOn(false);
      holdRun(null);

      /*
       * Sent as it was asked for, and not held again: if it is refused now,
       * whatever refused it is shown as it is.
       */
      try {
        await attempt.run();
      } catch (err) {
        optionsRef.current.onError(API.getFriendlyMessage(err));
      }
    }, []);

  const dismissHeldRun: () => void = useCallback((): void => {
    // The save is already on its way; the dialog says how it went.
    if (isTurningOnRef.current) {
      return;
    }

    holdRun(null);
    setTurnOnError("");
  }, []);

  return {
    isEnabled,
    setLoadedIsEnabled,
    isSaving,
    setIsEnabled,
    run,
    heldRun,
    isTurningOn,
    turnOnError,
    turnOnAndRun,
    dismissHeldRun,
  };
};

export default useWorkflowEnabled;
