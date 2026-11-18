import Button, { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import Modal, {
  pickInitialFocusElement,
} from "../../../UI/Components/Modal/Modal";
import { afterEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * Two things a dialog can ask of its footer, for the question a page asks
 * before its unsaved work is lost (LeaveWithoutSavingQuestion, #7402):
 *
 *   - isInitialFocusOnCloseButton: the focus starts on Cancel (Keep
 *     Editing), though the submit (Save Changes) is not destructive - it
 *     saves what others see, or who is paged, so a stray Enter must not;
 *   - isCloseDisabled: while what the dialog started runs (a save that then
 *     leaves), the way out waits - Cancel and the X are locked and look it,
 *     and Escape and a press outside do nothing.
 *
 * ConfirmModal hands both on, with the leftFooterElement the leave question
 * puts its Discard Changes in.
 */

afterEach(() => {
  cleanup();
});

// The layer the panel is centred in: the backdrop a press lands on.
const backdropOf: (panel: HTMLElement) => HTMLElement = (
  panel: HTMLElement,
): HTMLElement => {
  return panel.parentElement!;
};

const pressOutside: (panel: HTMLElement) => void = (
  panel: HTMLElement,
): void => {
  const backdrop: HTMLElement = backdropOf(panel);

  fireEvent.mouseDown(backdrop);
  fireEvent.mouseUp(backdrop);
  fireEvent.click(backdrop);
};

describe("pickInitialFocusElement with the close button preferred", () => {
  const makeButton: (testId?: string) => HTMLElement = (
    testId?: string,
  ): HTMLElement => {
    const button: HTMLButtonElement = document.createElement("button");

    if (testId) {
      button.setAttribute("data-testid", testId);
    }

    return button;
  };

  const makeFooter: () => {
    footer: HTMLElement;
    leftFooterButton: HTMLElement;
    cancel: HTMLElement;
    submit: HTMLElement;
  } = () => {
    const footer: HTMLElement = document.createElement("div");
    const leftFooterButton: HTMLElement = makeButton();
    const cancel: HTMLElement = makeButton("modal-footer-close-button");
    const submit: HTMLElement = makeButton("modal-footer-submit-button");

    footer.append(leftFooterButton, cancel, submit);

    return { footer, leftFooterButton, cancel, submit };
  };

  it("picks Cancel over a submit that destroys nothing", () => {
    const parts: ReturnType<typeof makeFooter> = makeFooter();

    expect(
      pickInitialFocusElement({
        focusableElements: [parts.leftFooterButton, parts.cancel, parts.submit],
        footer: parts.footer,
        isSubmitDestructive: false,
        isCloseButtonPreferred: true,
      }),
    ).toBe(parts.cancel);
  });

  it("still picks the submit when not asked", () => {
    const parts: ReturnType<typeof makeFooter> = makeFooter();

    expect(
      pickInitialFocusElement({
        focusableElements: [parts.leftFooterButton, parts.cancel, parts.submit],
        footer: parts.footer,
        isSubmitDestructive: false,
      }),
    ).toBe(parts.submit);
  });

  it("falls back to the submit when there is no Cancel", () => {
    const parts: ReturnType<typeof makeFooter> = makeFooter();

    expect(
      pickInitialFocusElement({
        focusableElements: [parts.submit],
        footer: parts.footer,
        isSubmitDestructive: false,
        isCloseButtonPreferred: true,
      }),
    ).toBe(parts.submit);
  });

  it("leaves a field in the body first, as always", () => {
    const parts: ReturnType<typeof makeFooter> = makeFooter();
    const field: HTMLInputElement = document.createElement("input");

    expect(
      pickInitialFocusElement({
        focusableElements: [field, parts.cancel, parts.submit],
        footer: parts.footer,
        isSubmitDestructive: false,
        isCloseButtonPreferred: true,
      }),
    ).toBe(field);
  });
});

describe("a dialog that starts on its close button", () => {
  it("starts on Cancel, though its submit is PRIMARY", () => {
    const { getByTestId } = render(
      <Modal
        title="Leave without saving?"
        onClose={getJestMockFunction()}
        onSubmit={getJestMockFunction()}
        submitButtonText="Save Changes"
        closeButtonText="Keep Editing"
        submitButtonStyleType={ButtonStyleType.PRIMARY}
        isInitialFocusOnCloseButton={true}
      >
        <p>You have unsaved changes.</p>
      </Modal>,
    );

    expect(getByTestId("modal-footer-close-button")).toHaveFocus();
    expect(getByTestId("modal-footer-submit-button")).not.toHaveFocus();
  });

  it("starts the same dialog on its submit when not asked", () => {
    const { getByTestId } = render(
      <Modal
        title="Leave without saving?"
        onClose={getJestMockFunction()}
        onSubmit={getJestMockFunction()}
        submitButtonText="Save Changes"
        closeButtonText="Keep Editing"
        submitButtonStyleType={ButtonStyleType.PRIMARY}
      >
        <p>You have unsaved changes.</p>
      </Modal>,
    );

    expect(getByTestId("modal-footer-submit-button")).toHaveFocus();
  });
});

describe("a dialog whose way out waits", () => {
  const drawLocked: (isCloseDisabled: boolean) => {
    onClose: MockFunction;
    panel: HTMLElement;
    close: HTMLElement;
    headerClose: HTMLElement;
  } = (isCloseDisabled: boolean) => {
    const onClose: MockFunction = getJestMockFunction();
    const { getByTestId, getByRole } = render(
      <Modal
        title="Leave without saving?"
        onClose={onClose}
        onSubmit={getJestMockFunction()}
        submitButtonText="Saving..."
        closeButtonText="Keep Editing"
        isLoading={isCloseDisabled}
        isCloseDisabled={isCloseDisabled}
      >
        <p>You have unsaved changes.</p>
      </Modal>,
    );

    return {
      onClose,
      panel: getByRole("dialog"),
      close: getByTestId("modal-footer-close-button"),
      headerClose: getByTestId("close-button"),
    };
  };

  it("locks Cancel and the X, in the look a locked button has", () => {
    const parts: ReturnType<typeof drawLocked> = drawLocked(true);

    expect(parts.close).toBeDisabled();
    expect(parts.headerClose).toBeDisabled();
    expect(parts.headerClose.className).toContain("cursor-not-allowed");
    expect(parts.headerClose.className).toContain("opacity-50");
    // No hover wash on a control that cannot be pressed.
    expect(parts.headerClose.className).not.toContain("hover:bg-gray-100");

    fireEvent.click(parts.close);
    fireEvent.click(parts.headerClose);

    expect(parts.onClose).not.toHaveBeenCalled();
  });

  it("does nothing on Escape or a press outside", () => {
    const parts: ReturnType<typeof drawLocked> = drawLocked(true);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    pressOutside(parts.panel);

    expect(parts.onClose).not.toHaveBeenCalled();
  });

  it("lets every way out close it while nothing runs", () => {
    const parts: ReturnType<typeof drawLocked> = drawLocked(false);

    expect(parts.close).toBeEnabled();
    expect(parts.headerClose).toBeEnabled();
    expect(parts.headerClose.className).toContain("hover:bg-gray-100");

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(parts.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(parts.headerClose);
    expect(parts.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(parts.close);
    expect(parts.onClose).toHaveBeenCalledTimes(3);
  });
});

describe("ConfirmModal hands them on", () => {
  it("draws its leftFooterElement at the footer's start, starts on Cancel, and locks the way out", () => {
    const onClose: MockFunction = getJestMockFunction();
    const onDiscard: MockFunction = getJestMockFunction();
    const { getByRole, getByTestId } = render(
      <ConfirmModal
        title="Leave without saving?"
        description="You have unsaved changes to this dashboard. If you leave now, they will be lost."
        submitButtonText="Save Changes"
        closeButtonText="Keep Editing"
        onSubmit={getJestMockFunction()}
        onClose={onClose}
        isInitialFocusOnCloseButton={true}
        leftFooterElement={
          <Button
            title="Discard Changes"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            dataTestId="discard"
            onClick={onDiscard}
          />
        }
      />,
    );

    const footer: HTMLElement = getByTestId("modal-footer");
    const discard: HTMLElement = within(footer).getByTestId("discard");

    expect(footer.querySelector("button")).toBe(discard);
    expect(getByTestId("modal-footer-close-button")).toHaveFocus();
    expect(getByRole("dialog")).toHaveAccessibleDescription(
      "You have unsaved changes to this dashboard. If you leave now, they will be lost.",
    );

    fireEvent.click(discard);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks its way out while asked", () => {
    const onClose: MockFunction = getJestMockFunction();
    const { getByTestId } = render(
      <ConfirmModal
        title="Leave without saving?"
        description="You have unsaved changes."
        submitButtonText="Saving..."
        closeButtonText="Keep Editing"
        onSubmit={getJestMockFunction()}
        onClose={onClose}
        isLoading={true}
        isCloseDisabled={true}
      />,
    );

    expect(getByTestId("modal-footer-close-button")).toBeDisabled();
    expect(getByTestId("close-button")).toBeDisabled();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
