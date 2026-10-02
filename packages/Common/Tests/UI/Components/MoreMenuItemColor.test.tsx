import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import React from "react";

/*
 * A menu item that picks a state - "Change state to" in an incident's,
 * alert's, episode's or scheduled maintenance event's header - shows the
 * state's colour in the icon's place, the dot the state dropdowns draw.
 */

const GREEN: string = "#10b981";

function dotOf(item: HTMLElement): HTMLElement | null {
  return item.querySelector('[data-testid="more-menu-item-color"]');
}

// jsdom reports inline colours as rgb(); the tests speak in hex.
function toHex(cssColor: string): string {
  const match: RegExpMatchArray | null = cssColor.match(
    /rgb\((\d+),\s*(\d+),\s*(\d+)\)/,
  );

  if (!match) {
    return cssColor;
  }

  return (
    "#" +
    [match[1], match[2], match[3]]
      .map((part: string | undefined): string => {
        return Number(part).toString(16).padStart(2, "0");
      })
      .join("")
  );
}

function dotColor(item: HTMLElement): string | undefined {
  const inner: HTMLElement | null =
    dotOf(item)?.querySelector<HTMLElement>("span[style]") || null;

  return inner ? toHex(inner.style.backgroundColor) : undefined;
}

afterEach(() => {
  cleanup();
});

describe("MoreMenuItem color", () => {
  test("draws a dot of the colour before the label", () => {
    render(
      <MoreMenuItem
        text="Resolved"
        color={new Color(GREEN)}
        onClick={() => {}}
      />,
    );

    const item: HTMLElement = screen.getByRole("menuitem", {
      name: "Resolved",
    });

    expect(dotColor(item)).toBe(GREEN);

    // Before the label, where an icon would sit.
    const dot: HTMLElement = dotOf(item)!;
    const label: HTMLElement = screen.getByText("Resolved");

    expect(
      dot.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the dot is decoration: the item's name stays the label alone", () => {
    render(
      <MoreMenuItem
        text="Resolved"
        color={new Color(GREEN)}
        onClick={() => {}}
      />,
    );

    const item: HTMLElement = screen.getByRole("menuitem");

    expect(item).toHaveAccessibleName("Resolved");
    expect(item.textContent?.trim()).toBe("Resolved");
    expect(dotOf(item)).toHaveAttribute("aria-hidden", "true");
  });

  test("takes the icon's gutter, so its label lines up with icon items", () => {
    render(
      <MoreMenuItem
        text="Resolved"
        color={new Color(GREEN)}
        onClick={() => {}}
      />,
    );

    const dot: HTMLElement = dotOf(screen.getByRole("menuitem"))!;

    // The same 16px box and 10px gap the item's icon has.
    expect(dot).toHaveClass("h-4", "w-4", "mr-2.5", "shrink-0");
    // The same dot the state dropdowns draw.
    expect(dot.querySelector("span")).toHaveClass(
      "h-2.5",
      "w-2.5",
      "rounded-full",
      "border",
      "border-gray-200",
    );
  });

  test("takes a colour written as a string", () => {
    render(<MoreMenuItem text="Resolved" color={GREEN} onClick={() => {}} />);

    expect(dotColor(screen.getByRole("menuitem"))).toBe(GREEN);
  });

  test("an icon wins over a colour", () => {
    render(
      <MoreMenuItem
        text="Resolved"
        icon={IconProp.Check}
        color={new Color(GREEN)}
        onClick={() => {}}
      />,
    );

    expect(dotOf(screen.getByRole("menuitem"))).toBeNull();
  });

  test.each([
    ["no colour", undefined],
    ["an empty colour", ""],
    ["a blank colour", "   "],
  ])("draws no dot for %s", (_name: string, color: string | undefined) => {
    render(<MoreMenuItem text="Resolved" color={color} onClick={() => {}} />);

    expect(dotOf(screen.getByRole("menuitem"))).toBeNull();
  });

  test("without a dot, a reserved icon gutter is still kept", () => {
    const { container } = render(
      <MoreMenuItem text="Resolved" isIconSpaceReserved onClick={() => {}} />,
    );

    expect(
      container.querySelector('span.mr-2\\.5.h-4.w-4[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(dotOf(screen.getByRole("menuitem"))).toBeNull();
  });

  test("with a dot, the reserved gutter is the dot's, not a second one", () => {
    const { container } = render(
      <MoreMenuItem
        text="Resolved"
        isIconSpaceReserved
        color={new Color(GREEN)}
        onClick={() => {}}
      />,
    );

    expect(
      container.querySelectorAll('span.mr-2\\.5.h-4.w-4[aria-hidden="true"]'),
    ).toHaveLength(1);
  });

  test("still runs its action", () => {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <MoreMenuItem text="Resolved" color={new Color(GREEN)} onClick={onClick} />,
    );

    fireEvent.click(screen.getByRole("menuitem"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
