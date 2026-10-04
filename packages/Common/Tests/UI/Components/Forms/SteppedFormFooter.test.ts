import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import {
  FORM_NEXT_BUTTON_TEST_ID,
  MODAL_NEXT_BUTTON_TEST_ID,
  NEXT_BUTTON_STYLE,
  NEXT_BUTTON_TEXT,
  SteppedFormFooter,
  SteppedModalFooter,
  getSteppedFormFooter,
  getSteppedModalFooter,
} from "../../../../UI/Components/Forms/Utils/SteppedFormFooter";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { describe, expect, test } from "@jest/globals";

/*
 * "In multi-step form. Please dont have the primary save button on any step
 * except the last. ... Next button should never be primary color as well."
 * - the maintainer, 2026-10-04.
 *
 * The rule, as the shared footer states it: a stepped form shows a plain Next
 * on every step but the last, and its action - its one primary button - on
 * the last step only. A form without steps shows its action.
 */

describe("getSteppedFormFooter", () => {
  test("a form without steps: the action, no Next", () => {
    expect(
      getSteppedFormFooter({ hasSteps: false, isOnLastStep: false }),
    ).toEqual({ showActionButton: true, showNextButton: false });

    expect(
      getSteppedFormFooter({ hasSteps: false, isOnLastStep: true }),
    ).toEqual({ showActionButton: true, showNextButton: false });
  });

  test("a step that is not the last: Next only, never the action", () => {
    expect(
      getSteppedFormFooter({ hasSteps: true, isOnLastStep: false }),
    ).toEqual({ showActionButton: false, showNextButton: true });
  });

  test("the last step: the action only", () => {
    expect(
      getSteppedFormFooter({ hasSteps: true, isOnLastStep: true }),
    ).toEqual({ showActionButton: true, showNextButton: false });
  });

  test("never offers both, and never neither: one way on from every step", () => {
    for (const hasSteps of [true, false]) {
      for (const isOnLastStep of [true, false]) {
        const footer: SteppedFormFooter = getSteppedFormFooter({
          hasSteps,
          isOnLastStep,
        });

        expect(footer.showActionButton).not.toBe(footer.showNextButton);
        // No Back button to offer (b61a6b656d).
        expect(Object.keys(footer).sort()).toEqual([
          "showActionButton",
          "showNextButton",
        ]);
      }
    }
  });

  test("Next reads Next and is drawn plain, never primary", () => {
    expect(NEXT_BUTTON_TEXT).toBe("Next");
    expect(NEXT_BUTTON_STYLE).toBe(ButtonStyleType.NORMAL);
    expect(NEXT_BUTTON_STYLE).not.toBe(ButtonStyleType.PRIMARY);
    expect(MODAL_NEXT_BUTTON_TEST_ID).toBe("modal-footer-next-button");
    expect(FORM_NEXT_BUTTON_TEST_ID).toBe("form-next-button");
  });
});

describe("getSteppedModalFooter", () => {
  interface Handlers {
    onAction: MockFunction;
    onNext: MockFunction;
  }

  const handlers: () => Handlers = (): Handlers => {
    return { onAction: getJestMockFunction(), onNext: getJestMockFunction() };
  };

  test("a step that is not the last: no submit button, a plain Next that walks on", () => {
    const { onAction, onNext }: Handlers = handlers();

    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: false,
      onAction,
      onNext,
    });

    expect(footer.onSubmit).toBeUndefined();
    expect(footer.secondaryButton).toEqual(
      expect.objectContaining({
        title: NEXT_BUTTON_TEXT,
        dataTestId: MODAL_NEXT_BUTTON_TEST_ID,
      }),
    );

    footer.secondaryButton!.onClick();

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  test("the last step: the action as the submit button, and no Next", () => {
    const { onAction, onNext }: Handlers = handlers();

    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: true,
      onAction,
      onNext,
    });

    expect(footer.secondaryButton).toBeUndefined();
    expect(footer.onSubmit).toBe(onAction);

    footer.onSubmit!();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  test("a form without steps: the action, and no Next", () => {
    const { onAction, onNext }: Handlers = handlers();

    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: false,
      isOnLastStep: false,
      onAction,
      onNext,
    });

    expect(footer.onSubmit).toBe(onAction);
    expect(footer.secondaryButton).toBeUndefined();
  });

  test("a step with no way on yet draws no Next, and still no action", () => {
    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: false,
      onAction: getJestMockFunction(),
      onNext: undefined,
    });

    expect(footer.onSubmit).toBeUndefined();
    expect(footer.secondaryButton).toBeUndefined();
  });

  test("a last step with nothing to do it with yet draws no action", () => {
    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: true,
      onAction: undefined,
      onNext: getJestMockFunction(),
    });

    expect(footer.onSubmit).toBeUndefined();
    expect(footer.secondaryButton).toBeUndefined();
  });

  test("a step that names its way on keeps the name, and is a Next all the same", () => {
    const { onAction, onNext }: Handlers = handlers();

    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: false,
      onAction,
      onNext,
      nextButtonText: "Use this template",
      nextButtonDataTestId: "use-template",
    });

    expect(footer.onSubmit).toBeUndefined();
    expect(footer.secondaryButton?.title).toBe("Use this template");
    expect(footer.secondaryButton?.dataTestId).toBe("use-template");

    footer.secondaryButton!.onClick();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test("a Next that waits for something is drawn disabled, and still plain", () => {
    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: false,
      onAction: undefined,
      onNext: getJestMockFunction(),
      nextButtonText: "Validate and preview",
      isNextButtonDisabled: true,
    });

    expect(footer.onSubmit).toBeUndefined();
    expect(footer.secondaryButton?.title).toBe("Validate and preview");
    expect(footer.secondaryButton?.disabled).toBe(true);

    expect(
      getSteppedModalFooter({
        hasSteps: true,
        isOnLastStep: false,
        onAction: undefined,
        onNext: getJestMockFunction(),
      }).secondaryButton?.disabled,
    ).toBeUndefined();
  });

  test("Next calls whatever walks on at the time it is pressed", () => {
    const first: MockFunction = getJestMockFunction();

    const footer: SteppedModalFooter = getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: false,
      onAction: getJestMockFunction(),
      onNext: first,
    });

    footer.secondaryButton!.onClick();
    footer.secondaryButton!.onClick();

    expect(first).toHaveBeenCalledTimes(2);
  });
});
