import IconPicker from "../../../../UI/Components/Forms/Fields/IconPicker";
import Modal from "../../../../UI/Components/Modal/Modal";
import DROPDOWN_MENU_Z_INDEX from "../../../../UI/Components/Dropdown/DropdownMenuZIndex";
import IconProp from "../../../../Types/Icon/IconProp";
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
 * The icon grid used to be absolutely positioned inside Modal's scrolling body,
 * which is capped at calc(100vh - 3rem), so only the search box and a row or two
 * of icons were reachable. It is now portalled to document.body and positioned
 * fixed against the field.
 */
describe("IconPicker popup", () => {
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

  const renderInModal: (
    onChange?: MockFunction,
    onClose?: MockFunction,
  ) => void = (onChange?: MockFunction, onClose?: MockFunction): void => {
    render(
      <Modal title="Create Incident Role" onClose={onClose}>
        <IconPicker
          placeholder="No icon"
          dataTestId="icon-value"
          onChange={onChange || getJestMockFunction()}
        />
      </Modal>,
    );
  };

  const getAnchor: () => HTMLElement = (): HTMLElement => {
    const input: HTMLElement = screen.getByTestId("icon-value");
    const anchor: HTMLElement | null | undefined =
      input.parentElement?.parentElement;

    if (!anchor) {
      throw new Error("IconPicker anchor was not rendered.");
    }

    return anchor;
  };

  const openPickerAt: (rect: DOMRect) => HTMLElement = (
    rect: DOMRect,
  ): HTMLElement => {
    const anchor: HTMLElement = getAnchor();

    jest.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect);
    fireEvent.click(screen.getByTestId("icon-value"));

    return screen.getByTestId("icon-picker-popup");
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

  test("positions the grid below the field and sizes it to the viewport", () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));

    expect(popup.style.top).toBe("244px");
    expect(popup.style.bottom).toBe("");
    expect(popup.style.left).toBe("120px");
    expect(popup.style.width).toBe("320px");
    expect(popup.style.maxHeight).toBe("400px");
    expect(popup.style.visibility).toBe("visible");
  });

  test("shrinks the grid to the space left below the field", () => {
    setViewport(1000, 500);
    renderInModal();

    // 500 - 140 (field bottom) - 4 (gap) - 8 (viewport padding) = 348px.
    const popup: HTMLElement = openPickerAt(makeRect(120, 100, 320, 40));

    expect(popup.style.top).toBe("144px");
    expect(popup.style.maxHeight).toBe("348px");
  });

  test("flips the grid above a field near the modal footer", () => {
    setViewport(1000, 600);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 520, 320, 40));

    expect(popup.style.top).toBe("");
    expect(popup.style.bottom).toBe("84px");
    expect(popup.style.visibility).toBe("visible");
  });

  test("clamps the grid inside a narrow viewport", () => {
    setViewport(400, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(300, 200, 60, 40));

    // 400 - 8 (padding) - 320 (grid width).
    expect(popup.style.left).toBe("72px");
    expect(popup.style.width).toBe("320px");
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
    renderInModal(undefined, onClose);

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const searchInput: HTMLElement =
      within(popup).getByPlaceholderText("Search icons...");

    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    fireEvent.keyDown(searchInput, { key: "Escape" });

    expect(screen.queryByTestId("icon-picker-popup")).toBeNull();
    expect(screen.getByTestId("modal")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId("icon-value"));
  });

  test("Tab keeps focus inside the portalled popup", () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const searchInput: HTMLElement =
      within(popup).getByPlaceholderText("Search icons...");

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "Tab" });

    // Without the popup's own trap, Modal would pull focus back into itself.
    expect(popup.contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId("icon-picker-popup")).toBeTruthy();
  });

  test("searching filters the portalled grid", () => {
    setViewport(1000, 800);
    renderInModal();

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const searchInput: HTMLElement =
      within(popup).getByPlaceholderText("Search icons...");

    fireEvent.change(searchInput, {
      target: { value: "there-is-no-such-icon" },
    });

    expect(within(popup).getByText("No icons found")).toBeTruthy();
  });

  test("picking an icon closes the popup and restores focus", () => {
    const onChange: MockFunction = getJestMockFunction();
    setViewport(1000, 800);
    renderInModal(onChange);

    const popup: HTMLElement = openPickerAt(makeRect(120, 200, 320, 40));
    const iconCell: HTMLElement | null = popup.querySelector(
      `[title="${IconProp.Alert}"]`,
    );

    expect(iconCell).not.toBeNull();
    fireEvent.click(iconCell!);

    expect(onChange).toHaveBeenLastCalledWith(IconProp.Alert);
    expect(screen.queryByTestId("icon-picker-popup")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("icon-value"));
  });

  test("clicking outside closes the popup", () => {
    setViewport(1000, 800);
    renderInModal();

    openPickerAt(makeRect(120, 200, 320, 40));

    fireEvent.mouseDown(screen.getByTestId("modal-title"));

    expect(screen.queryByTestId("icon-picker-popup")).toBeNull();
  });
});
