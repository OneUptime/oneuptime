import LayeredPopover, {
  LAYERED_POPOVER_CLASS_NAME,
  LAYERED_POPOVER_MIN_HEIGHT_PX,
  LAYERED_POPOVER_WINDOW_PADDING_PX,
  LayeredPopoverAlignment,
  LayeredPopoverSide,
  chooseLayeredPopoverSide,
  getLayeredPopoverPlacement,
  isReadRightToLeft,
} from "../../../UI/Components/Tooltip/LayeredPopover";
import Modal from "../../../UI/Components/Modal/Modal";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import { getTooltipLayer } from "../../../UI/Components/Tooltip/TooltipLayer";
import { wasPressConsumedByAnAnchoredPopup } from "../../../UI/Types/LayeredDismissal";
import useComponentOutsideClick from "../../../UI/Types/UseComponentOutsideClick";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import React, { ReactElement, RefObject, useRef, useState } from "react";

/*
 * A MENU OR A PANEL OPENED FROM A CONTROL IS DRAWN ON THE TOOLTIP LAYER.
 *
 * Hand-rolled menus - a toolbar's Columns, Export and time range, saved
 * views, the Copy attributes menu - drew themselves `absolute` inside the
 * box their control sat in, and a card, a table that scrolls sideways or a
 * side panel's scrolling body cut off their foot (#9859, #9861).
 * LayeredPopover draws them where every tooltip is drawn since #9769: on
 * the page's body, placed against the window. It keeps what a menu drawn
 * right after its control had: Tab goes through it as if it sat there,
 * Escape closes it and is spent there, a press outside closes it - and a
 * press inside it is a press inside whatever holds its control.
 *
 * jsdom lays nothing out, so the placement tests give the window, the
 * control and the menu their sizes, and read where Popper put the menu.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

// Lets Popper place what it was handed: its updates wait a promise.
async function placed(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Lets Tippy's own delays run out (a tooltip waits 120ms to show).
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 250);
    });
  });
}

// Tab, or Shift+Tab, to what has the focus; true when the browser's own move is left to it.
function pressTab(options?: { shiftKey?: boolean }): boolean {
  return fireEvent.keyDown(document.activeElement || document.body, {
    key: "Tab",
    code: "Tab",
    shiftKey: Boolean(options?.shiftKey),
  });
}

// The layer's element a menu is drawn in.
function layerOf(element: HTMLElement): HTMLElement {
  const layer: HTMLElement | null = element.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer as HTMLElement;
}

interface MenuProps {
  // Where the control sits: a box that clips, by its style.
  boxStyle?: React.CSSProperties | undefined;
  align?: LayeredPopoverAlignment | undefined;
  side?: LayeredPopoverSide | undefined;
  // What the menu holds.
  content?: ReactElement | undefined;
  onClose?: (() => void) | undefined;
  // The control has a Tooltip of its own.
  hasTooltip?: boolean | undefined;
}

// A control that opens a menu, as the toolbars draw theirs.
function MenuControl(props: MenuProps): ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const triggerRef: RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const button: ReactElement = (
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={isOpen}
      onClick={() => {
        setIsOpen(!isOpen);
      }}
    >
      Columns
    </button>
  );

  return (
    <div data-testid="box" style={props.boxStyle}>
      {props.hasTooltip ? (
        <Tooltip text="Choose the columns">{button}</Tooltip>
      ) : (
        button
      )}
      {isOpen ? (
        <LayeredPopover
          anchorRef={triggerRef}
          align={props.align}
          side={props.side}
          dataTestId="menu-layer"
          onClose={() => {
            props.onClose?.();
            setIsOpen(false);
          }}
        >
          {props.content || (
            <div data-testid="menu" className="w-72">
              <button type="button">Time</button>
              <button type="button">Service</button>
            </div>
          )}
        </LayeredPopover>
      ) : null}
      <button type="button">After the control</button>
    </div>
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "Columns" });
}

function openMenu(props: MenuProps = {}): HTMLElement {
  render(<MenuControl {...props} />);
  fireEvent.click(trigger());

  return screen.getByTestId("menu");
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

describe("LayeredPopover - drawn on the page's body, never inside its control's box", () => {
  const CLIPPING_BOXES: Array<[string, React.CSSProperties]> = [
    ["a list's card that hides what runs past it", { overflow: "hidden" }],
    ["a table that scrolls sideways", { overflowX: "auto" }],
    ["a side panel's scrolling body", { overflowY: "auto" }],
    ["a box that clips", { overflow: "clip" }],
    ["a box that paints only inside itself", { contain: "paint" }],
    ["a box lifted by a transform", { transform: "translateY(-2px)" }],
  ];

  test.each(CLIPPING_BOXES)(
    "a menu opened in %s is drawn on the body, outside it",
    (_name: string, style: React.CSSProperties) => {
      const menu: HTMLElement = openMenu({ boxStyle: style });

      expect(screen.getByTestId("box")).not.toContainElement(menu);
      expect(layerOf(menu).parentElement).toBe(document.body);
      expect(layerOf(menu)).toHaveAttribute("data-testid", "menu-layer");
    },
  );

  test("it is placed against its own control, and above the page's chrome", () => {
    const layer: HTMLElement = layerOf(openMenu());

    expect(
      (layer as HTMLElement & { _tippy?: { reference: Element } })._tippy
        ?.reference,
    ).toBe(trigger());
    // Over a dialog (z-50), as every portalled menu is (DropdownMenuZIndex).
    expect(layer.style.zIndex).toBe("60");
  });

  test("it is drawn only while it is open, and goes with it", () => {
    openMenu();

    expect(
      document.querySelectorAll(`.${LAYERED_POPOVER_CLASS_NAME}`),
    ).toHaveLength(1);

    fireEvent.click(trigger());

    expect(screen.queryByTestId("menu")).toBeNull();
    expect(
      document.querySelectorAll(`.${LAYERED_POPOVER_CLASS_NAME}`),
    ).toHaveLength(0);
  });

  test("a field in it that focuses itself as it is drawn takes the focus", () => {
    openMenu({
      content: (
        <div data-testid="menu">
          <input aria-label="Search columns" autoFocus={true} />
        </div>
      ),
    });

    expect(
      screen.getByRole("textbox", { name: "Search columns" }),
    ).toHaveFocus();
  });

  test("a control with a Tooltip of its own keeps it", async () => {
    openMenu({ hasTooltip: true });

    // The control still names its own tooltip's instance.
    expect(
      (trigger() as HTMLElement & { _tippy?: { props: { content: unknown } } })
        ._tippy,
    ).toBeDefined();

    fireEvent.click(trigger());
    fireEvent.mouseEnter(trigger());
    await settle();

    expect(screen.getByText("Choose the columns")).toBeInTheDocument();
  });

  test("Tooltip.css hides it while its control is scrolled out of sight", () => {
    const css: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Tooltip/Tooltip.css"),
      "utf8",
    );

    expect(css.replace(/\s+/g, " ")).toContain(
      `.${LAYERED_POPOVER_CLASS_NAME}[data-popper-reference-hidden] { visibility: hidden; pointer-events: none; }`,
    );

    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Tooltip/LayeredPopover.tsx"),
      "utf8",
    );

    expect(source).toContain('import "./Tooltip.css";');
  });
});

describe("LayeredPopover - which side and which edge", () => {
  test("its start on its control's start, or its end on its end, in the line's direction", () => {
    expect(
      getLayeredPopoverPlacement({
        side: "bottom",
        align: "start",
        isRightToLeft: false,
      }),
    ).toBe("bottom-start");
    expect(
      getLayeredPopoverPlacement({
        side: "bottom",
        align: "end",
        isRightToLeft: false,
      }),
    ).toBe("bottom-end");
    // A line read from the right starts at the right.
    expect(
      getLayeredPopoverPlacement({
        side: "bottom",
        align: "start",
        isRightToLeft: true,
      }),
    ).toBe("bottom-end");
    expect(
      getLayeredPopoverPlacement({
        side: "top",
        align: "end",
        isRightToLeft: true,
      }),
    ).toBe("top-start");
  });

  test("the side it asks for while it fits, the other while that fits, else the roomier", () => {
    expect(
      chooseLayeredPopoverSide({
        preferred: "bottom",
        roomAbove: 100,
        roomBelow: 400,
        height: 300,
      }),
    ).toBe("bottom");
    expect(
      chooseLayeredPopoverSide({
        preferred: "bottom",
        roomAbove: 500,
        roomBelow: 120,
        height: 300,
      }),
    ).toBe("top");
    expect(
      chooseLayeredPopoverSide({
        preferred: "top",
        roomAbove: 20,
        roomBelow: 400,
        height: 300,
      }),
    ).toBe("bottom");
    // Neither has all of it: the one with more room, not a sliver.
    expect(
      chooseLayeredPopoverSide({
        preferred: "bottom",
        roomAbove: 250,
        roomBelow: 40,
        height: 600,
      }),
    ).toBe("top");
    expect(
      chooseLayeredPopoverSide({
        preferred: "bottom",
        roomAbove: 40,
        roomBelow: 40,
        height: 600,
      }),
    ).toBe("bottom");
  });

  test("reads the direction its control's line is read in", () => {
    render(
      <div dir="rtl">
        <button type="button">Persian</button>
      </div>,
    );

    expect(isReadRightToLeft(screen.getByRole("button"))).toBe(true);

    cleanup();
    render(<button type="button">English</button>);

    expect(isReadRightToLeft(screen.getByRole("button"))).toBe(false);
  });
});

describe("LayeredPopover - placed against the window", () => {
  const WINDOW_WIDTH: number = 1280;
  const WINDOW_HEIGHT: number = 640;
  let menuHeight: number = 300;
  const MENU_WIDTH: number = 288;

  let restore: Array<() => void> = [];

  const defineGetter: (
    target: HTMLElement,
    property: string,
    getter: (this: HTMLElement) => number,
  ) => void = (
    target: HTMLElement,
    property: string,
    getter: (this: HTMLElement) => number,
  ): void => {
    const original: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(target, property);

    Object.defineProperty(target, property, {
      configurable: true,
      get: getter,
    });

    restore.push(() => {
      if (original) {
        Object.defineProperty(target, property, original);
      } else {
        Reflect.deleteProperty(target, property);
      }
    });
  };

  const isMenu: (element: HTMLElement) => boolean = (
    element: HTMLElement,
  ): boolean => {
    return (
      element.classList.contains(LAYERED_POPOVER_CLASS_NAME) ||
      element.getAttribute("data-testid") === "menu"
    );
  };

  beforeEach(() => {
    restore = [];
    menuHeight = 300;

    defineGetter(document.documentElement, "clientWidth", () => {
      return WINDOW_WIDTH;
    });
    defineGetter(document.documentElement, "clientHeight", () => {
      return WINDOW_HEIGHT;
    });
    defineGetter(HTMLElement.prototype, "offsetWidth", function () {
      return isMenu(this) ? MENU_WIDTH : 0;
    });

    // The menu's full height; a max-height cuts what it draws, not what it holds.
    const drawnHeight: (this: HTMLElement) => number = function (
      this: HTMLElement,
    ): number {
      if (!isMenu(this)) {
        return 0;
      }

      const cut: number = parseFloat(this.style.maxHeight || "");

      return Number.isFinite(cut) ? Math.min(cut, menuHeight) : menuHeight;
    };

    defineGetter(HTMLElement.prototype, "offsetHeight", drawnHeight);
    defineGetter(HTMLElement.prototype, "clientHeight", drawnHeight);
    defineGetter(HTMLElement.prototype, "scrollHeight", function () {
      return isMenu(this) ? menuHeight : 0;
    });
  });

  afterEach(() => {
    for (const undo of restore.reverse()) {
      undo();
    }
  });

  function placeAt(
    element: HTMLElement,
    box: { left: number; top: number; width: number; height: number },
  ): void {
    element.getBoundingClientRect = (): DOMRect => {
      return {
        x: box.left,
        y: box.top,
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: (): string => {
          return "";
        },
      } as DOMRect;
    };
  }

  interface Placed {
    placement: string | null;
    left: number;
    top: number;
    menu: HTMLElement;
  }

  async function openAt(
    control: { left: number; top: number },
    props: MenuProps = {},
  ): Promise<Placed> {
    render(<MenuControl {...props} />);
    placeAt(trigger(), { ...control, width: 120, height: 30 });
    fireEvent.click(trigger());
    await placed();

    const menu: HTMLElement = screen.getByTestId("menu");
    const layer: HTMLElement = layerOf(menu);
    const corner: { x: number; y: number } | undefined = (
      layer as HTMLElement & {
        _tippy?: {
          popperInstance?: {
            state: { modifiersData: Record<string, { x: number; y: number }> };
          };
        };
      }
    )._tippy?.popperInstance?.state.modifiersData["popperOffsets"];

    expect(corner).toBeDefined();

    return {
      placement: layer.getAttribute("data-popper-placement"),
      left: corner!.x,
      top: corner!.y,
      menu: menu,
    };
  }

  test("with room under its control, it opens under it, from its start", async () => {
    const shown: Placed = await openAt({ left: 400, top: 100 });

    expect(shown.placement).toBe("bottom-start");
    expect(shown.left).toBe(400);
    expect(shown.top).toBeGreaterThanOrEqual(130);
  });

  test("at the window's foot, with no room under its control, it opens above it", async () => {
    const shown: Placed = await openAt({ left: 400, top: WINDOW_HEIGHT - 60 });

    expect(shown.placement).toBe("top-start");
    expect(shown.top + menuHeight).toBeLessThanOrEqual(WINDOW_HEIGHT - 60);
    // It had all its room there: not cut down, nothing scrolls in it.
    expect(shown.menu.style.overflowY).toBe("");
    // Its own height, and any max-height of its own, are left to it.
    expect(shown.menu.style.maxHeight).toBe("");
  });

  test("with its end on its control's end, at the window's right edge", async () => {
    const shown: Placed = await openAt(
      { left: WINDOW_WIDTH - 140, top: 100 },
      { align: "end" },
    );

    expect(shown.placement).toBe("bottom-end");
    expect(shown.left + MENU_WIDTH).toBe(WINDOW_WIDTH - 20);
  });

  test("slid in to stay inside the window's side, wherever its edge would have put it", async () => {
    const shown: Placed = await openAt({ left: WINDOW_WIDTH - 130, top: 100 });

    expect(shown.placement).toBe("bottom-start");
    expect(shown.left + MENU_WIDTH).toBeLessThanOrEqual(
      WINDOW_WIDTH - LAYERED_POPOVER_WINDOW_PADDING_PX,
    );
  });

  test("on a page read right to left, its start is on its control's right edge", async () => {
    document.documentElement.setAttribute("dir", "rtl");

    const shown: Placed = await openAt({ left: 600, top: 100 });

    expect(shown.placement).toBe("bottom-end");
    expect(shown.left + MENU_WIDTH).toBe(720);
  });

  test("taller than the room on either side, it opens on the roomier one, cut down to it, and scrolls inside", async () => {
    menuHeight = 900;

    const shown: Placed = await openAt({ left: 400, top: 420 });
    // 420 above the control, less the gap and the window's margin.
    const roomAbove: number = 420 - 4 - LAYERED_POPOVER_WINDOW_PADDING_PX;

    expect(shown.placement).toBe("top-start");
    expect(shown.menu.style.maxHeight).toBe(`${roomAbove}px`);
    expect(shown.menu.style.overflowY).toBe("auto");
  });

  test("never cut down to less than a few rows", async () => {
    menuHeight = 900;

    const shown: Placed = await openAt({ left: 400, top: 40 });

    expect(shown.placement).toBe("bottom-start");
    expect(parseFloat(shown.menu.style.maxHeight)).toBeGreaterThanOrEqual(
      LAYERED_POPOVER_MIN_HEIGHT_PX,
    );
  });

  test("it follows its control as a box around it scrolls", async () => {
    const before: Placed = await openAt(
      { left: 400, top: 100 },
      { boxStyle: { overflow: "auto" } },
    );

    placeAt(trigger(), { left: 360, top: 80, width: 120, height: 30 });
    fireEvent.scroll(screen.getByTestId("box"));
    await placed();

    const layer: HTMLElement = layerOf(before.menu);
    const corner: { x: number; y: number } = (
      layer as HTMLElement & {
        _tippy: {
          popperInstance: {
            state: { modifiersData: Record<string, { x: number; y: number }> };
          };
        };
      }
    )._tippy.popperInstance.state.modifiersData["popperOffsets"]!;

    expect(corner.x).toBe(before.left - 40);
    expect(corner.y).toBe(before.top - 20);
  });

  test("once its control is scrolled out of the box it is in, it is marked to go", async () => {
    const shown: Placed = await openAt(
      { left: 100, top: 400 },
      { boxStyle: { overflow: "auto" } },
    );

    const box: HTMLElement = screen.getByTestId("box");
    placeAt(box, { left: 0, top: 0, width: 600, height: 200 });
    Object.defineProperty(box, "clientWidth", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(box, "clientHeight", {
      configurable: true,
      value: 200,
    });
    fireEvent.scroll(box);
    await placed();

    expect(layerOf(shown.menu)).toHaveAttribute("data-popper-reference-hidden");
  });
});

describe("LayeredPopover - the keyboard goes through it as if it sat after its control", () => {
  test("Tab on the control goes to its first, then its next, then on from the control", () => {
    openMenu();

    act(() => {
      trigger().focus();
    });

    expect(pressTab()).toBe(false);
    expect(screen.getByRole("button", { name: "Time" })).toHaveFocus();

    expect(pressTab()).toBe(false);
    expect(screen.getByRole("button", { name: "Service" })).toHaveFocus();

    // Past its last: back on the control, the browser's own Tab moves on.
    expect(pressTab()).toBe(true);
    expect(trigger()).toHaveFocus();
    expect(screen.queryByTestId("menu")).toBeNull();
  });

  test("Shift+Tab on its first goes back to the control, and it stays open", () => {
    openMenu();

    act(() => {
      trigger().focus();
    });
    pressTab();

    expect(pressTab({ shiftKey: true })).toBe(false);
    expect(trigger()).toHaveFocus();
    expect(screen.getByTestId("menu")).toBeInTheDocument();
  });

  test("from an item reached with the arrows (out of the Tab order), Tab goes on from the control", () => {
    openMenu({
      content: (
        <div data-testid="menu" role="menu">
          <button type="button" role="menuitemradio" tabIndex={-1}>
            Flat JSON
          </button>
          <button type="button" role="menuitemradio" tabIndex={-1}>
            Nested JSON
          </button>
        </div>
      ),
    });

    act(() => {
      screen.getByRole("menuitemradio", { name: "Nested JSON" }).focus();
    });

    expect(pressTab()).toBe(true);
    expect(trigger()).toHaveFocus();
    expect(screen.queryByTestId("menu")).toBeNull();
  });

  test("Tab is answered before the menu's own keys: a menu that closes on Tab has handed the focus back already", () => {
    const seenFocus: Array<Element | null> = [];

    openMenu({
      content: (
        <div
          data-testid="menu"
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Tab") {
              seenFocus.push(document.activeElement);
            }
          }}
        >
          <button type="button">Time</button>
        </div>
      ),
    });

    act(() => {
      screen.getByRole("button", { name: "Time" }).focus();
    });
    pressTab();

    expect(seenFocus).toEqual([trigger()]);
  });

  test("the focus leaving it for the rest of the page closes it", () => {
    const onClose: MockFunction = getJestMockFunction();
    openMenu({ onClose: onClose as () => void });

    act(() => {
      screen.getByRole("button", { name: "Time" }).focus();
    });
    act(() => {
      screen.getByRole("button", { name: "After the control" }).focus();
    });

    expect(screen.queryByTestId("menu")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("LayeredPopover - Escape", () => {
  test("closes it, hands the focus back to its control, and is spent there", () => {
    const pageEscape: MockFunction = getJestMockFunction();
    const listener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        pageEscape();
      }
    };
    document.addEventListener("keydown", listener);

    try {
      openMenu();
      act(() => {
        screen.getByRole("button", { name: "Service" }).focus();
      });

      fireEvent.keyDown(screen.getByRole("button", { name: "Service" }), {
        key: "Escape",
      });

      expect(screen.queryByTestId("menu")).toBeNull();
      expect(trigger()).toHaveFocus();
      // The logs explorer closes a log's details on a page Escape: not this one.
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  test("with the focus nowhere (a menu opened with the mouse in Safari), it still closes, and the control takes the focus", () => {
    openMenu();
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByTestId("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  test("a list open inside it closes first, on its own Escape", () => {
    openMenu({
      content: (
        <div data-testid="menu">
          <input aria-label="Pick" aria-expanded="true" role="combobox" />
        </div>
      ),
    });

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(screen.getByTestId("menu")).toBeInTheDocument();
  });

  test("inside a dialog, Escape closes the menu and leaves the dialog open", () => {
    const onDialogClose: MockFunction = getJestMockFunction();

    render(
      <Modal title="Edit dashboard" onClose={onDialogClose as () => void}>
        <MenuControl />
      </Modal>,
    );
    fireEvent.click(trigger());
    act(() => {
      screen.getByRole("button", { name: "Time" }).focus();
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Time" }), {
      key: "Escape",
    });

    expect(screen.queryByTestId("menu")).toBeNull();
    expect(onDialogClose).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });

  test("a dialog opened over it hears its own Escape", () => {
    const onDialogClose: MockFunction = getJestMockFunction();

    render(
      <div>
        <MenuControl />
        <Modal title="Save view" onClose={onDialogClose as () => void}>
          <input aria-label="Name" />
        </Modal>
      </div>,
    );
    fireEvent.click(trigger());

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), {
      key: "Escape",
    });

    expect(onDialogClose).toHaveBeenCalledTimes(1);
  });
});

describe("LayeredPopover - a press", () => {
  test("outside it and its control closes it, and is not also a press on a dialog's backdrop", () => {
    const onClose: MockFunction = getJestMockFunction();
    render(
      <div>
        <p>Elsewhere</p>
        <MenuControl onClose={onClose as () => void} />
      </div>,
    );
    fireEvent.click(trigger());

    const press: MouseEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      screen.getByText("Elsewhere").dispatchEvent(press);
    });

    expect(screen.queryByTestId("menu")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(wasPressConsumedByAnAnchoredPopup(press)).toBe(true);
  });

  test("inside it, or on its control, does not close it", () => {
    openMenu();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Time" }));
    fireEvent.mouseDown(trigger());

    expect(screen.getByTestId("menu")).toBeInTheDocument();
  });

  test("inside it is a press inside whatever holds its control", () => {
    function Panel(): ReactElement {
      const { ref, isComponentVisible } = useComponentOutsideClick(true);

      return (
        <div ref={ref}>
          {isComponentVisible ? <MenuControl /> : <p>Closed</p>}
        </div>
      );
    }

    render(<Panel />);
    fireEvent.click(trigger());

    const item: HTMLElement = screen.getByRole("button", { name: "Time" });
    fireEvent.mouseDown(item);
    fireEvent.click(item);

    expect(screen.queryByText("Closed")).toBeNull();
    expect(screen.getByTestId("menu")).toBeInTheDocument();
  });

  test("in a tooltip drawn from something in it is a press inside it", async () => {
    openMenu({
      content: (
        <div data-testid="menu">
          <Tooltip richContent={<a href="/docs/columns">About columns</a>}>
            <button type="button">Time</button>
          </Tooltip>
        </div>
      ),
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Time" }));
    await settle();
    fireEvent.mouseDown(screen.getByRole("link", { name: "About columns" }));

    expect(screen.getByTestId("menu")).toBeInTheDocument();
  });

  test("a click on an item reaches the control's own handlers, not a row behind it as a click on the row's own elements", () => {
    const rowClick: MockFunction = getJestMockFunction();

    render(
      <div
        data-testid="row"
        onClick={(event: React.MouseEvent<HTMLDivElement>) => {
          // A row opens only on a click on its own elements (RowClick).
          if (event.currentTarget.contains(event.target as Node)) {
            rowClick();
          }
        }}
      >
        <MenuControl />
      </div>,
    );
    fireEvent.click(trigger());
    rowClick.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Time" }));

    expect(rowClick).not.toHaveBeenCalled();
  });

  test("one gesture that both presses outside and takes the focus out asks it to close once", () => {
    const onClose: MockFunction = getJestMockFunction();
    openMenu({ onClose: onClose as () => void });
    act(() => {
      screen.getByRole("button", { name: "Time" }).focus();
    });

    const outside: HTMLElement = screen.getByRole("button", {
      name: "After the control",
    });

    fireEvent.mouseDown(outside);
    act(() => {
      outside.focus();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the tooltip layer, shown full screen", () => {
  test("is the part of the page shown full screen when it holds the trigger, else the body", () => {
    render(
      <div data-testid="canvas">
        <button type="button">Inside</button>
      </div>,
    );

    const canvas: HTMLElement = screen.getByTestId("canvas");
    const inside: HTMLElement = screen.getByRole("button", { name: "Inside" });
    const outside: HTMLElement = document.createElement("button");
    document.body.appendChild(outside);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: (): Element | null => {
        return canvas;
      },
    });

    try {
      expect(getTooltipLayer(inside)).toBe(canvas);
      expect(getTooltipLayer(outside)).toBe(document.body);
      // The full-screen element itself draws on the body as before.
      expect(getTooltipLayer(canvas)).toBe(document.body);
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
      outside.remove();
    }

    expect(getTooltipLayer(inside)).toBe(document.body);
  });
});
