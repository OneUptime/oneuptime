import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The question a page asks before its unsaved work is lost: someone opened
 * another page (the side menu, a crumb, any link), or pressed the browser's
 * Back or Forward, while the page holds the leave guard
 * (Common/UI/Utils/UseLeaveGuard).
 *
 * One voice wherever it is asked - a dashboard being edited, a runbook's
 * steps, a form's questions: "Leave without saving?", one sentence naming
 * what is lost, then Keep Editing, which stays with the work as it is, and
 * Discard Changes, which goes where the reader was going. Discard Changes
 * is the red one, so the focus starts on Keep Editing, the answer that
 * loses nothing.
 *
 * The page draws it last, so it opens above any dialog the page has open.
 * It draws nothing until someone tries to leave.
 */
export interface ComponentProps {
  prompt: LeavePrompt;
  /*
   * What is lost, in one whole sentence the Dashboard's locales word:
   * "You have unsaved changes to <what>. If you leave now, they will be
   * lost."
   */
  description: string;
}

const LeaveWithoutSavingQuestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.prompt.isAsking) {
    return <></>;
  }

  return (
    <ConfirmModal
      title={"Leave without saving?"}
      description={props.description}
      submitButtonType={ButtonStyleType.DANGER}
      submitButtonText={"Discard Changes"}
      closeButtonText={"Keep Editing"}
      onSubmit={props.prompt.leave}
      onClose={props.prompt.stay}
    />
  );
};

export default LeaveWithoutSavingQuestion;
