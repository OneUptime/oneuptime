import { translationKey } from "Common/Types/Translator";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import Toast, { CHANGES_SAVED } from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  LeavePrompt,
  SaveBeforeLeavingFunction,
} from "Common/UI/Utils/UseLeaveGuard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The question a page asks before its unsaved work is lost: someone opened
 * another page (the side menu, a crumb, any link), or pressed the browser's
 * Back or Forward, while the page holds the leave guard
 * (Common/UI/Utils/UseLeaveGuard).
 *
 * One voice wherever it is asked - a dashboard being edited, a schedule's
 * layers, a runbook's steps, a form's questions, a person's paging steps:
 * "Leave without saving?", one sentence naming what is lost, and three
 * answers.
 *
 *   - Save Changes, the primary one: the page's own save, then on to where
 *     the reader was going - only once the save worked (issue #7402). It
 *     used to take four steps: Keep Editing, the page's Save, waiting for
 *     it, and the link again. While it saves, every answer waits and it
 *     says "Saving..."; a save that is refused keeps the reader on the
 *     page, still asked, says why at the top of the question, and loses
 *     nothing. Saved, a toast says so where the reader arrives.
 *   - Keep Editing stays with the work as it is. The focus starts there:
 *     a stray Enter changes nothing - Save Changes saves a board everyone
 *     in the project opens, or the layers that decide who is paged.
 *   - Discard Changes goes where the reader was going and loses the work:
 *     outlined in red, at the footer's start, apart from the other two.
 *
 * A page that cannot save from here leaves out onSaveChanges, and is asked
 * with the two answers it always had: Keep Editing, and Discard Changes in
 * red.
 *
 * The page draws it last, so it opens above any dialog the page has open.
 * It draws nothing until someone tries to leave.
 */

// What failed, said before why when nobody explained the failure (ErrorExplanation).
export const LEAVE_QUESTION_SAVE_FAILED: string = translationKey(
  "Your changes were not saved.",
);

export const LEAVE_QUESTION_DISCARD_TEST_ID: string = "leave-question-discard";

export interface ComponentProps {
  prompt: LeavePrompt;
  /*
   * What is lost, in one whole sentence the Dashboard's locales word:
   * "You have unsaved changes to <what>. If you leave now, they will be
   * lost."
   */
  description: string;
  /*
   * The page's own save, as its Save button runs it, which rejects with why
   * it did not save (a refusal, a conflict, a field to fix). Given, the
   * question offers Save Changes.
   */
  onSaveChanges?: SaveBeforeLeavingFunction | undefined;
}

const LeaveWithoutSavingQuestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // Why the last Save Changes did not save, from API.getFriendlyMessage.
  const [saveError, setSaveError] = useState<string>("");

  // Asked again, the question starts afresh: the last refusal was about then.
  useEffect(() => {
    if (!props.prompt.isAsking) {
      setSaveError("");
    }
  }, [props.prompt.isAsking]);

  if (!props.prompt.isAsking) {
    return <></>;
  }

  const onSaveChanges: SaveBeforeLeavingFunction | undefined =
    props.onSaveChanges;

  if (!onSaveChanges) {
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
  }

  const saveChanges: () => Promise<void> = async (): Promise<void> => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await props.prompt.saveAndLeave(onSaveChanges);
    } catch (err) {
      // Still asked, nothing lost: why, and the answers again.
      setSaveError(API.getFriendlyMessage(err));
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    // The page that said so is gone: the toast says it where the reader arrives.
    Toast.success(translator.translateText(CHANGES_SAVED) || CHANGES_SAVED);
  };

  return (
    <ConfirmModal
      title={"Leave without saving?"}
      description={props.description}
      submitButtonType={ButtonStyleType.PRIMARY}
      submitButtonText={isSaving ? "Saving..." : "Save Changes"}
      closeButtonText={"Keep Editing"}
      onSubmit={() => {
        void saveChanges();
      }}
      onClose={props.prompt.stay}
      isLoading={isSaving}
      isCloseDisabled={isSaving}
      isInitialFocusOnCloseButton={true}
      error={saveError || undefined}
      errorWhatFailed={translator.translateText(LEAVE_QUESTION_SAVE_FAILED)}
      leftFooterElement={
        <Button
          title="Discard Changes"
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          disabled={isSaving}
          dataTestId={LEAVE_QUESTION_DISCARD_TEST_ID}
          onClick={props.prompt.leave}
        />
      }
    />
  );
};

export default LeaveWithoutSavingQuestion;
