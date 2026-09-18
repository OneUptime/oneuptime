import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ButtonType from "../../../UI/Components/Button/ButtonTypes";
import Modal, { ModalWidth } from "../../../UI/Components/Modal/Modal";
import { describe, expect, it, test } from "@jest/globals";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, RenderResult } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The panel mounts closed and opens on the next animation frame, so anything
 * asserting the settled look has to let that frame run first.
 */
type FlushEntranceFrameFunction = () => Promise<void>;

const flushEntranceFrame: FlushEntranceFrameFunction =
  async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

/*
 * The backdrop a user actually clicks is the layer the panel is centred in,
 * not the tinted sheet behind it, which is inert.
 */
type GetBackdropLayerFunction = (panel: HTMLElement) => HTMLElement;

const getBackdropLayer: GetBackdropLayerFunction = (
  panel: HTMLElement,
): HTMLElement => {
  return panel.parentElement!;
};

type GetHeaderFunction = (title: HTMLElement) => HTMLElement;

const getHeader: GetHeaderFunction = (title: HTMLElement): HTMLElement => {
  return title.parentElement!.parentElement!;
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

  /*
   * The header carries the title, the description and the close button, and
   * nothing else. A decorative icon beside the title said nothing the title did
   * not already say, so there is no longer anywhere for one to be rendered.
   */
  it("renders no decorative icon in the header", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { queryByTestId, getByTestId } = render(
      <Modal
        title="Test Modal"
        description="Test modal description"
        onSubmit={onSubmitMock}
        onClose={getJestMockFunction()}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("icon")).not.toBeInTheDocument();

    // The rest of the header is untouched.
    expect(getByTestId("modal-title")).toHaveTextContent("Test Modal");
    expect(getByTestId("modal-description")).toHaveTextContent(
      "Test modal description",
    );
    expect(getByTestId("close-button")).toBeInTheDocument();
  });

  it("keeps the title as the first thing inside the header", () => {
    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={getJestMockFunction()}>
        <div>Modal content</div>
      </Modal>,
    );

    const title: HTMLElement = getByTestId("modal-title");
    const header: HTMLElement = title.parentElement!.parentElement!;

    /*
     * With the icon gone the title block is the header's first child. Anything
     * else in that slot would push the title out of line with the body.
     */
    expect(header.firstElementChild).toContainElement(title);
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

  it("fades and lifts the panel in from a closed state", async () => {
    const { getByTestId } = render(
      <Modal title="Entrance Modal">
        <div>Modal content</div>
      </Modal>,
    );

    const panel: HTMLElement = getByTestId("modal");
    const backdrop: HTMLElement = getByTestId("modal-backdrop");

    expect(panel).toHaveClass("opacity-0", "translate-y-6", "sm:scale-95");
    expect(backdrop).toHaveClass("opacity-0");

    await flushEntranceFrame();

    expect(panel).toHaveClass("opacity-100");
    expect(backdrop).toHaveClass("opacity-100");
  });

  /*
   * A `scale-100` left behind after the entrance would make the panel the
   * containing block for `position: fixed`, and a modal opened from inside
   * this one would then be laid out against the panel instead of the viewport.
   */
  it("leaves no transform on the panel once it has settled", async () => {
    const { getByTestId } = render(
      <Modal title="Settled Modal">
        <div>Modal content</div>
      </Modal>,
    );

    await flushEntranceFrame();

    expect(getByTestId("modal").className).not.toMatch(
      /(^|\s)(sm:)?(scale|translate)-/,
    );
  });

  it("closes on a click that both starts and ends on the backdrop", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const { getByTestId } = render(
      <Modal title="Dismissable Modal" onClose={onCloseMock}>
        <div>Modal content</div>
      </Modal>,
    );

    const backdropLayer: HTMLElement = getBackdropLayer(getByTestId("modal"));

    fireEvent.mouseDown(backdropLayer);
    fireEvent.click(backdropLayer);

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  /*
   * Selecting text in the body and releasing past the edge of the panel is a
   * drag, not a dismissal. Closing on it is the fastest way to lose a
   * half-filled form.
   */
  it("stays open when a drag that started inside the panel ends on the backdrop", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const { getByText, getByTestId } = render(
      <Modal title="Drag Modal" onClose={onCloseMock}>
        <div>Modal content</div>
      </Modal>,
    );

    fireEvent.mouseDown(getByText("Modal content"));
    fireEvent.click(getBackdropLayer(getByTestId("modal")));

    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it("stays open on a backdrop click when backdrop dismissal is disabled", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const { getByTestId } = render(
      <Modal
        title="Sticky Modal"
        onClose={onCloseMock}
        disableCloseOnBackdropClick={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const backdropLayer: HTMLElement = getBackdropLayer(getByTestId("modal"));

    fireEvent.mouseDown(backdropLayer);
    fireEvent.click(backdropLayer);

    expect(onCloseMock).not.toHaveBeenCalled();
    // The close button is still the way out.
    fireEvent.click(getByTestId("close-button"));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a backdrop click on a modal that is not the topmost one", () => {
    const onParentCloseMock: MockFunction = getJestMockFunction();
    const onChildCloseMock: MockFunction = getJestMockFunction();

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
                <Modal title="Child Modal" onClose={onChildCloseMock}>
                  <div>Child content</div>
                </Modal>
              )}
            </>
          </Modal>
        );
      };

    const { getAllByTestId, getByRole } = render(<NestedModalFixture />);

    fireEvent.click(getByRole("button", { name: "Open child" }));

    const [parentPanel, childPanel] = getAllByTestId("modal") as [
      HTMLElement,
      HTMLElement,
    ];
    const parentBackdropLayer: HTMLElement = getBackdropLayer(parentPanel);

    fireEvent.mouseDown(parentBackdropLayer);
    fireEvent.click(parentBackdropLayer);

    expect(onParentCloseMock).not.toHaveBeenCalled();
    expect(onChildCloseMock).not.toHaveBeenCalled();

    const childBackdropLayer: HTMLElement = getBackdropLayer(childPanel);

    fireEvent.mouseDown(childBackdropLayer);
    fireEvent.click(childBackdropLayer);

    expect(onChildCloseMock).toHaveBeenCalledTimes(1);
    expect(onParentCloseMock).not.toHaveBeenCalled();
  });

  it("locks page scrolling for as long as any modal is open", () => {
    document.body.style.overflow = "auto";

    const parent: RenderResult = render(
      <Modal title="First Modal">
        <div>Modal content</div>
      </Modal>,
    );

    expect(document.body.style.overflow).toBe("hidden");

    const child: RenderResult = render(
      <Modal title="Second Modal">
        <div>Modal content</div>
      </Modal>,
    );

    child.unmount();

    // The first modal is still up, so scrolling must not come back yet.
    expect(document.body.style.overflow).toBe("hidden");

    parent.unmount();

    expect(document.body.style.overflow).toBe("auto");

    document.body.style.overflow = "";
  });

  it("shows a scroll shadow only on the side that content is hidden", () => {
    const { getByTestId } = render(
      <Modal title="Tall Modal" onSubmit={getJestMockFunction()}>
        <div>Modal content</div>
      </Modal>,
    );

    const content: HTMLElement = getByTestId("modal-content");
    const header: HTMLElement = getHeader(getByTestId("modal-title"));
    const footer: HTMLElement = getByTestId("modal-footer");

    /*
     * jsdom lays nothing out, so the body is given a size that overflows its
     * container by hand.
     */
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(content, "scrollTop", {
      configurable: true,
      value: 0,
    });

    fireEvent.scroll(content);

    expect(header.className).not.toMatch(/shadow-\[/);
    expect(footer.className).toMatch(/shadow-\[0_-6px/);

    Object.defineProperty(content, "scrollTop", {
      configurable: true,
      value: 400,
    });

    fireEvent.scroll(content);

    expect(header.className).toMatch(/shadow-\[0_6px/);
    expect(footer.className).not.toMatch(/shadow-\[/);
  });

  /*
   * The close button used to be positioned over the header, so a title long
   * enough to reach the right edge ran underneath it.
   */
  it("lays the close button out beside the title rather than over it", () => {
    const { getByTestId } = render(
      <Modal
        title="A title long enough to reach the right edge of the header"
        onClose={getJestMockFunction()}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const title: HTMLElement = getByTestId("modal-title");
    const closeButton: HTMLElement = getByTestId("close-button");

    expect(closeButton).not.toHaveClass("absolute");
    expect(closeButton.parentElement).toBe(getHeader(title));
    expect(title.parentElement).not.toHaveClass("pr-9");
  });
});
