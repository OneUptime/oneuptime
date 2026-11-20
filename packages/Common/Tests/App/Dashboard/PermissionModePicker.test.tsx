import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import PermissionModePicker from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PermissionModePicker";
import { describePermissionMode } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversationData";
import AIChatPermissionMode from "../../../Types/AI/AIChatPermissionMode";
import { LAYERED_POPOVER_CLASS_NAME } from "../../../UI/Components/Tooltip/LayeredPopover";

const COPILOT_WORD: RegExp = /copilot/i;

/*
 * The control that says what the AI may do with a request: act at once, ask
 * first, or only read. Ask AI's composer and the AI Investigation card's
 * both have it at the left end of their controls, where a menu lined up on
 * the button's right edge opened past the box's left edge. It is also a menu a keyboard and a screen reader can
 * use: it says it is one, whether it is open, and which mode is chosen.
 */

function trigger(): HTMLElement {
  return screen.getByTitle("Choose what the AI is allowed to do");
}

function menu(): HTMLElement | null {
  return screen.queryByRole("menu");
}

function open(): HTMLElement {
  fireEvent.click(trigger());
  return screen.getByRole("menu");
}

function renderPicker(
  props: Partial<React.ComponentProps<typeof PermissionModePicker>> = {},
): { onChange: MockFunction } {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <PermissionModePicker
      value={AIChatPermissionMode.AutoRun}
      onChange={onChange}
      {...props}
    />,
  );

  return { onChange };
}

afterEach(() => {
  cleanup();
});

describe("PermissionModePicker — the button", () => {
  test.each([
    [AIChatPermissionMode.AutoRun, "Auto-run"],
    [AIChatPermissionMode.AskForApproval, "Ask to act"],
    [AIChatPermissionMode.ReadOnly, "Read-only"],
  ])(
    "names the chosen mode (%s) in a word or two",
    (mode: AIChatPermissionMode, label: string) => {
      renderPicker({ value: mode });

      expect(trigger()).toHaveTextContent(label);
      expect(trigger().querySelectorAll("svg")).toHaveLength(2);
    },
  );

  test("says it opens a menu, and that the menu is closed", () => {
    renderPicker();

    expect(trigger()).toHaveAttribute("type", "button");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    expect(menu()).toBeNull();
  });

  test("shows its focus to a keyboard", () => {
    renderPicker();

    expect(trigger()).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
    );
  });

  test("a disabled picker does not open", () => {
    renderPicker({ disabled: true });

    fireEvent.click(trigger());

    expect(trigger()).toBeDisabled();
    expect(menu()).toBeNull();
  });
});

describe("PermissionModePicker — the menu", () => {
  test("opens on a click and says so on the button", () => {
    renderPicker();

    const opened: HTMLElement = open();

    expect(opened).toHaveAccessibleName("AI permissions");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", opened.id);
    expect(opened.id.length).toBeGreaterThan(0);
  });

  test("offers the three modes, each with what it means", () => {
    renderPicker();

    const items: Array<HTMLElement> =
      within(open()).getAllByRole("menuitemradio");

    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "Ask to actAsks for approval before it changes anything.",
      "Auto-runActs on clear requests right away, within your permissions.",
      "Read-onlyOnly reads and answers. It never changes anything.",
    ]);
  });

  /*
   * The menu offered "Ask for approval" under a button that said "Ask to
   * act", and the docs tell people to pick Ask to act: a mode has one name,
   * on the button, in the menu and in the docs.
   */
  test.each([
    [AIChatPermissionMode.AskForApproval],
    [AIChatPermissionMode.AutoRun],
    [AIChatPermissionMode.ReadOnly],
  ])(
    "the chosen mode (%s) has the name in the menu that the button gives it",
    (mode: AIChatPermissionMode) => {
      renderPicker({ value: mode });

      const name: string = trigger().textContent || "";
      const chosen: HTMLElement = within(open()).getByRole("menuitemradio", {
        checked: true,
      });

      expect(name.length).toBeGreaterThan(0);
      expect(chosen.querySelector("span")?.textContent).toBe(name);
    },
  );

  /*
   * Each mode says what it means in the sentence the AI Investigation card's
   * composer shows beside its picker - one set of words, which every
   * language translates - and never in another product's words.
   */
  test("each mode says what it means as the card's composer says it", () => {
    renderPicker();

    const items: Array<HTMLElement> =
      within(open()).getAllByRole("menuitemradio");

    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual(
      [
        AIChatPermissionMode.AskForApproval,
        AIChatPermissionMode.AutoRun,
        AIChatPermissionMode.ReadOnly,
      ].map((mode: AIChatPermissionMode): string => {
        return `${
          {
            [AIChatPermissionMode.AskForApproval]: "Ask to act",
            [AIChatPermissionMode.AutoRun]: "Auto-run",
            [AIChatPermissionMode.ReadOnly]: "Read-only",
          }[mode]
        }${describePermissionMode(mode)}`;
      }),
    );

    for (const item of items) {
      expect(item.textContent).not.toMatch(COPILOT_WORD);
    }
  });

  test.each([
    [AIChatPermissionMode.AskForApproval, [true, false, false]],
    [AIChatPermissionMode.AutoRun, [false, true, false]],
    [AIChatPermissionMode.ReadOnly, [false, false, true]],
  ])(
    "marks %s as the chosen one, and only it",
    (mode: AIChatPermissionMode, checked: Array<boolean>) => {
      renderPicker({ value: mode });

      expect(
        within(open())
          .getAllByRole("menuitemradio")
          .map((item: HTMLElement): boolean => {
            return item.getAttribute("aria-checked") === "true";
          }),
      ).toEqual(checked);
    },
  );

  test("choosing a mode calls back, closes the menu and returns focus to the button", () => {
    const { onChange } = renderPicker();

    fireEvent.click(
      within(open()).getByRole("menuitemradio", { name: /^Read-only/ }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(AIChatPermissionMode.ReadOnly);
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger());
  });

  test("choosing the mode already chosen still calls back and closes", () => {
    const { onChange } = renderPicker();

    fireEvent.click(
      within(open()).getByRole("menuitemradio", { name: /^Auto-run/ }),
    );

    expect(onChange).toHaveBeenCalledWith(AIChatPermissionMode.AutoRun);
    expect(menu()).toBeNull();
  });

  test("a second click on the button closes it", () => {
    renderPicker();

    open();
    fireEvent.click(trigger());

    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  test("Escape closes it and returns focus to the button", () => {
    const { onChange } = renderPicker();

    const opened: HTMLElement = open();
    within(opened).getAllByRole("menuitemradio")[0]!.focus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(menu()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  /*
   * Ask AI's dialog closes on an Escape nobody else used: the menu marks
   * its Escape as spent, so it closes the menu and not the dialog too.
   */
  test("its Escape is spent on the menu, so the dialog around it stays open", () => {
    renderPicker();

    open();
    const event: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  test("a closed menu leaves Escape to the dialog", () => {
    renderPicker();

    const event: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  test("other keys leave it open", () => {
    renderPicker();

    open();
    for (const key of ["a", "Enter", "ArrowDown", "Tab"]) {
      fireEvent.keyDown(document, { key });
    }

    expect(menu()).not.toBeNull();
  });

  test("a press outside closes it; a press inside does not", () => {
    render(
      <div>
        <button type="button">Elsewhere</button>
        <PermissionModePicker
          value={AIChatPermissionMode.AutoRun}
          onChange={() => {}}
        />
      </div>,
    );

    const opened: HTMLElement = open();
    fireEvent.mouseDown(opened);
    expect(menu()).not.toBeNull();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(menu()).toBeNull();
  });

  test("a closed menu listens for nothing, and stops listening as it closes", () => {
    const listened: Array<string> = [];
    const stopped: Array<string> = [];
    const spies: Array<ReturnType<typeof jest.spyOn>> = [];

    for (const target of [document, window] as Array<EventTarget>) {
      const name: string = target === document ? "document" : "window";

      spies.push(
        jest.spyOn(target, "addEventListener").mockImplementation(function (
          this: EventTarget,
          ...args: Parameters<EventTarget["addEventListener"]>
        ): void {
          if (args[0] === "mousedown" || args[0] === "keydown") {
            listened.push(`${name} ${args[0]}`);
          }
          EventTarget.prototype.addEventListener.apply(this, args);
        }),
        jest.spyOn(target, "removeEventListener").mockImplementation(function (
          this: EventTarget,
          ...args: Parameters<EventTarget["removeEventListener"]>
        ): void {
          if (args[0] === "mousedown" || args[0] === "keydown") {
            stopped.push(`${name} ${args[0]}`);
          }
          EventTarget.prototype.removeEventListener.apply(this, args);
        }),
      );
    }

    try {
      renderPicker();

      expect(listened).toEqual([]);

      open();
      // The layer's Escape on the window, its press outside on the document.
      expect(listened).toContain("window keydown");
      expect(listened).toContain("document mousedown");

      fireEvent.keyDown(document, { key: "Escape" });
      expect(menu()).toBeNull();
      // Every listener it added is gone with it.
      expect([...stopped].sort()).toEqual([...listened].sort());
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  test("each item shows its focus to a keyboard", () => {
    renderPicker();

    for (const item of within(open()).getAllByRole("menuitemradio")) {
      expect(item).toHaveAttribute("type", "button");
      expect(item).toHaveClass(
        "focus:outline-none",
        "focus-visible:bg-gray-100",
      );
    }
  });
});

/*
 * The menu is placed against the window, on the tooltip layer, which jsdom
 * does not lay out: these stub the window's size, where the button is and
 * how tall the menu is, and put the real ones back after each test.
 */
interface StubbedLayout {
  // The button's top and bottom, 40px wide from its left (80px).
  button: [number, number];
  windowHeight: number;
  menuHeight: number;
}

const WINDOW_WIDTH: number = 1280;
const restoreLayout: Array<() => void> = [];

function rectOf(
  top: number,
  bottom: number,
  left: number,
  width: number,
): DOMRect {
  return {
    top: top,
    bottom: bottom,
    left: left,
    right: left + width,
    width: width,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => {
      return {};
    },
  };
}

function stubProperty(
  target: HTMLElement,
  property: string,
  getter: (this: HTMLElement) => number,
): void {
  const original: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(target, property);

  Object.defineProperty(target, property, { configurable: true, get: getter });

  restoreLayout.push(() => {
    if (original) {
      Object.defineProperty(target, property, original);
    } else {
      Reflect.deleteProperty(target, property);
    }
  });
}

function stubLayout(layout: StubbedLayout): void {
  const originalRect: () => DOMRect =
    HTMLElement.prototype.getBoundingClientRect;

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "menu") {
      return rectOf(layout.button[0], layout.button[1], 80, 40);
    }

    return originalRect.call(this);
  };
  restoreLayout.push(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  stubProperty(document.documentElement, "clientHeight", () => {
    return layout.windowHeight;
  });
  stubProperty(document.documentElement, "clientWidth", () => {
    return WINDOW_WIDTH;
  });
  stubProperty(HTMLElement.prototype, "offsetHeight", function () {
    return this.getAttribute("role") === "menu" ? layout.menuHeight : 0;
  });
  stubProperty(HTMLElement.prototype, "offsetWidth", function () {
    return this.getAttribute("role") === "menu" ? 288 : 0;
  });
}

afterEach(() => {
  for (const restore of restoreLayout.splice(0).reverse()) {
    restore();
  }
  document.documentElement.removeAttribute("dir");
});

// The side and the edge the layer placed the open menu on.
function placementOf(opened: HTMLElement): string | null {
  const layer: HTMLElement | null = opened.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer!.getAttribute("data-popper-placement");
}

// A composer at the foot of a window 800px tall, as Ask AI's conversation is.
const AT_THE_FOOT: StubbedLayout = {
  button: [740, 766],
  windowHeight: 800,
  menuHeight: 286,
};

describe("PermissionModePicker — where the menu opens", () => {
  test("is drawn on the tooltip layer, never inside a box that clips the composer (#9910)", () => {
    stubLayout(AT_THE_FOOT);
    render(
      <div data-testid="dialog" style={{ overflow: "hidden" }}>
        <PermissionModePicker
          value={AIChatPermissionMode.AutoRun}
          onChange={getJestMockFunction()}
        />
      </div>,
    );

    const opened: HTMLElement = open();

    expect(screen.getByTestId("dialog")).not.toContainElement(opened);
    expect(
      opened.closest(`.${LAYERED_POPOVER_CLASS_NAME}`)?.parentElement,
    ).toBe(document.body);
    // Its own look, no place of its own: the layer places it.
    expect(opened).toHaveClass("w-72", "max-w-[calc(100vw-1rem)]");
    expect(opened).not.toHaveClass("absolute", "bottom-full", "right-2");
  });

  test("lines up on the button's end, above it, by default", () => {
    stubLayout(AT_THE_FOOT);
    renderPicker();

    expect(placementOf(open())).toBe("top-end");
  });

  test("an explicit end is the same as the default", () => {
    stubLayout(AT_THE_FOOT);
    renderPicker({ menuAlign: "end" });

    expect(placementOf(open())).toBe("top-end");
  });

  test("lines up on the button's start when asked (Ask AI and the AI Investigation card)", () => {
    stubLayout(AT_THE_FOOT);
    renderPicker({ menuAlign: "start" });

    expect(placementOf(open())).toBe("top-start");
  });

  test("on a page read right to left, its start is the button's right edge", () => {
    document.documentElement.setAttribute("dir", "rtl");
    stubLayout(AT_THE_FOOT);
    renderPicker({ menuAlign: "start" });

    expect(placementOf(open())).toBe("top-end");
  });

  test("opens downwards when asked and the window has the room (the composer at the top of Ask AI's start)", () => {
    stubLayout({ button: [200, 226], windowHeight: 800, menuHeight: 286 });
    renderPicker({ menuAlign: "start", menuSide: "bottom" });

    expect(placementOf(open())).toBe("bottom-start");
  });

  test("an explicit top is the same as the default", () => {
    stubLayout(AT_THE_FOOT);
    renderPicker({ menuSide: "top" });

    expect(placementOf(open())).toBe("top-end");
  });
});

describe("PermissionModePicker — a menu that would not fit", () => {
  function renderInDialog(): void {
    render(
      <div style={{ overflowY: "hidden" }}>
        <PermissionModePicker
          value={AIChatPermissionMode.AskForApproval}
          onChange={getJestMockFunction()}
          menuAlign="start"
          menuSide="bottom"
        />
      </div>,
    );
  }

  /*
   * Ask AI's start on a laptop window 800 px tall: the composer in the
   * middle of the dialog, and a menu 286 px tall that would run past the
   * window's foot under it - the UI review of #5349 saw its last choice cut
   * in half there.
   */
  test("asked to open down where the window has no room, it opens up", () => {
    stubLayout({ button: [486, 512], windowHeight: 800, menuHeight: 286 });
    renderInDialog();

    expect(placementOf(open())).toBe("top-start");
  });

  test("with room below, it opens down as asked", () => {
    stubLayout({ button: [402, 428], windowHeight: 800, menuHeight: 286 });
    renderInDialog();

    expect(placementOf(open())).toBe("bottom-start");
  });

  test("each opening starts from the side asked for", () => {
    stubLayout({ button: [486, 512], windowHeight: 800, menuHeight: 286 });
    renderInDialog();

    expect(placementOf(open())).toBe("top-start");
    fireEvent.click(trigger());
    expect(menu()).toBeNull();

    // The start scrolled: the controls are higher, with room below now.
    for (const restore of restoreLayout.splice(0).reverse()) {
      restore();
    }
    stubLayout({ button: [300, 326], windowHeight: 800, menuHeight: 286 });

    expect(placementOf(open())).toBe("bottom-start");
  });

  test("in a window too short for it either way, it opens on the roomier side, cut to fit and scrolling", () => {
    stubLayout({ button: [150, 176], windowHeight: 360, menuHeight: 286 });
    renderInDialog();

    const opened: HTMLElement = open();

    // 360 - 176 - 8 - 8 = 168 below, 150 - 8 - 8 = 134 above.
    expect(placementOf(opened)).toBe("bottom-start");
    expect(opened.style.maxHeight).toBe("168px");
    expect(opened.style.overflowY).toBe("auto");
  });
});

describe("PermissionModePicker — the keyboard goes through the menu", () => {
  test("Tab on the button goes into the menu, through it, and on from the button", () => {
    renderPicker();

    open();
    act(() => {
      trigger().focus();
    });

    const items: Array<HTMLElement> = screen.getAllByRole("menuitemradio");

    expect(fireEvent.keyDown(trigger(), { key: "Tab" })).toBe(false);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0]!, { key: "Tab" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1]!, { key: "Tab" });
    expect(items[2]).toHaveFocus();

    // Past the last: back on the button, the browser's own Tab moves on.
    expect(fireEvent.keyDown(items[2]!, { key: "Tab" })).toBe(true);
    expect(trigger()).toHaveFocus();
    expect(menu()).toBeNull();
  });

  test("the focus leaving it for the page closes it", () => {
    render(
      <div>
        <PermissionModePicker
          value={AIChatPermissionMode.AutoRun}
          onChange={getJestMockFunction()}
        />
        <button type="button">Send</button>
      </div>,
    );

    const opened: HTMLElement = open();
    act(() => {
      within(opened).getAllByRole("menuitemradio")[0]!.focus();
    });
    act(() => {
      screen.getByRole("button", { name: "Send" }).focus();
    });

    expect(menu()).toBeNull();
  });
});
