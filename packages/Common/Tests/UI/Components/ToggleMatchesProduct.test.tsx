import Toggle, {
  TOGGLE_TRACK_OFF_CLASS,
  TOGGLE_TRACK_ON_CLASS,
  TOGGLE_TRACK_ON_HOVER_CLASS,
} from "../../../UI/Components/Toggle/Toggle";
import Button, { ButtonStyleType } from "../../../UI/Components/Button/Button";
import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import Input from "../../../UI/Components/Input/Input";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "Can we please improve the UI of the toggle and make it just like how the
 * rest of oneuptime looks like?"
 *
 * The switch takes its look from the controls it sits among in every form,
 * and this suite renders them side by side to hold it there: the primary
 * button's indigo when on, the edge grey of an input and a checkbox when
 * off, the buttons' keyboard ring, and a title and help set the way a
 * checkbox sets its own. If one of those controls changes, the switch is
 * flagged here to follow it, instead of drifting into a look of its own
 * again.
 */

afterEach(() => {
  cleanup();
});

// An outline's colour, as the outlined switch had: border-gray-500.
const OUTLINE_COLOUR_CLASS: RegExp =
  /^(?:hover:)?border-(?:gray|slate|indigo)-/;

function classesOf(element: Element): Array<string> {
  return Array.from(element.classList);
}

// The one class of an element that starts with `prefix` ("bg-", "hover:bg-").
function classStartingWith(element: Element, prefix: string): string {
  const found: Array<string> = classesOf(element).filter(
    (className: string): boolean => {
      return className.startsWith(prefix);
    },
  );

  expect(found).toHaveLength(1);

  return found[0]!;
}

function renderSwitch(value: boolean): HTMLElement {
  render(<Toggle onChange={() => {}} value={value} ariaLabel="Secret" />);

  return screen.getByRole("switch", { name: "Secret" });
}

function primaryButton(): HTMLElement {
  render(<Button title="Save" buttonStyle={ButtonStyleType.PRIMARY} />);

  return screen.getByRole("button", { name: "Save" });
}

describe("the switch looks like the rest of OneUptime", () => {
  test("on, it is filled with the primary button's indigo", () => {
    const buttonFill: string = classStartingWith(primaryButton(), "bg-");

    cleanup();

    const toggle: HTMLElement = renderSwitch(true);

    expect(buttonFill).toBe("bg-indigo-600");
    expect(classStartingWith(toggle, "bg-")).toBe(buttonFill);
    expect(TOGGLE_TRACK_ON_CLASS).toBe(buttonFill);
  });

  test("on, it deepens under the pointer the way the primary button does", () => {
    const buttonHover: string = classStartingWith(primaryButton(), "hover:bg-");

    cleanup();

    const toggle: HTMLElement = renderSwitch(true);

    expect(classStartingWith(toggle, "hover:bg-")).toBe(buttonHover);
    expect(TOGGLE_TRACK_ON_HOVER_CLASS).toBe(buttonHover);
  });

  test("keyboard focus draws the same ring as every button", () => {
    const buttonRing: Array<string> = classesOf(primaryButton()).filter(
      (className: string): boolean => {
        return className.startsWith("focus-visible:ring");
      },
    );

    cleanup();

    const toggle: HTMLElement = renderSwitch(false);

    expect(buttonRing).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
        "focus-visible:ring-offset-2",
      ]),
    );
    expect(classesOf(toggle)).toEqual(expect.arrayContaining(buttonRing));
    expect(
      classesOf(toggle).filter((className: string): boolean => {
        return className.startsWith("focus:ring");
      }),
    ).toEqual([]);
  });

  test("off, its track is the grey an input and a checkbox have for their edge", () => {
    render(<Input placeholder="Field name" />);

    const inputEdge: string = classStartingWith(
      screen.getByPlaceholderText("Field name"),
      "border-gray-",
    );

    cleanup();

    render(<CheckboxElement title="Agree" />);

    const checkboxEdge: string = classStartingWith(
      screen.getByRole("checkbox", { name: "Agree" }),
      "border-gray-",
    );

    cleanup();

    const toggle: HTMLElement = renderSwitch(false);
    const offFill: string = classStartingWith(toggle, "bg-");

    expect(inputEdge).toBe("border-gray-300");
    expect(checkboxEdge).toBe(inputEdge);
    expect(offFill.replace(/^bg-/, "")).toBe(inputEdge.replace(/^border-/, ""));
    expect(TOGGLE_TRACK_OFF_CLASS).toBe(offFill);
  });

  /*
   * A filled pill, as a button is a filled box: the outlined switch was the
   * only control in the product drawn as a dark outline around white.
   */
  test("like the buttons, it has no outline of its own", () => {
    for (const value of [false, true]) {
      const toggle: HTMLElement = renderSwitch(value);

      expect(toggle).toHaveClass("border-transparent");
      expect(
        classesOf(toggle).filter((className: string): boolean => {
          return OUTLINE_COLOUR_CLASS.test(className);
        }),
      ).toEqual([]);

      cleanup();
    }
  });

  test("its title and help are set the way a checkbox sets its own", () => {
    render(<CheckboxElement title="Agree" description="Checkbox help" />);

    const checkboxLabel: HTMLElement = screen.getByText("Agree");
    const checkboxLabelClasses: Array<string> = classesOf(checkboxLabel);
    const checkboxTextColumn: Array<string> = classesOf(
      checkboxLabel.parentElement!,
    );
    const checkboxHelp: Array<string> = classesOf(
      screen.getByText("Checkbox help"),
    );

    cleanup();

    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title="Secret"
        description="Switch help"
      />,
    );

    const switchLabel: HTMLElement = screen
      .getByText("Secret")
      .closest("label")!;

    // The title: the same weight and colour.
    expect(checkboxLabelClasses).toEqual(
      expect.arrayContaining(["font-medium", "text-gray-900"]),
    );
    expect(classesOf(switchLabel)).toEqual(
      expect.arrayContaining(["font-medium", "text-gray-900"]),
    );

    // The line it sits on: the same size and the same 24px line.
    expect(checkboxTextColumn).toEqual(
      expect.arrayContaining(["text-sm", "leading-6"]),
    );
    expect(classesOf(switchLabel.parentElement!)).toEqual(
      expect.arrayContaining(["text-sm", "leading-6"]),
    );

    // The help under it: the same muted grey.
    expect(checkboxHelp).toContain("text-gray-500");
    expect(classesOf(screen.getByText("Switch help"))).toEqual(
      expect.arrayContaining(["text-sm", "text-gray-500"]),
    );
  });

  test("its text starts the same 12px from the control as a checkbox's", () => {
    render(<CheckboxElement title="Agree" />);

    const checkboxTextColumn: HTMLElement =
      screen.getByText("Agree").parentElement!;

    expect(checkboxTextColumn).toHaveClass("ml-3");

    cleanup();

    render(<Toggle onChange={() => {}} value={false} title="Secret" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    // ml-3 and gap-3 are both 0.75rem.
    expect(toggle.parentElement).toHaveClass("flex", "gap-3");
  });

  test("disabled, it refuses the pointer the way a disabled input does", () => {
    render(<Input placeholder="Field name" disabled={true} />);

    expect(screen.getByPlaceholderText("Field name")).toHaveClass(
      "cursor-not-allowed",
    );

    cleanup();

    render(
      <Toggle
        onChange={() => {}}
        value={true}
        ariaLabel="Secret"
        disabled={true}
      />,
    );

    expect(screen.getByRole("switch", { name: "Secret" })).toHaveClass(
      "cursor-not-allowed",
    );
  });
});
