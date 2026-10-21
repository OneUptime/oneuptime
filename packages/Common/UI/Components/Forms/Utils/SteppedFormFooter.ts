import { ButtonStyleType } from "../../Button/Button";
import type { ModalSecondaryButton } from "../../Modal/Modal";

/*
 * A stepped form's footer: a plain Next on every step but the last, and the
 * form's action - its one primary button - on the last step only.
 *
 * "In multi-step form. Please dont have the primary save button on any step
 * except the last. For example, do not show Declare Incident on the first
 * step, it should always be on the last step. Next button should never be
 * primary color as well. Can you please do this for all multistep forms in
 * the project?" - the maintainer, 2026-10-04.
 *
 * That replaced two earlier rules on purpose, so neither should come back:
 * create wizards that offered their action as soon as every step left was
 * optional (Forms/Utils/FinishFromAnyStep, #4282), and stepped edit dialogs
 * that saved from any step (#4192). With either, the primary button said
 * "done" on a step that was not the end of the form, and a form that walked
 * with a primary Next gave every step the colour that should mean "this
 * commits". Now the primary colour appears once, on the button that does.
 *
 * What stays from those rules:
 * - The action checks every step, not only the one on screen
 *   (BasicFormHandle.submitAllSteps): a step with a problem is opened, with
 *   its error showing. An edit form's step list still opens any step, so
 *   reaching the action from the first step is one click on the last one.
 * - Next never submits (BasicFormHandle.goToNextStep), and pressing Enter in
 *   a field on a step that is not the last walks on too.
 * - There is still no Back button on a stepped form (b61a6b656d).
 */

export const NEXT_BUTTON_TEXT: string = "Next";

/*
 * Next walks on and commits nothing, so it is never primary: it is drawn
 * plain, like Cancel, on every step it shows on.
 */
export const NEXT_BUTTON_STYLE: ButtonStyleType = ButtonStyleType.NORMAL;

// Next in a dialog's footer (Modal's secondaryButton).
export const MODAL_NEXT_BUTTON_TEST_ID: string = "modal-footer-next-button";

// Next under a form that draws its own buttons (a page's form).
export const FORM_NEXT_BUTTON_TEST_ID: string = "form-next-button";

/*
 * What a stepped form's footer offers on the step on screen.
 */
export interface SteppedFormFooter {
  /*
   * The form's action ("Declare Incident", "Save Changes"), its one primary
   * button: on the last step, and on a form without steps.
   */
  showActionButton: boolean;
  // A plain Next: on every step but the last.
  showNextButton: boolean;
}

export type GetSteppedFormFooterFunction = (data: {
  hasSteps: boolean;
  isOnLastStep: boolean;
}) => SteppedFormFooter;

export const getSteppedFormFooter: GetSteppedFormFooterFunction = (data: {
  hasSteps: boolean;
  isOnLastStep: boolean;
}): SteppedFormFooter => {
  if (!data.hasSteps || data.isOnLastStep) {
    return {
      showActionButton: true,
      showNextButton: false,
    };
  }

  return {
    showActionButton: false,
    showNextButton: true,
  };
};

/*
 * The footer of a dialog (Modal) that hosts a stepped form, as the props the
 * dialog takes: its submit button is the form's action and is drawn on the
 * last step only; on the other steps the footer has a plain Next instead.
 * Every dialog that draws the buttons of a stepped form - ModelFormModal,
 * BasicFormModal, and the few hosts that draw their own - builds its footer
 * here, so the rule holds in one place (PrimaryActionLastStepGuard).
 */
export interface SteppedModalFooter {
  // Modal's onSubmit: undefined leaves the submit button out.
  onSubmit: (() => void) | undefined;
  // Modal's secondaryButton: the plain Next, or nothing.
  secondaryButton: ModalSecondaryButton | undefined;
}

export type GetSteppedModalFooterFunction = (data: {
  hasSteps: boolean;
  isOnLastStep: boolean;
  /*
   * The form's action, offered on the last step: BasicFormHandle's
   * submitAllSteps, which checks every step and opens the first one with a
   * problem. Undefined while there is nothing to do it with yet.
   */
  onAction: (() => void) | undefined;
  /*
   * Walks on from the step on screen: BasicFormHandle's goToNextStep, which
   * checks the step and never submits. Undefined while the step has no way
   * on yet (nothing picked to go on with).
   */
  onNext: (() => void) | undefined;
  /*
   * What Next says, when the step names its way on - "Use this template".
   * It is a Next all the same, and drawn as plainly.
   */
  nextButtonText?: string | undefined;
  nextButtonDataTestId?: string | undefined;
  // Next waits for something on the step (a file to read, say).
  isNextButtonDisabled?: boolean | undefined;
}) => SteppedModalFooter;

export const getSteppedModalFooter: GetSteppedModalFooterFunction = (data: {
  hasSteps: boolean;
  isOnLastStep: boolean;
  onAction: (() => void) | undefined;
  onNext: (() => void) | undefined;
  nextButtonText?: string | undefined;
  nextButtonDataTestId?: string | undefined;
  isNextButtonDisabled?: boolean | undefined;
}): SteppedModalFooter => {
  const footer: SteppedFormFooter = getSteppedFormFooter({
    hasSteps: data.hasSteps,
    isOnLastStep: data.isOnLastStep,
  });

  const onNext: (() => void) | undefined = data.onNext;

  return {
    onSubmit: footer.showActionButton ? data.onAction : undefined,
    secondaryButton:
      footer.showNextButton && onNext
        ? {
            title: data.nextButtonText || NEXT_BUTTON_TEXT,
            dataTestId: data.nextButtonDataTestId || MODAL_NEXT_BUTTON_TEST_ID,
            disabled: data.isNextButtonDisabled || undefined,
            onClick: () => {
              onNext();
            },
          }
        : undefined,
  };
};
