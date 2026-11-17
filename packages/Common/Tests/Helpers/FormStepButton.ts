import { within } from "@testing-library/react";

/*
 * The button that opens a step of a form's step list (Forms/Steps/Step.tsx),
 * from the step's row - the `li` a test finds with getAllByRole("listitem").
 *
 * Since #9231 a step that opens is a <button> inside its row, so the keyboard
 * reaches it; the row itself has no click handler any more. In a browser the
 * button fills the whole row, so a person's click anywhere on it lands on the
 * button; a test that dispatches its click on the `li` itself goes to the
 * row only, and nothing opens (#9245). Click this instead.
 *
 * Throws when the step cannot be opened (the step being filled in, or one
 * not reached yet on a form that does not allow skipping ahead), so a test
 * that expects to jump there says why it could not.
 */
export function formStepButton(row: HTMLElement): HTMLElement {
  return within(row).getByRole("button");
}

export default formStepButton;
