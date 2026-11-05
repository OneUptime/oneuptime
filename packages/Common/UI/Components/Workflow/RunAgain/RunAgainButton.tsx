/*
 * Run again, as a button: it asks first, because every step of the new run runs
 * for real, and a refusal is said in the dialog so nobody has to start again.
 * What pressing it does is the caller's (RunAgainSource), as a page may follow
 * the new run in its own way.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import API from "../../../Utils/API/API";
import { translationKey } from "../../../Utils/TranslateTemplate";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import ConfirmModal from "../../Modal/ConfirmModal";
import { getLockedReason, getWorkflowRunGate } from "../WorkflowRunGate";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const RunAgainCopy: {
  readonly runAgain: string;
  readonly confirmTitle: string;
  readonly confirmDescription: string;
  readonly lastRunTitle: string;
  readonly lastRunDescription: string;
  readonly newRunDescription: string;
} = {
  runAgain: translationKey("Run again"),
  confirmTitle: translationKey("Run this workflow again?"),
  confirmDescription: translationKey(
    "A new run starts from the trigger, with the same values and the workflow as it is now. Every step runs for real: what it sends or deletes happens.",
  ),
  lastRunTitle: translationKey("Run with the last run's values"),
  lastRunDescription: translationKey(
    "Starts a new run with what the run of {{date}} started with.",
  ),
  newRunDescription: translationKey("This is the run you just started."),
};

export interface ComponentProps {
  // Starts the new run. A rejection is said in the dialog, which stays open.
  send: () => Promise<void>;
}

const RunAgainButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * Read on every render, as the Builder's Run Workflow is: until the permission
   * snapshot has landed the button works and the server decides.
   */
  const lockedReason: string | undefined =
    getLockedReason(getWorkflowRunGate());

  return (
    <>
      <Button
        title={RunAgainCopy.runAgain}
        icon={IconProp.Refresh}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        disabled={Boolean(lockedReason)}
        tooltip={lockedReason}
        dataTestId="workflow-run-again"
        onClick={() => {
          setError("");
          setIsConfirming(true);
        }}
      />

      {isConfirming && (
        <ConfirmModal
          title={RunAgainCopy.confirmTitle}
          description={RunAgainCopy.confirmDescription}
          submitButtonText={RunAgainCopy.runAgain}
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSending}
          error={error || undefined}
          onClose={() => {
            setIsConfirming(false);
          }}
          onSubmit={() => {
            setError("");
            setIsSending(true);

            props
              .send()
              .then(() => {
                setIsConfirming(false);
              })
              .catch((err: unknown) => {
                setError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsSending(false);
              });
          }}
        />
      )}
    </>
  );
};

export default RunAgainButton;
