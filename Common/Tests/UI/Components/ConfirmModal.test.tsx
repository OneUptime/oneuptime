import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ConfirmModal, {
  ComponentProps,
} from "../../../UI/Components/Modal/ConfirmModal";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

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
