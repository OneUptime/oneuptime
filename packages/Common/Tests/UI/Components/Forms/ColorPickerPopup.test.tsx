import ColorPicker from "../../../../UI/Components/Forms/Fields/ColorPicker";
import Modal from "../../../../UI/Components/Modal/Modal";
import DROPDOWN_MENU_Z_INDEX from "../../../../UI/Components/Dropdown/DropdownMenuZIndex";
import { ANCHORED_POPUP_BOUNDARY_ATTRIBUTE } from "../../../../UI/Types/UseAnchoredFieldPopup";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import {
  getColorField,
  getSwatch,
  getTrigger,
} from "../ColorPicker/ColorPickerDriver";
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";

/*
 * Where the compact color field's popover opens, inside a real Modal.
 *
 * The report's picture: the picker at the foot of the Create Label dialog
 * opened downwards - the window had room below - across the dialog's Cancel
 * and Create Label buttons and out past its edge. The popover is portalled
 * out of the dialog body (which would clip it) and positioned fixed; it now
 * also stays inside that body: it opens on the side its content fits, is
 * narrowed and moved to fit across, and closes when the body scrolls its
 * field away. The arithmetic is pinned in AnchoredFieldPopupBoundary.test;
 * this is the same rules reached through the field, the hook and the Modal.
 */

const VIEWPORT: { width: number; height: number } = {
  width: 1280,
  height: 800,
};

// The dialog body: 448px wide, y=120 to y=620.
const BODY: { left: number; top: number; width: number; height: number } = {
  left: 416,
  top: 120,
  width: 448,
  height: 500,
};

let popupContentHeight: number = 250;
let panelContentHeight: number = 460;

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

/*
 * jsdom lays nothing out, so the popover's content has no height. Give the
 * popover the height its swatches take, and more once Custom color is open.
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.getAttribute("data-testid") !== "color-picker-popup") {
        return 0;
      }

      return this.querySelector('[data-testid="color-picker-custom-panel"]')
        ? panelContentHeight
        : popupContentHeight;
    },
  });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
});

interface Harness {
  onClose: MockFunction;
  onChange: MockFunction;
  field: HTMLElement;
}

const renderInModal: (options?: {
  body?: DOMRect;
  anchor?: DOMRect;
}) => Harness = (
  options: { body?: DOMRect; anchor?: DOMRect } = {},
): Harness => {
  const onClose: MockFunction = getJestMockFunction();
  const onChange: MockFunction = getJestMockFunction();

  render(
    <Modal title="Create Custom Field" onClose={onClose}>
      <ColorPicker
        layout="compact"
        dataTestId="option-color"
        placeholder="No color"
        value="#ef4444"
        onChange={onChange}
      />
    </Modal>,
  );

  const field: HTMLElement = getColorField("option-color");

  jest
    .spyOn(screen.getByTestId("modal-content"), "getBoundingClientRect")
    .mockReturnValue(
      options.body ||
        makeRect(BODY.left, BODY.top, BODY.width, BODY.height),
    );

  if (options.anchor) {
    setAnchorRect(field, options.anchor);
  }

  return { onClose, onChange, field };
};

// The element the popover is placed against: the trigger's wrapper.
const setAnchorRect: (field: HTMLElement, rect: DOMRect) => void = (
  field: HTMLElement,
  rect: DOMRect,
): void => {
  jest
    .spyOn(getTrigger(field).parentElement!, "getBoundingClientRect")
    .mockReturnValue(rect);
};

const open: (field: HTMLElement) => HTMLElement = (
  field: HTMLElement,
): HTMLElement => {
  act(() => {
    fireEvent.click(getTrigger(field));
  });

  return screen.getByTestId("color-picker-popup");
};

describe("the compact color field's popover in a dialog", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    setViewport(originalInnerWidth, originalInnerHeight);
    popupContentHeight = 250;
    panelContentHeight = 460;
  });

  test("the dialog body is the boundary popovers stay inside", () => {
    renderInModal();

    expect(screen.getByTestId("modal-content")).toHaveAttribute(
      ANCHORED_POPUP_BOUNDARY_ATTRIBUTE,
      "true",
    );
  });

  test("escapes the dialog body's scroll container, above the dialog", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({ anchor: makeRect(440, 160, 400, 40) });

    const popup: HTMLElement = open(field);

    expect(screen.getByTestId("modal-content").contains(popup)).toBe(false);
    expect(popup.parentElement).toBe(document.body);
    expect(popup.classList.contains("fixed")).toBe(true);
    expect(popup.style.zIndex).toBe(String(DROPDOWN_MENU_Z_INDEX));
    expect(popup.style.visibility).toBe("visible");
  });

  test("near the top of the body it opens under its field and ends inside the body", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({ anchor: makeRect(440, 160, 400, 40) });

    const popup: HTMLElement = open(field);

    expect(popup.style.top).toBe("204px");
    expect(popup.style.bottom).toBe("");
    expect(popup.style.left).toBe("440px");
    expect(popup.style.width).toBe("232px");
    // To the body's bottom less the gap: 620 - 4 - 200 - 4.
    expect(popup.style.maxHeight).toBe("412px");
  });

  test("REGRESSION: at the foot of the body it opens upwards, over the fields, never over the buttons", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({ anchor: makeRect(440, 550, 400, 40) });

    const popup: HTMLElement = open(field);

    // The window had 198px below the field, and the old popup took them.
    expect(popup.style.top).toBe("");
    expect(popup.style.bottom).toBe(`${VIEWPORT.height - 550 + 4}px`);
    // Up to the body's top: 550 - 4 - 124.
    expect(popup.style.maxHeight).toBe("422px");
  });

  test("is placed again when Custom color opens and it grows", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    popupContentHeight = 200;
    panelContentHeight = 400;
    /*
     * 212px below the field (616 - 400 - 4) and 232 above it (360 - 4 -
     * 124): the swatches fit below; grown, it fits neither side and takes
     * the larger, above.
     */
    const { field } = renderInModal({ anchor: makeRect(440, 360, 400, 40) });

    const popup: HTMLElement = open(field);

    expect(popup.style.top).toBe("404px");

    act(() => {
      fireEvent.click(within(popup).getByTestId("color-picker-custom"), {
        detail: 1,
      });
    });

    expect(popup.style.top).toBe("");
    expect(popup.style.bottom).toBe(`${VIEWPORT.height - 360 + 4}px`);
    expect(popup.style.maxHeight).toBe("232px");
  });

  test("a dialog too short for it gives way to the window", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({
      body: makeRect(BODY.left, 500, BODY.width, 120),
      anchor: makeRect(440, 540, 400, 40),
    });

    const popup: HTMLElement = open(field);

    // The window above the field: all 250px of it fit.
    expect(popup.style.bottom).toBe(`${VIEWPORT.height - 540 + 4}px`);
    expect(popup.style.maxHeight).toBe("480px");
  });

  test("a field at the body's right edge has its popover moved left, inside the body", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({ anchor: makeRect(800, 200, 60, 40) });

    const popup: HTMLElement = open(field);

    // The body's right edge less the gap, less the popover's width.
    expect(popup.style.left).toBe(`${BODY.left + BODY.width - 4 - 232}px`);
  });

  test("on a phone it fits the screen", () => {
    setViewport(360, 740);
    const { field } = renderInModal({
      body: makeRect(0, 80, 360, 560),
      anchor: makeRect(200, 300, 140, 40),
    });

    const popup: HTMLElement = open(field);
    const left: number = parseFloat(popup.style.left);
    const width: number = parseFloat(popup.style.width);

    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + width).toBeLessThanOrEqual(360 - 8);
  });

  test("follows its field when the body scrolls (a scroll that does not bubble)", async () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({ anchor: makeRect(440, 300, 400, 40) });

    const popup: HTMLElement = open(field);

    expect(popup.style.top).toBe("344px");

    setAnchorRect(field, makeRect(440, 200, 400, 40));
    screen.getByTestId("modal-content").dispatchEvent(new Event("scroll"));

    await waitFor(() => {
      expect(popup.style.top).toBe("244px");
    });
  });

  test("closes when the body scrolls its field out of sight", async () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field, onClose } = renderInModal({
      anchor: makeRect(440, 300, 400, 40),
    });

    open(field);

    // Scrolled up past the body's top edge.
    setAnchorRect(field, makeRect(440, 40, 400, 40));
    screen.getByTestId("modal-content").dispatchEvent(new Event("scroll"));

    await waitFor(() => {
      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    // The dialog stays.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test("Escape closes the popover, keeps the dialog open and returns focus to the field", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field, onClose } = renderInModal({
      anchor: makeRect(440, 300, 400, 40),
    });

    const popup: HTMLElement = open(field);

    act(() => {
      fireEvent.keyDown(getSwatch(popup, "Red"), { key: "Escape" });
    });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(getTrigger(field));
  });

  test("a press elsewhere in the dialog closes the popover, not the dialog", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field, onClose } = renderInModal({
      anchor: makeRect(440, 300, 400, 40),
    });

    open(field);

    act(() => {
      fireEvent.mouseDown(screen.getByTestId("modal-title"));
    });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Tab keeps focus inside the portalled popover", () => {
    setViewport(VIEWPORT.width, VIEWPORT.height);
    const { field } = renderInModal({ anchor: makeRect(440, 300, 400, 40) });

    const popup: HTMLElement = open(field);
    const custom: HTMLElement = within(popup).getByTestId("color-picker-custom");

    custom.focus();

    act(() => {
      fireEvent.keyDown(custom, { key: "Tab" });
    });

    // Without the popover's own trap, Modal would pull focus back into itself.
    expect(popup.contains(document.activeElement)).toBe(true);
  });
});
