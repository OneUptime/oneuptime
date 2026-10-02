import "@testing-library/jest-dom";
import { describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import Pill from "../../../UI/Components/Pill/Pill";
import DropdownValueBadge from "../../../UI/Components/Dropdown/DropdownValueBadge";
import { Green } from "../../../Types/BrandColors";
import {
  declaredValue,
  rulesFor,
  StyleRule,
  THEME_RULES,
} from "./ThemeStylesheet";

/*
 * A pill's colours come from any hex a user picks, so no utility class can
 * carry them and Theme.css's usual move - re-colour the light class under
 * html.dark - has nothing to hook. Instead the pill writes its light colours
 * inline and its dark ones as custom properties, and two rules in Theme.css
 * swap the dark ones in. Those rules and the component name the same
 * attributes and properties in two files, and nothing else would notice them
 * drifting apart: the dark theme would quietly keep the light colours.
 */

const PILL_SELECTOR: string = "html.dark [data-ou-pill]";
const DOT_SELECTOR: string = "html.dark [data-ou-pill-dot]";

function customPropertiesRead(selector: string): Array<string> {
  const names: Set<string> = new Set();

  for (const rule of rulesFor(selector)) {
    for (const value of Object.values(rule.declarations)) {
      for (const match of value.matchAll(/var\((--[\w-]+)\)/g)) {
        names.add(match[1]!);
      }
    }
  }

  return Array.from(names);
}

function customPropertiesWritten(element: HTMLElement): Array<string> {
  const names: Array<string> = [];

  for (let i: number = 0; i < element.style.length; i++) {
    const name: string = element.style.item(i);

    if (name.startsWith("--")) {
      names.push(name);
    }
  }

  return names;
}

describe("the pill's dark theme rules", () => {
  test.each([
    ["background-color", "var(--ou-pill-dark-bg) !important"],
    ["color", "var(--ou-pill-dark-text) !important"],
    ["box-shadow", "var(--ou-pill-dark-shadow) !important"],
  ])(
    "the pill takes its dark %s from its custom property",
    (property: string, value: string) => {
      // Important: what it replaces is an inline style.
      expect(declaredValue(PILL_SELECTOR, property)).toBe(value);
    },
  );

  test("the dot takes its dark colour from its custom property", () => {
    expect(declaredValue(DOT_SELECTOR, "background-color")).toBe(
      "var(--ou-pill-dark-dot) !important",
    );
  });

  test("the rules match the attributes the pill renders", () => {
    render(<Pill text="Connected" color={Green} />);

    expect(screen.getByTestId("pill")).toHaveAttribute("data-ou-pill");
    expect(screen.getByTestId("pill-dot")).toHaveAttribute("data-ou-pill-dot");
    expect(rulesFor(PILL_SELECTOR).length).toBeGreaterThan(0);
    expect(rulesFor(DOT_SELECTOR).length).toBeGreaterThan(0);
  });

  test("every property the rules read is one the pill writes", () => {
    render(<Pill text="Connected" color={Green} />);

    const readByPillRule: Array<string> = customPropertiesRead(PILL_SELECTOR);
    const readByDotRule: Array<string> = customPropertiesRead(DOT_SELECTOR);

    expect(readByPillRule.length).toBe(3);
    expect(readByDotRule.length).toBe(1);
    expect(customPropertiesWritten(screen.getByTestId("pill"))).toEqual(
      expect.arrayContaining(readByPillRule),
    );
    expect(customPropertiesWritten(screen.getByTestId("pill-dot"))).toEqual(
      expect.arrayContaining(readByDotRule),
    );
  });

  test("a coloured dropdown value takes the same rules", () => {
    // It paints itself with the pill's colours, so it is themed by its rules.
    const { container } = render(
      <DropdownValueBadge label="Critical" color="#dc2626" />,
    );
    const badge: HTMLElement = container.querySelector<HTMLElement>(
      "[data-ou-pill]",
    ) as HTMLElement;
    const dot: HTMLElement = container.querySelector<HTMLElement>(
      "[data-ou-pill-dot]",
    ) as HTMLElement;

    expect(badge).toHaveAttribute("data-dropdown-value-badge", "true");
    expect(customPropertiesWritten(badge)).toEqual(
      expect.arrayContaining(customPropertiesRead(PILL_SELECTOR)),
    );
    expect(customPropertiesWritten(dot)).toEqual(
      expect.arrayContaining(customPropertiesRead(DOT_SELECTOR)),
    );
  });

  test("a pulsing pill's dot and the ring rippling out of it both get their dark colour", () => {
    /*
     * The Currently Active marker on the timelines. Its dot is two layers -
     * the dot, and a copy of it that grows and fades - and a layer the dot
     * rule missed would pulse in the light theme's colour on a dark card.
     */
    render(<Pill text="Currently Active" color={Green} isPulsing={true} />);

    const layers: Array<HTMLElement> = Array.from(
      screen.getByTestId("pill-dot").children,
    ) as Array<HTMLElement>;

    expect(layers).toHaveLength(2);

    for (const layer of layers) {
      expect(layer).toHaveAttribute("data-ou-pill-dot");
      expect(customPropertiesWritten(layer)).toEqual(
        expect.arrayContaining(customPropertiesRead(DOT_SELECTOR)),
      );
    }
  });

  test("a minimal pill's dot still gets its dark colour", () => {
    /*
     * The minimal pill's ring and text are theme classes Theme.css already
     * re-colours, so it opts out of the pill rule - but its dot is the one
     * computed colour it has.
     */
    render(<Pill text="Acknowledged" color={Green} isMinimal={true} />);

    expect(screen.getByTestId("pill")).not.toHaveAttribute("data-ou-pill");
    expect(customPropertiesWritten(screen.getByTestId("pill-dot"))).toEqual(
      expect.arrayContaining(customPropertiesRead(DOT_SELECTOR)),
    );
  });

  test.each([
    [".text-gray-700", "color"],
    [".ring-gray-200", "--tw-ring-color"],
  ])(
    "the minimal pill's %s is a class Theme.css re-colours",
    (className: string, property: string) => {
      const pill: HTMLElement = renderMinimalPill();

      expect(pill).toHaveClass(className.slice(1));
      expect(
        THEME_RULES.some((rule: StyleRule): boolean => {
          return (
            rule.declarations[property] !== undefined &&
            darkClassesOf(rule).includes(className)
          );
        }),
      ).toBe(true);
    },
  );
});

function renderMinimalPill(): HTMLElement {
  render(<Pill text="Acknowledged" color={Green} isMinimal={true} />);
  return screen.getByTestId("pill");
}

/*
 * The bare classes a dark-theme rule re-colours. Theme.css groups them as
 * `html.dark :is(.a, .b)`, which the reader splits on the commas inside the
 * parentheses, so the group's opening and closing are trimmed off its ends.
 */
function darkClassesOf(rule: StyleRule): Array<string> {
  if (!rule.selectors[0]?.startsWith("html.dark ")) {
    return [];
  }

  return rule.selectors.map((selector: string) => {
    return selector
      .replace(/^html\.dark\s+(:is\(\s*)?/, "")
      .replace(/\s*\)$/, "")
      .trim();
  });
}
