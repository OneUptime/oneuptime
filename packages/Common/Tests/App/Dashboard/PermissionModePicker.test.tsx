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
import AIChatPermissionMode from "../../../Types/AI/AIChatPermissionMode";

/*
 * The control that says what the AI may do with a request: act at once, ask
 * first, or only read. The Ask AI panel has it at the right end of its
 * composer's controls; the AI Investigation card's composer has it at the
 * left end, where a menu lined up on the button's right edge opened past the
 * card's left edge. It is also a menu a keyboard and a screen reader can
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
      "Ask for approvalThe copilot pauses and asks before it changes anything (creating incidents, acknowledging alerts, etc).",
      "Auto-run (bypass approvals)The copilot performs actions immediately, still limited to what your role can do.",
      "Read-onlyThe copilot can investigate and answer questions but can never change anything.",
    ]);
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
  test("lines up on the button's right edge by default (the Ask AI panel)", () => {
    renderPicker();

    const opened: HTMLElement = open();
    expect(opened).toHaveClass("right-0");
    expect(opened).not.toHaveClass("left-0");
  });

  test("an explicit right is the same as the default", () => {
    renderPicker({ menuAlign: "right" });

    expect(open()).toHaveClass("right-0");
  });

  test("lines up on the button's left edge when asked (the AI Investigation card)", () => {
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
});
