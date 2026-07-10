import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ButtonType from "../../../UI/Components/Button/ButtonTypes";
import Modal, { ModalWidth } from "../../../UI/Components/Modal/Modal";
import { describe, expect, it, test } from "@jest/globals";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render } from "@testing-library/react";
import IconProp from "../../../Types/Icon/IconProp";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

describe("Modal", () => {
  test("renders the modal with the title and description", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const { getByTestId, getByText } = render(
      <Modal
        title="Test Modal Title"
        description="Test modal description"
        onSubmit={onSubmit}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("modal-title")).toHaveTextContent("Test Modal Title");
    expect(getByText("Test modal description")).toBeInTheDocument();
    expect(getByText("Modal content")).toBeInTheDocument();
  });

  it("renders an accessible elevated dialog shell", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const { getByTestId } = render(
      <Modal
        title="Accessible Modal"
        description="A concise description"
        onClose={onCloseMock}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const modal: HTMLElement = getByTestId("modal");
    const title: HTMLElement = getByTestId("modal-title");
    const description: HTMLElement = getByTestId("modal-description");
    const closeButton: HTMLElement = getByTestId("close-button");

    expect(modal).toHaveAttribute("role", "dialog");
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAttribute("aria-labelledby", title.id);
    expect(modal).toHaveAttribute("aria-describedby", description.id);
    expect(modal).toHaveClass("rounded-t-2xl", "shadow-2xl");
    expect(getByTestId("modal-backdrop")).toHaveClass(
      "bg-gray-950/45",
      "backdrop-blur-[2px]",
    );
    expect(closeButton).toHaveClass("inline-flex");
    expect(closeButton).not.toHaveClass("md:hidden");
  });

  it("keeps keyboard focus inside the modal", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const onSubmitMock: MockFunction = getJestMockFunction();
    const { getByLabelText, getByTestId } = render(
      <Modal title="Focus Modal" onClose={onCloseMock} onSubmit={onSubmitMock}>
        <input aria-label="Modal input" />
      </Modal>,
    );

    const input: HTMLElement = getByLabelText("Modal input");
    const headerCloseButton: HTMLElement = getByTestId("close-button");
    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(input).toHaveFocus();

    submitButton.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(headerCloseButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(submitButton).toHaveFocus();
  });

  it("closes only the topmost modal and restores focus to its opener", () => {
    const onParentCloseMock: MockFunction = getJestMockFunction();
    const onChildCloseMock: MockFunction = getJestMockFunction();
    const onChildSubmitMock: MockFunction = getJestMockFunction();

    const NestedModalFixture: React.FunctionComponent =
      (): React.ReactElement => {
        const [isChildOpen, setIsChildOpen] = React.useState<boolean>(false);

        return (
          <Modal title="Parent Modal" onClose={onParentCloseMock}>
            <>
              <button
                type="button"
                onClick={() => {
                  setIsChildOpen(true);
                }}
              >
                Open child
              </button>
              {isChildOpen && (
                <Modal
                  title="Child Modal"
                  onSubmit={onChildSubmitMock}
                  onClose={() => {
                    onChildCloseMock();
                    setIsChildOpen(false);
                  }}
                >
                  <div>Child content</div>
                </Modal>
              )}
            </>
          </Modal>
        );
      };

    const { getByRole } = render(<NestedModalFixture />);
    const childOpener: HTMLElement = getByRole("button", {
      name: "Open child",
    });

    fireEvent.click(childOpener);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onChildCloseMock).toHaveBeenCalledTimes(1);
    expect(onParentCloseMock).not.toHaveBeenCalled();
    expect(childOpener).toHaveFocus();
  });

  it("restores focus when a modal contains an auto-focused field", () => {
    const opener: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { getByLabelText, unmount } = render(
      <Modal title="Auto Focus Modal">
        <input aria-label="Auto-focused input" autoFocus />
      </Modal>,
    );

    expect(getByLabelText("Auto-focused input")).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("renders the footer only when it has content", () => {
    const { queryByTestId, rerender } = render(
      <Modal title="No Actions Modal">
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("modal-footer")).not.toBeInTheDocument();

    rerender(
      <Modal
        title="Utility Action Modal"
        leftFooterElement={<button type="button">Utility action</button>}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("modal-footer")).toBeInTheDocument();
  });

  it("closes the modal when the close button is clicked", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const onSubmit: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmit} onClose={onCloseMock}>
        <div>Modal content</div>
      </Modal>,
    );

    const closeButton: HTMLElement = getByTestId("close-button");

    fireEvent.click(closeButton);

    expect(onCloseMock).toHaveBeenCalled();
  });

  it("calls the onSubmit function when the submit button is clicked", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    fireEvent.click(submitButton);

    expect(onSubmitMock).toHaveBeenCalled();
  });

  it("displays the modal with the default width when modalWidth is not set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("modal")).toHaveClass("sm:max-w-lg", "md:max-w-lg");
  });

  it("displays the modal with the correct width when modalWidth is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        modalWidth={ModalWidth.Medium}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("modal")).toHaveClass("sm:max-w-3xl", "md:max-w-3xl");
  });

  it("displays the children passed to the modal", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByText } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByText("Modal content")).toBeInTheDocument();
  });

  it("displays the loader when isBodyLoading is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock} isBodyLoading>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("bar-loader")).toBeInTheDocument();
  });

  it("does not display the loader when isBodyLoading is false", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { queryByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  it("does not display the loader when isBodyLoading is undefined", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { queryByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  it("disables the submit button when isLoading is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
        isLoading={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toBeDisabled();
  });

  it("disables the submit button when disableSubmitButton is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
        disableSubmitButton={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toBeDisabled();
  });

  it("disables the submit button when isBodyLoading is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
        isBodyLoading={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toBeDisabled();
  });

  it("displays the icon when icon is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock} icon={IconProp.SMS}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("icon")).toBeInTheDocument();
  });

  it("displays the submit button with the default style when submitButtonStyleType is not set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toHaveAttribute("type", "button");
  });

  it("displays the submit button with the correct style when submitButtonStyleType is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonType={ButtonType.Reset}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toHaveAttribute("type", "reset");
  });

  it("displays the submit button with the default style when submitButtonStyleType is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonStyleType={ButtonStyleType.DANGER}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toHaveClass("bg-red-600");
  });

  it("displays the right element when rightElement is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        rightElement={<div>Right element</div>}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("right-element")).toBeInTheDocument();
  });
});
