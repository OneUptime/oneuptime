import ExplainedPill, {
  EXPLAINED_PILL_CLASS_NAME,
} from "../../../UI/Components/Pill/ExplainedPill";
import { Yellow } from "../../../Types/BrandColors";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * A PILL THAT SAYS WHY, TO EVERYONE WHO ASKS.
 *
 * "Adds nothing" and "Never reminds" are warnings with a reason. As plain
 * pills with a tooltip, the reason showed under a mouse only. ExplainedPill
 * says it on hover, on a tap (kept until the next tap), on keyboard focus,
 * and to a screen reader as the button's description.
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

const REASON: string =
  "This rule adds nothing when it matches. Edit it to choose what it adds, or delete it.";

function renderPill(onParentClick?: () => void): HTMLElement {
  render(
    <div
      data-testid="row"
      onClick={onParentClick}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" || event.key === " ") {
          onParentClick?.();
        }
      }}
    >
      <ExplainedPill
        text="Adds nothing"
        explanation={REASON}
        color={Yellow}
        dataTestId="explained"
      />
    </div>,
  );

  return screen.getByTestId("explained");
}

// What a finger's tap sends a button, in the order the browser sends it.
function tap(element: HTMLElement): void {
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  act(() => {
    element.focus();
  });
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  // The finger lifts: the pointer leaves at once.
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
}

// Lets Tippy's deferred work run, then says which tooltips are shown.
async function tooltipsShown(): Promise<Array<string>> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });

  return screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
    return tooltip.textContent || "";
  });
}

afterEach(() => {
  cleanup();
});

describe("an explained pill", () => {
  test("is a button named by the pill's words, drawn as the pill", () => {
    const button: HTMLElement = renderPill();

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Adds nothing" })).toBe(button);
    expect(button.querySelector('[data-testid="pill"]')).not.toBeNull();
    expect(button.className).toBe(EXPLAINED_PILL_CLASS_NAME);
  });

  test("a screen reader hears the reason as its description, with no tooltip showing", () => {
    const button: HTMLElement = renderPill();

    expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    expect(button).toHaveAccessibleDescription(REASON);

    const description: HTMLElement = document.getElementById(
      button.getAttribute("aria-describedby") || "",
    )!;

    // Never drawn on its own: only read as the description.
    expect(description).not.toBeVisible();
    expect(description).toHaveAttribute("hidden");
  });

  test("hovering it shows the reason", async () => {
    const button: HTMLElement = renderPill();

    fireEvent.mouseEnter(button);

    expect(await tooltipsShown()).toEqual([REASON]);

    fireEvent.mouseLeave(button);
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    });
  });

  test("a tap on a phone shows the reason, and it stays once the finger lifts", async () => {
    const button: HTMLElement = renderPill();

    tap(button);

    expect(await tooltipsShown()).toEqual([REASON]);
  });

  test("a second tap puts it away", async () => {
    const button: HTMLElement = renderPill();

    tap(button);
    expect(await tooltipsShown()).toEqual([REASON]);

    tap(button);
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    });
  });

  test("keyboard focus shows the reason", async () => {
    const button: HTMLElement = renderPill();

    act(() => {
      button.focus();
    });
    fireEvent.focus(button);

    expect(document.activeElement).toBe(button);
    expect(await tooltipsShown()).toEqual([REASON]);
  });

  test("Tippy adds no description of its own: the reason is read once", async () => {
    const button: HTMLElement = renderPill();
    const describedBy: string | null = button.getAttribute("aria-describedby");

    tap(button);
    await tooltipsShown();

    expect(button.getAttribute("aria-describedby")).toBe(describedBy);
  });

  test("a press asks only why: a row or card it sits in is not opened", () => {
    let opened: number = 0;
    const button: HTMLElement = renderPill(() => {
      opened++;
    });

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });

    expect(opened).toBe(0);

    // The row itself still opens when pressed elsewhere.
    fireEvent.click(screen.getByTestId("row"));
    expect(opened).toBe(1);
  });
});
