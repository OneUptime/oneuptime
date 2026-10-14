import SideOver, {
  ComponentProps,
  SIDE_OVER_CLOSE_BUTTON_CLASS_NAME,
} from "../../../UI/Components/SideOver/SideOver";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  mediaPrecedenceOf,
  splitVariants,
} from "../../ResponsiveVisibility";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * The two buttons of a side panel's footer on a phone.
 *
 * Below md a button is as wide as it is given room for (`w-full`), so Close
 * and the panel's action shared the footer half and half: "Close" with room
 * to spare, beside an action whose words - "Create alert for this event",
 * "Warnung für dieses Ereignis erstellen" - broke over two or three lines
 * in the other half. Close now keeps the width of its own word there and
 * never shrinks, and the action takes the rest of the line.
 *
 * jsdom lays nothing out, so these resolve the width utilities the way the
 * Tailwind build orders them (ResponsiveVisibility's precedence).
 */

// Both sides of the md breakpoint, and the devices the suites name.
const BELOW_MD: Array<number> = [320, PHONE_WIDTH_IN_PX, 390, 639, 640, 767];
const FROM_MD: Array<number> = [
  TABLET_WIDTH_IN_PX,
  1024,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

/*
 * The width utility that wins on an element at a viewport width: "full",
 * "auto", or null when it carries none.
 */
function widthAt(element: Element, viewportWidthInPx: number): string | null {
  let winner: { value: string; precedence: number } | null = null;

  for (const token of Array.from(element.classList)) {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts.pop()!;

    if (utility !== "w-full" && utility !== "w-auto") {
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      parts,
      viewportWidthInPx,
    );

    if (precedence === null) {
      continue;
    }

    if (!winner || precedence >= winner.precedence) {
      winner = { value: utility.slice(2), precedence: precedence };
    }
  }

  return winner ? winner.value : null;
}

// Whether the element refuses to shrink in its flex row at this width.
function neverShrinksAt(element: Element, viewportWidthInPx: number): boolean {
  return Array.from(element.classList).some((token: string): boolean => {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts.pop()!;

    return (
      (utility === "shrink-0" || utility === "flex-shrink-0") &&
      mediaPrecedenceOf(parts, viewportWidthInPx) !== null
    );
  });
}

function baseProps(extra: Partial<ComponentProps> = {}): ComponentProps {
  return {
    title: "Interface down",
    description: "A device reported that a link went down.",
    onClose: jest.fn(),
    children: <div>What the device said</div>,
    ...extra,
  };
}

function footer(): HTMLElement {
  return screen.getByTestId("side-over-footer");
}

function closeButton(): HTMLElement {
  return within(footer()).getByRole("button", { name: "Close" });
}

describe("a side panel's footer buttons", () => {
  beforeEach(() => {
    resetPageScrollLockForTesting();
  });

  afterEach(() => {
    cleanup();
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  test.each(BELOW_MD)(
    "at %ipx Close is as wide as its word, and the action takes the rest of the line",
    (width: number) => {
      render(
        <SideOver
          {...baseProps({
            onSubmit: jest.fn(),
            submitButtonText: "Create alert for this event",
          })}
        />,
      );

      const action: HTMLElement = within(footer()).getByRole("button", {
        name: "Create alert for this event",
      });

      expect(widthAt(closeButton(), width)).toBe("auto");
      expect(neverShrinksAt(closeButton(), width)).toBe(true);
      // The action is still as wide as its room: now all that Close leaves.
      expect(widthAt(action, width)).toBe("full");
      expect(neverShrinksAt(action, width)).toBe(false);
    },
  );

  test.each(FROM_MD)(
    "at %ipx both are as wide as their own words, as they always were",
    (width: number) => {
      render(
        <SideOver
          {...baseProps({
            onSubmit: jest.fn(),
            submitButtonText: "Create alert for this event",
          })}
        />,
      );

      const action: HTMLElement = within(footer()).getByRole("button", {
        name: "Create alert for this event",
      });

      expect(widthAt(closeButton(), width)).toBe("auto");
      expect(widthAt(action, width)).toBe("auto");
      // Nothing of the phone rule reaches a wider screen.
      expect(neverShrinksAt(closeButton(), width)).toBe(false);
    },
  );

  test("before the change both were full-width below md: the two halves that broke the action's words", () => {
    render(<SideOver {...baseProps({ onSubmit: jest.fn() })} />);

    const before: HTMLElement = document.createElement("button");

    // The Close button's classes without the footer's own.
    before.className = Array.from(closeButton().classList)
      .filter((token: string): boolean => {
        return !SIDE_OVER_CLOSE_BUTTON_CLASS_NAME.split(" ").includes(token);
      })
      .join(" ");

    for (const width of BELOW_MD) {
      expect(widthAt(before, width)).toBe("full");
      expect(neverShrinksAt(before, width)).toBe(false);
    }
  });

  test("Close carries exactly the footer's own rule, and the action none of it", () => {
    render(
      <SideOver
        {...baseProps({ onSubmit: jest.fn(), submitButtonText: "Save" })}
      />,
    );

    expect(SIDE_OVER_CLOSE_BUTTON_CLASS_NAME).toBe(
      "max-md:w-auto max-md:shrink-0",
    );

    for (const token of SIDE_OVER_CLOSE_BUTTON_CLASS_NAME.split(" ")) {
      expect(closeButton()).toHaveClass(token);
      expect(
        within(footer()).getByRole("button", { name: "Save" }),
      ).not.toHaveClass(token);
    }
  });

  test("Close comes first and the action last, so the action is at the footer's edge", () => {
    render(
      <SideOver
        {...baseProps({ onSubmit: jest.fn(), submitButtonText: "Save" })}
      />,
    );

    expect(
      within(footer())
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual(["Close", "Save"]);
  });

  test("a panel with nothing to submit has Close alone, still its own word's width", () => {
    render(<SideOver {...baseProps()} />);

    expect(within(footer()).getAllByRole("button")).toHaveLength(1);

    for (const width of [...BELOW_MD, ...FROM_MD]) {
      expect(widthAt(closeButton(), width)).toBe("auto");
    }
  });

  test("a Close that is disabled while the panel works keeps the same width rule", () => {
    render(
      <SideOver
        {...baseProps({
          onSubmit: jest.fn(),
          closeButtonDisabled: true,
          submitButtonIsLoading: true,
        })}
      />,
    );

    expect(closeButton()).toBeDisabled();
    expect(widthAt(closeButton(), PHONE_WIDTH_IN_PX)).toBe("auto");
    expect(neverShrinksAt(closeButton(), PHONE_WIDTH_IN_PX)).toBe(true);
  });
});
