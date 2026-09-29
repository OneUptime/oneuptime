import ColorPicker from "../../../../UI/Components/Forms/Fields/ColorPicker";
import Modal from "../../../../UI/Components/Modal/Modal";
import DROPDOWN_MENU_Z_INDEX from "../../../../UI/Components/Dropdown/DropdownMenuZIndex";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";

/*
 * The ChromePicker popup used to be absolutely positioned inside Modal's
 * scrolling body, so everything below the first strip of the saturation square
 * was clipped away. It is now portalled to document.body and positioned fixed
 * against the field.
 */
describe("ColorPicker popup", () => {
  const originalInnerHeight: number = window.innerHeight;
  const originalInnerWidth: number = window.innerWidth;

  const setViewport: (width: number, height: number) => void = (
    width: number,
    height: number,
  ): void => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: height,
    });
  };

  const makeRect: (
    left: number,
    top: number,
    width: number,
    height: number,
  ) => DOMRect = (
    left: number,
    top: number,
    width: number,
    height: number,
  ): DOMRect => {
    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top,
      toJSON: (): Record<string, never> => {
        return {};
      },
    } as DOMRect;
  };

  const renderInModal: (onClose?: MockFunction) => void = (
    onClose?: MockFunction,
  ): void => {
    render(
      <Modal title="Create Label" onClose={onClose}>
        <ColorPicker
          placeholder="No color"
          dataTestId="color-value"
          onChange={getJestMockFunction()}
        />
      </Modal>,
    );
  };

  const getAnchor: () => HTMLElement = (): HTMLElement => {
    const input: HTMLElement = screen.getByTestId("color-value");
    const anchor: HTMLElement | null | undefined =
      input.parentElement?.parentElement;

    if (!anchor) {
      throw new Error("ColorPicker anchor was not rendered.");
    }

    return anchor;
  };

  const openPickerAt: (rect: DOMRect) => HTMLElement = (
    rect: DOMRect,
  ): HTMLElement => {
    const anchor: HTMLElement = getAnchor();

    jest.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect);
    fireEvent.click(screen.getByTestId("color-value"));

    return screen.getByTestId("color-picker-popup");
  };

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    setViewport(originalInnerWidth, originalInnerHeight);
  });

  test("escapes the modal body scroll container", () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const modalContent: HTMLElement = screen.getByTestId("modal-content");

    expect(modalContent.contains(popup)).toBe(false);
    expect(popup.parentElement).toBe(document.body);
    expect(popup.classList.contains("fixed")).toBe(true);
    expect(popup.style.zIndex).toBe(String(DROPDOWN_MENU_Z_INDEX));
  });

  test("positions the popup below the field", () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));

    expect(popup.style.top).toBe("244px");
    expect(popup.style.bottom).toBe("");
    expect(popup.style.left).toBe("120px");
    expect(popup.style.maxHeight).toBe("320px");
    expect(popup.style.visibility).toBe("visible");
  });

  test("flips the popup above a field near the modal footer", () => {
    setViewport(1000, 600);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 520, 320, 40));

    expect(popup.style.top).toBe("");
    expect(popup.style.bottom).toBe("84px");
    expect(popup.style.visibility).toBe("visible");
  });

  test("clamps the popup inside a narrow viewport", () => {
    setViewport(300, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(260, 200, 30, 40));

    // 300 - 8 (padding) - 225 (ChromePicker width).
    expect(popup.style.left).toBe("67px");
  });

  test("repositions when the modal body scrolls", async () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 400, 320, 40));
    expect(popup.style.top).toBe("444px");

    const anchor: HTMLElement = getAnchor();
    jest
      .spyOn(anchor, "getBoundingClientRect")
      .mockReturnValue(makeRect(120, 260, 320, 40));

    // Does not bubble - only a capture phase listener sees this.
    screen.getByTestId("modal-content").dispatchEvent(new Event("scroll"));

    await waitFor(() => {
      expect(popup.style.top).toBe("304px");
    });
  });

  test("Escape closes the popup, keeps the modal open and restores focus", () => {
    const onClose: MockFunction = getJestMockFunction();
    setViewport(1000, 800);
    renderInModal(onClose);

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const popupInput: HTMLElement = within(popup).getAllByRole("textbox")[0]!;

    popupInput.focus();
    expect(document.activeElement).toBe(popupInput);

    fireEvent.keyDown(popupInput, { key: "Escape" });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(screen.getByTestId("modal")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId("color-value"));
  });

  test("Tab keeps focus inside the portalled popup", () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const popupInputs: Array<HTMLElement> =
      within(popup).getAllByRole("textbox");
    const lastInput: HTMLElement = popupInputs[popupInputs.length - 1]!;

    lastInput.focus();
    fireEvent.keyDown(lastInput, { key: "Tab" });

    // Without the popup's own trap, Modal would pull focus back into itself.
    expect(popup.contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId("color-picker-popup")).toBeTruthy();
  });

  test("clicking outside closes the popup", () => {
    setViewport(1000, 800);
    renderInModal();

    openPickerAt(makeRect(120, 200, 320, 40));

    fireEvent.mouseDown(screen.getByTestId("modal-title"));

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
  });
});
