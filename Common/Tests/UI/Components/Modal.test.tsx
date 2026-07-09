import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ButtonType from "../../../UI/Components/Button/ButtonTypes";
import Modal, { ModalWidth } from "../../../UI/Components/Modal/Modal";
import FloatingPortal from "../../../UI/Components/Floating/FloatingPortal";
import IconPicker from "../../../UI/Components/Forms/Fields/IconPicker";
import { describe, it, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useRef } from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

const FloatingControl: () => ReactElement = (): ReactElement => {
  const anchorRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={anchorRef} type="button" data-testid="floating-anchor">
        Open menu
      </button>
      <FloatingPortal anchorRef={anchorRef} onEscape={() => {}}>
        <button type="button" data-testid="floating-action">
          Floating action
        </button>
      </FloatingPortal>
    </>
  );
};

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

  it("closes the modal when Escape is pressed", () => {
    const onCloseMock: MockFunction = getJestMockFunction();

    render(
      <Modal title="Escape Modal" onClose={onCloseMock}>
        <button type="button">Focusable content</button>
      </Modal>,
    );

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Escape Modal" }), {
      key: "Escape",
    });

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("only closes the top-most nested modal when Escape is pressed", () => {
    const onParentClose: MockFunction = getJestMockFunction();
    const onChildClose: MockFunction = getJestMockFunction();

    render(
      <Modal title="Parent Modal" onClose={onParentClose}>
        <Modal title="Child Modal" onClose={onChildClose}>
          <button type="button">Child action</button>
        </Modal>
      </Modal>,
    );

    const parentDialog: HTMLElement = screen
      .getByText("Parent Modal")
      .closest('[role="dialog"]') as HTMLElement;
    const childDialog: HTMLElement = screen.getByRole("dialog", {
      name: "Child Modal",
    });
    const parentLayer: HTMLElement = parentDialog.closest(
      '[data-testid="modal-layer"]',
    ) as HTMLElement;
    const childLayer: HTMLElement = childDialog.closest(
      '[data-testid="modal-layer"]',
    ) as HTMLElement;

    expect(Number(childLayer.style.zIndex)).toBeGreaterThan(
      Number(parentLayer.style.zIndex),
    );
    expect(parentDialog).toHaveAttribute("aria-hidden", "true");
    expect(parentDialog).toHaveAttribute("inert");
    expect(childDialog).toHaveAttribute("aria-modal", "true");
    expect(within(childDialog).getByText("Child action")).toHaveFocus();

    fireEvent.keyDown(childDialog, {
      key: "Escape",
    });

    expect(onChildClose).toHaveBeenCalledTimes(1);
    expect(onParentClose).not.toHaveBeenCalled();
  });

  it("consumes Escape in a non-dismissible nested modal", () => {
    const onParentClose: MockFunction = getJestMockFunction();
    const onChildSubmit: MockFunction = getJestMockFunction();

    render(
      <Modal title="Parent Modal" onClose={onParentClose}>
        <Modal title="Locked Child Modal" onSubmit={onChildSubmit}>
          <div>Child content</div>
        </Modal>
      </Modal>,
    );

    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Locked Child Modal" }),
      { key: "Escape" },
    );

    expect(onParentClose).not.toHaveBeenCalled();
  });

  it("keeps nested dialog Tab handling inside the child dialog", () => {
    const onParentClose: MockFunction = getJestMockFunction();
    const onChildSubmit: MockFunction = getJestMockFunction();

    render(
      <Modal title="Parent Modal" onClose={onParentClose}>
        <Modal title="Child Modal" onSubmit={onChildSubmit}>
          <input data-testid="child-first-field" aria-label="Child field" />
        </Modal>
      </Modal>,
    );

    const childFirstField: HTMLInputElement =
      screen.getByTestId("child-first-field");
    const childSubmitButton: HTMLButtonElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    childSubmitButton.focus();
    fireEvent.keyDown(childSubmitButton, { key: "Tab" });

    expect(childFirstField).toHaveFocus();
  });

  it("uses unique title and description ids for each dialog", () => {
    render(
      <>
        <Modal title="First Modal" description="First description">
          <div>First content</div>
        </Modal>
        <Modal title="Second Modal" description="Second description">
          <div>Second content</div>
        </Modal>
      </>,
    );

    const firstDialog: HTMLElement = screen
      .getByText("First Modal")
      .closest('[role="dialog"]') as HTMLElement;
    const secondDialog: HTMLElement = screen.getByRole("dialog", {
      name: "Second Modal",
    });
    const firstTitle: HTMLElement = screen.getByText("First Modal");
    const secondTitle: HTMLElement = screen.getByText("Second Modal");
    const firstDescription: HTMLElement = screen.getByText("First description");
    const secondDescription: HTMLElement =
      screen.getByText("Second description");

    expect(firstTitle.id).not.toBe("");
    expect(secondTitle.id).not.toBe("");
    expect(firstDescription.id).not.toBe("");
    expect(secondDescription.id).not.toBe("");
    expect(firstTitle.id).not.toBe(secondTitle.id);
    expect(firstDescription.id).not.toBe(secondDescription.id);
    expect(firstDialog).toHaveAttribute("aria-labelledby", firstTitle.id);
    expect(firstDialog).toHaveAttribute(
      "aria-describedby",
      firstDescription.id,
    );
    expect(secondDialog).toHaveAttribute("aria-labelledby", secondTitle.id);
    expect(secondDialog).toHaveAttribute(
      "aria-describedby",
      secondDescription.id,
    );
  });

  it("moves focus into the modal and restores it when the modal unmounts", async () => {
    const onSubmitMock: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <button data-testid="modal-trigger" type="button">
        Open modal
      </button>,
    );
    const trigger: HTMLButtonElement = screen.getByTestId("modal-trigger");
    trigger.focus();

    rerender(
      <>
        <button data-testid="modal-trigger" type="button">
          Open modal
        </button>
        <Modal title="Focus Modal" onSubmit={onSubmitMock}>
          <input data-testid="first-modal-field" aria-label="First field" />
        </Modal>
      </>,
    );

    expect(screen.getByTestId("first-modal-field")).toHaveFocus();

    rerender(
      <button data-testid="modal-trigger" type="button">
        Open modal
      </button>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-trigger")).toHaveFocus();
    });
  });

  it("keeps owner-linked floating controls inside the modal focus loop", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    render(
      <Modal title="Floating Modal" onSubmit={onSubmitMock}>
        <FloatingControl />
      </Modal>,
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Floating Modal",
    });
    const floatingAction: HTMLButtonElement =
      screen.getByTestId("floating-action");
    const floatingPortal: HTMLElement = floatingAction.closest(
      '[data-floating-portal="true"]',
    ) as HTMLElement;

    expect(floatingPortal.dataset["floatingModalOwner"]).toBe(
      dialog.dataset["modalOwnerId"],
    );

    floatingAction.focus();
    fireEvent.keyDown(floatingAction, { key: "Tab" });

    expect(screen.getByTestId("floating-anchor")).toHaveFocus();
  });

  it("returns focus to a picker trigger when its portal closes", async () => {
    const onModalClose: MockFunction = getJestMockFunction();
    render(
      <Modal title="Picker Modal" onClose={onModalClose}>
        <IconPicker
          placeholder="Choose icon"
          dataTestId="icon-picker-trigger"
          onChange={() => {}}
        />
      </Modal>,
    );

    const trigger: HTMLButtonElement = screen.getByTestId(
      "icon-picker-trigger",
    );
    fireEvent.click(trigger);
    const searchInput: HTMLInputElement =
      screen.getByPlaceholderText("Search icons...");
    await waitFor(() => {
      expect(searchInput).toHaveFocus();
    });

    fireEvent.keyDown(searchInput, { key: "Escape" });

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(
      screen.queryByPlaceholderText("Search icons..."),
    ).not.toBeInTheDocument();
    expect(onModalClose).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    const pickerDialog: HTMLElement = screen.getByRole("dialog", {
      name: "Choose an icon",
    });
    const firstIconOption: HTMLButtonElement = within(
      pickerDialog,
    ).getAllByRole("button")[0] as HTMLButtonElement;
    firstIconOption.focus();
    fireEvent.click(firstIconOption);

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("reactivates and focuses a parent when its nested modal unmounts", async () => {
    const { rerender } = render(
      <Modal title="Parent Modal">
        <>
          <input data-testid="parent-field" aria-label="Parent field" />
          <Modal title="Child Modal">
            <input data-testid="child-field" aria-label="Child field" />
          </Modal>
        </>
      </Modal>,
    );

    expect(screen.getByTestId("child-field")).toHaveFocus();

    rerender(
      <Modal title="Parent Modal">
        <input data-testid="parent-field" aria-label="Parent field" />
      </Modal>,
    );

    await waitFor(() => {
      const parentDialog: HTMLElement = screen.getByRole("dialog", {
        name: "Parent Modal",
      });
      expect(parentDialog).not.toHaveAttribute("inert");
      expect(screen.getByTestId("parent-field")).toHaveFocus();
    });
  });

  it("focuses the remaining dialog when the top same-level dialog unmounts", async () => {
    const { rerender } = render(
      <>
        <Modal title="First Modal">
          <input data-testid="first-field" aria-label="First field" />
        </Modal>
        <Modal title="Second Modal">
          <input data-testid="second-field" aria-label="Second field" />
        </Modal>
      </>,
    );

    expect(screen.getByTestId("second-field")).toHaveFocus();

    rerender(
      <Modal title="First Modal">
        <input data-testid="first-field" aria-label="First field" />
      </Modal>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-field")).toHaveFocus();
    });
  });

  it("restores the external trigger when an entire nested stack unmounts", async () => {
    const { rerender } = render(
      <button data-testid="stack-trigger" type="button">
        Open stack
      </button>,
    );
    const trigger: HTMLButtonElement = screen.getByTestId("stack-trigger");
    trigger.focus();

    rerender(
      <>
        <button data-testid="stack-trigger" type="button">
          Open stack
        </button>
        <Modal title="Parent Modal">
          <Modal title="Child Modal">
            <input aria-label="Child field" />
          </Modal>
        </Modal>
      </>,
    );

    rerender(
      <button data-testid="stack-trigger" type="button">
        Open stack
      </button>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("stack-trigger")).toHaveFocus();
    });
  });

  it("inerts floating controls owned by an underlying modal", () => {
    render(
      <Modal title="Parent Modal">
        <>
          <FloatingControl />
          <Modal title="Child Modal">
            <button type="button">Child action</button>
          </Modal>
        </>
      </Modal>,
    );

    const floatingPortal: HTMLElement = screen
      .getByTestId("floating-action")
      .closest('[data-floating-portal="true"]') as HTMLElement;

    expect(floatingPortal).toHaveAttribute("inert");
    expect(floatingPortal).toHaveAttribute("aria-hidden", "true");
  });

  it("reveals a new form error at the top of the scroll region", () => {
    const { rerender } = render(
      <Modal title="Form Modal">
        <div>Long form</div>
      </Modal>,
    );
    const scrollRegion: HTMLElement = screen.getByTestId("modal-scroll-region");
    scrollRegion.scrollTop = 320;

    rerender(
      <Modal title="Form Modal" error="Unable to save">
        <div>Long form</div>
      </Modal>,
    );

    expect(scrollRegion.scrollTop).toBe(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to save");
  });

  it("contains Tab and Shift+Tab focus within the dialog", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    render(
      <Modal title="Focus Trap Modal" onSubmit={onSubmitMock}>
        <input data-testid="first-modal-field" aria-label="First field" />
      </Modal>,
    );

    const firstField: HTMLInputElement =
      screen.getByTestId("first-modal-field");
    const submitButton: HTMLButtonElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    submitButton.focus();
    fireEvent.keyDown(submitButton, { key: "Tab" });
    expect(firstField).toHaveFocus();

    firstField.focus();
    fireEvent.keyDown(firstField, { key: "Tab", shiftKey: true });
    expect(submitButton).toHaveFocus();
  });

  it("does not render an empty footer when there are no actions", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <Modal title="Read-only Modal">
        <div>Read-only content</div>
      </Modal>,
    );

    expect(screen.queryByTestId("modal-footer")).not.toBeInTheDocument();

    rerender(
      <Modal title="Action Modal" onSubmit={onSubmitMock}>
        <div>Action content</div>
      </Modal>,
    );

    expect(screen.getByTestId("modal-footer")).toBeInTheDocument();
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

    expect(getByTestId("modal")).toHaveClass("md:max-w-lg");
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

    expect(getByTestId("modal")).toHaveClass("md:max-w-3xl");
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
