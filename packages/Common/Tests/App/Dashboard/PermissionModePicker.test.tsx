import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
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

  test("a closed menu listens for nothing", () => {
    const add: ReturnType<typeof jest.spyOn> = jest.spyOn(
      document,
      "addEventListener",
    );
    const remove: ReturnType<typeof jest.spyOn> = jest.spyOn(
      document,
      "removeEventListener",
    );

    try {
      renderPicker();

      const listened: (spy: ReturnType<typeof jest.spyOn>) => Array<string> = (
        spy: ReturnType<typeof jest.spyOn>,
      ): Array<string> => {
        return spy.mock.calls
          .map((call: Array<unknown>): string => {
            return String(call[0]);
          })
          .filter((type: string): boolean => {
            return type === "mousedown" || type === "keydown";
          })
          .sort();
      };

      expect(listened(add)).toEqual([]);

      open();
      expect(listened(add)).toEqual(["keydown", "mousedown"]);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(listened(remove)).toEqual(["keydown", "mousedown"]);
    } finally {
      add.mockRestore();
      remove.mockRestore();
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

describe("PermissionModePicker — where the menu opens", () => {
  test("lines up on the button's right edge by default", () => {
    renderPicker();

    const opened: HTMLElement = open();
    expect(opened).toHaveClass("right-0");
    expect(opened).not.toHaveClass("left-0");
  });

  test("an explicit right is the same as the default", () => {
    renderPicker({ menuAlign: "right" });

    expect(open()).toHaveClass("right-0");
  });

  test("lines up on the button's left edge when asked (Ask AI and the AI Investigation card)", () => {
    renderPicker({ menuAlign: "left" });

    const opened: HTMLElement = open();
    expect(opened).toHaveClass("left-0");
    expect(opened).not.toHaveClass("right-0");
  });

  test.each([["left"], ["right"]] as Array<["left" | "right"]>)(
    "opens upwards and never wider than the screen (%s)",
    (menuAlign: "left" | "right") => {
      renderPicker({ menuAlign });

      // Above the composer, which sits at the bottom of what holds it.
      expect(open()).toHaveClass(
        "absolute",
        "bottom-full",
        "w-72",
        "max-w-[calc(100vw-2rem)]",
      );
    },
  );

  /*
   * Ask AI's start draws the composer near the top of the dialog, where a
   * menu opening upwards would be cut off by the dialog's edge.
   */
  test("opens downwards when asked (the composer at the top of Ask AI's start)", () => {
    renderPicker({ menuAlign: "left", menuSide: "bottom" });

    const opened: HTMLElement = open();
    expect(opened).toHaveClass("top-full", "mt-2", "left-0");
    expect(opened).not.toHaveClass("bottom-full");
  });

  test("an explicit top is the same as the default", () => {
    renderPicker({ menuSide: "top" });

    expect(open()).toHaveClass("bottom-full", "mb-2");
  });
});

/*
 * The menu's side is measured, which jsdom does not do: these stub where
 * the button is, how tall the menu is and the box that clips them both
 * (Ask AI's dialog), and put the real methods back after each test.
 */
interface StubbedLayout {
  button: [number, number];
  boundary: [number, number];
  menuHeight: number;
}

const restoreLayout: Array<() => void> = [];

function rectOf(top: number, bottom: number): DOMRect {
  return {
    top: top,
    bottom: bottom,
    left: 0,
    right: 200,
    width: 200,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => {
      return {};
    },
  };
}

function stubLayout(layout: StubbedLayout): void {
  const originalRect: () => DOMRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeight: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "menu") {
      return rectOf(layout.button[0], layout.button[1]);
    }

    if (this.hasAttribute("data-boundary")) {
      return rectOf(layout.boundary[0], layout.boundary[1]);
    }

    return originalRect.call(this);
  };

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("role") === "menu" ? layout.menuHeight : 0;
    },
  });

  restoreLayout.push(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;

    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
  });
}

afterEach(() => {
  for (const restore of restoreLayout.splice(0)) {
    restore();
  }
});

describe("PermissionModePicker — a menu that would not fit", () => {
  function renderInDialog(): void {
    render(
      <div data-boundary="" style={{ overflowY: "hidden" }}>
        <PermissionModePicker
          value={AIChatPermissionMode.AskForApproval}
          onChange={getJestMockFunction()}
          menuAlign="left"
          menuSide="bottom"
        />
      </div>,
    );
  }

  /*
   * Ask AI's start on a laptop window 800 px tall: the composer in the
   * middle of the dialog, 256 px between its controls and the dialog's
   * foot, and a menu 286 px tall.
   */
  test("asked to open down where the dialog would cut it off, it opens up", () => {
    stubLayout({ button: [486, 512], boundary: [24, 776], menuHeight: 286 });
    renderInDialog();

    const opened: HTMLElement = open();
    expect(opened).toHaveAttribute("data-menu-side", "top");
    expect(opened).toHaveClass("bottom-full", "mb-2", "left-0");
    expect(opened).not.toHaveClass("top-full");
  });

  test("with room below, it opens down as asked", () => {
    stubLayout({ button: [402, 428], boundary: [24, 776], menuHeight: 286 });
    renderInDialog();

    const opened: HTMLElement = open();
    expect(opened).toHaveAttribute("data-menu-side", "bottom");
    expect(opened).toHaveClass("top-full", "mt-2");
  });

  test("each opening starts from the side asked for", () => {
    stubLayout({ button: [486, 512], boundary: [24, 776], menuHeight: 286 });
    renderInDialog();

    expect(open()).toHaveAttribute("data-menu-side", "top");
    fireEvent.click(trigger());
    expect(menu()).toBeNull();

    // The start scrolled: the controls are higher, with room below now.
    restoreLayout.splice(0).forEach((restore: () => void) => {
      restore();
    });
    stubLayout({ button: [300, 326], boundary: [24, 776], menuHeight: 286 });

    expect(open()).toHaveAttribute("data-menu-side", "bottom");
  });
});
