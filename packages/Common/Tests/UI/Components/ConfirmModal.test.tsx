import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ConfirmModal, {
  ComponentProps,
  getDefaultConfirmSubmitButtonType,
} from "../../../UI/Components/Modal/ConfirmModal";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations. Without this import the jest-dom matchers below have no types
 * of their own, and the suite only compiled when it happened to share a
 * program with a file that did import them.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

describe("ConfirmModal", () => {
  const mockProps: ComponentProps = {
    title: "Confirmation Title",
    description: "Are you sure?",
    onClose: jest.fn(),
    submitButtonText: "Confirm",
    onSubmit: jest.fn(),
    submitButtonType: ButtonStyleType.PRIMARY,
    closeButtonType: ButtonStyleType.NORMAL,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly", () => {
    render(<ConfirmModal {...mockProps} />);

    const title: string | null = screen.getByTestId("modal-title")?.textContent;
    expect(title).toBe("Confirmation Title");

    const description: string | null = screen.getByTestId(
      "confirm-modal-description",
    )?.textContent;
    expect(description).toBe("Are you sure?");

    const submitButtonText: string | null = screen.getByTestId(
      "modal-footer-submit-button",
    )?.textContent;
    expect(submitButtonText).toBe("Confirm");

    const submitButton: DOMTokenList = screen.getByTestId(
      "modal-footer-submit-button",
    )?.classList;
    expect(submitButton.contains("bg-indigo-600")).toBe(true);

    const closeButton: DOMTokenList = screen.getByTestId(
      "modal-footer-close-button",
    )?.classList;
    expect(closeButton.contains("bg-white")).toBe(true);
  });

  it("closes the comfirm modal when the close button is clicked", () => {
    render(<ConfirmModal {...mockProps} />);

    const closeButton: HTMLElement = screen.getByTestId("close-button");

    fireEvent.click(closeButton);

    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it("calls the onSubmit function when the submit button is clicked", () => {
    render(<ConfirmModal {...mockProps} />);

    const submitButton: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    fireEvent.click(submitButton);

    expect(mockProps.onSubmit).toHaveBeenCalled();
  });

  it("disables the submit button when isLoading is true", () => {
    render(<ConfirmModal {...mockProps} isLoading={true} />);

    const submitButton: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    expect(submitButton).toBeDisabled();
  });

  it("should have a title content displayed in document when there is error", () => {
    render(<ConfirmModal {...mockProps} error="This is a error message." />);

    const errorMessage: HTMLElement = screen.getByText(
      "This is a error message.".trim(),
    );
    expect(errorMessage.textContent?.trim()).toBe("This is a error message.");
  });
});

/*
 * A dialog has exactly one primary button, and it is the thing the dialog is
 * for. A confirmation's submit is that thing and is PRIMARY by default; a
 * notice - a ConfirmModal with no way to cancel - only has a button that
 * closes it, which is no more an action than Cancel is, so it is plain.
 */
describe("ConfirmModal button styles", () => {
  type FooterButtonsFunction = () => {
    submit: HTMLElement;
    cancel: HTMLElement | null;
  };

  const footerButtons: FooterButtonsFunction = (): {
    submit: HTMLElement;
    cancel: HTMLElement | null;
  } => {
    return {
      submit: screen.getByTestId("modal-footer-submit-button"),
      cancel: screen.queryByTestId("modal-footer-close-button"),
    };
  };

  it("draws a confirmation's action PRIMARY and its Cancel plain when no style is given", () => {
    render(
      <ConfirmModal
        title="Run this step now?"
        description="This runs the step for real."
        submitButtonText="Run this step"
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const { submit, cancel } = footerButtons();

    expect(submit).toHaveClass("bg-indigo-600");
    expect(cancel).toHaveClass("bg-white");
    expect(cancel).not.toHaveClass("bg-indigo-600");
  });

  it("draws a notice's only button plain when no style is given", () => {
    render(
      <ConfirmModal
        title="Code sent"
        description="Check your inbox."
        submitButtonText="Close"
        onSubmit={jest.fn()}
      />,
    );

    const { submit, cancel } = footerButtons();

    expect(cancel).toBeNull();
    expect(submit).toHaveClass("bg-white");
    expect(submit).not.toHaveClass("bg-indigo-600");
  });

  /*
   * ButtonStyleType.PRIMARY is the enum's first member, 0. ConfirmModal used
   * to test submitButtonType for truthiness, which read an explicit PRIMARY as
   * "not given" - harmless while the default was PRIMARY too, wrong now that a
   * notice defaults to NORMAL.
   */
  it("honours an explicit PRIMARY (enum value 0) on a dialog with no Cancel", () => {
    render(
      <ConfirmModal
        title="Something went wrong"
        description="Reload to try again."
        submitButtonText="Reload Page"
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={jest.fn()}
      />,
    );

    expect(footerButtons().submit).toHaveClass("bg-indigo-600");
  });

  it("honours an explicit DANGER and an explicit NORMAL", () => {
    const { unmount } = render(
      <ConfirmModal
        title="Delete step"
        description="This cannot be undone."
        submitButtonText="Delete"
        submitButtonType={ButtonStyleType.DANGER}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(footerButtons().submit).toHaveClass("bg-red-600");
    unmount();

    render(
      <ConfirmModal
        title="Error"
        description="It failed."
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(footerButtons().submit).toHaveClass("bg-white");
  });

  it("never draws more than one filled button in the footer", () => {
    render(
      <ConfirmModal
        title="Archive this?"
        description="It moves out of the list."
        submitButtonText="Archive"
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const filled: Array<HTMLElement> = Array.from(
      screen
        .getByTestId("modal-footer")
        .querySelectorAll<HTMLElement>("button"),
    ).filter((button: HTMLElement) => {
      return /\bbg-(indigo|red|green|yellow)-600\b/.test(button.className);
    });

    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent("Archive");
  });

  it("works out the default from whether there is a way to cancel", () => {
    expect(getDefaultConfirmSubmitButtonType(true)).toBe(
      ButtonStyleType.PRIMARY,
    );
    expect(getDefaultConfirmSubmitButtonType(false)).toBe(
      ButtonStyleType.NORMAL,
    );
  });
});

describe("ConfirmModal initial focus", () => {
  it("opens with focus on the action, so the ring is never on Cancel", () => {
    render(
      <ConfirmModal
        title="Run this step now?"
        description="This runs the step for real."
        submitButtonText="Run this step"
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();
  });

  it("opens a destructive confirmation with focus on Cancel", () => {
    render(
      <ConfirmModal
        title="Delete step"
        description="This cannot be undone."
        submitButtonText="Delete"
        submitButtonType={ButtonStyleType.DANGER}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId("modal-footer-close-button")).toHaveFocus();
  });

  it("presses the focused action with the keyboard", () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <ConfirmModal
        title="Run this step now?"
        description="This runs the step for real."
        submitButtonText="Run this step"
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    const focused: Element | null = document.activeElement;

    expect(focused).toBe(screen.getByTestId("modal-footer-submit-button"));
    fireEvent.click(focused as HTMLElement);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
