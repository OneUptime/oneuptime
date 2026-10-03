import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import Pagination, {
  ARROW_CLASS_NAME,
  ComponentProps,
} from "../../../UI/Components/Pagination/Pagination";
import { THEME_RULES, StyleRule, declaredValue } from "./ThemeStylesheet";

/*
 * The pagination bar in the dark theme.
 *
 * The dark theme is not a second set of classes: Common/UI/Styles/Theme.css
 * remaps the light utilities a component already uses (bg-white, text-gray-500,
 * hover:bg-gray-100 ...) once <html> carries .dark. A utility with no remap
 * keeps its light colour and paints a light patch on a dark card - which is
 * what the old bar did with `disabled:bg-gray-50` on its select while a page
 * loaded, and why a dead arrow drawn in text-gray-300 (remapped to a LIGHT
 * slate) shone brighter than a live one.
 *
 * So every colour utility the bar draws, in every state, must be one the
 * stylesheet remaps. A colour added without a remap fails here first.
 */

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

const baseProps: ComponentProps = {
  currentPageNumber: 12,
  totalItemsCount: 240,
  itemsOnPage: 10,
  onNavigateToPage: jest.fn(),
  isLoading: false,
  isError: false,
  singularLabel: "Monitor",
  pluralLabel: "Monitors",
};

// The states worth drawing, with every element each one can put on the bar.
const STATES: Array<[string, Partial<ComponentProps>]> = [
  ["deep in a long list", {}],
  ["on the first page", { currentPageNumber: 1 }],
  ["on the last page", { currentPageNumber: 24 }],
  ["while loading", { isLoading: true }],
  ["frozen by the caller", { isDisabled: true }],
  ["after an error", { isError: true }],
  ["with nothing to page", { currentPageNumber: 1, totalItemsCount: 0 }],
  ["on a short list", { currentPageNumber: 2, totalItemsCount: 30 }],
  [
    "in the compact skin under the logs",
    { isCompact: true, className: "bg-gray-50/50" },
  ],
  [
    "when the total is unknown",
    {
      currentPageNumber: 3,
      totalItemsCount: 31,
      itemsOnCurrentPage: 10,
      hasMore: true,
    },
  ],
];

const COLOUR_NAMES: string =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

// bg-white, text-gray-500, hover:bg-gray-100, ring-indigo-200, bg-gray-50/50 ...
const COLOUR_UTILITY: RegExp = new RegExp(
  `^(bg|text|border|ring|divide|placeholder|outline|fill|stroke|from|via|to)-(white|black|(${COLOUR_NAMES})-\\d{2,3})(\\/\\d{1,3})?$`,
);

function utilityOf(token: string): string {
  return token.split(":").pop() || "";
}

function colourTokensIn(root: Element): Array<string> {
  const tokens: Set<string> = new Set<string>();

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const token of (element.getAttribute("class") || "").split(/\s+/)) {
      if (token && COLOUR_UTILITY.test(utilityOf(token))) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens).sort();
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/*
 * Whether Theme.css remaps the class: as a class selector for a plain
 * utility, by its exact token in a [class~="..."] selector, or by a prefix in
 * a [class*="..."] one (`[class*="focus-visible:ring-indigo-"]`).
 */
function isRemappedForDarkTheme(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    !token.includes(":") &&
    !token.includes("/") &&
    new RegExp(`\\.${escapeForRegExp(token)}(?![\\w-])`).test(THEME_CSS)
  ) {
    return true;
  }

  const prefixes: Array<string> = Array.from(
    THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  return prefixes.some((prefix: string): boolean => {
    return token.startsWith(prefix);
  });
}

/*
 * The dark-theme colour Theme.css gives a text utility, with a var() resolved
 * against html.dark.
 */
function darkTextColour(className: string): string {
  const pattern: RegExp = new RegExp(`\\.${className}(?![\\w-])`);

  const rule: StyleRule | undefined = THEME_RULES.find(
    (candidate: StyleRule): boolean => {
      return (
        candidate.declarations["color"] !== undefined &&
        candidate.selectors.join(",").startsWith("html.dark") &&
        pattern.test(candidate.selectors.join(","))
      );
    },
  );

  if (!rule) {
    throw new Error(`Theme.css gives ${className} no dark colour`);
  }

  const value: string = rule.declarations["color"]!.replace(
    "!important",
    "",
  ).trim();
  const variable: RegExpMatchArray | null = value.match(/^var\((--[\w-]+)\)$/);

  if (!variable) {
    return value;
  }

  const resolved: string | undefined = declaredValue("html.dark", variable[1]!);

  if (!resolved) {
    throw new Error(`Theme.css declares no ${variable[1]} for html.dark`);
  }

  return resolved;
}

function luminance(hex: string): number {
  const match: RegExpMatchArray | null = hex.match(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,
  );

  if (!match) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }

  const channel: (value: string) => number = (value: string): number => {
    const srgb: number = parseInt(value, 16) / 255;

    return srgb <= 0.04045
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * channel(match[1]!) +
    0.7152 * channel(match[2]!) +
    0.0722 * channel(match[3]!)
  );
}

afterEach(() => {
  cleanup();
});

describe("the pagination bar in the dark theme", () => {
  test.each(STATES)(
    "remaps every colour it draws %s",
    (_state: string, overrides: Partial<ComponentProps>) => {
      render(
        <Pagination {...baseProps} {...overrides} dataTestId="dark-bar" />,
      );

      const tokens: Array<string> = colourTokensIn(
        screen.getByTestId("dark-bar"),
      );

      expect(tokens.length).toBeGreaterThan(4);
      expect(
        tokens.filter((token: string): boolean => {
          return !isRemappedForDarkTheme(token);
        }),
      ).toEqual([]);
    },
  );

  test("the check can fail: a light-only class is caught", () => {
    expect(isRemappedForDarkTheme("disabled:bg-gray-50")).toBe(false);
    expect(isRemappedForDarkTheme("bg-gray-25")).toBe(false);
    expect(isRemappedForDarkTheme("text-gray-500")).toBe(true);
    expect(isRemappedForDarkTheme("hover:bg-gray-100")).toBe(true);
    expect(isRemappedForDarkTheme("focus-visible:ring-indigo-500")).toBe(true);
  });

  /*
   * Why a dead arrow fades instead of turning a paler grey: the dark theme
   * lifts text-gray-300 to a LIGHT slate, brighter than the text-gray-500 a
   * live arrow is drawn in.
   */
  test("a paler grey would have made a dead arrow brighter than a live one", () => {
    expect(luminance(darkTextColour("text-gray-300"))).toBeGreaterThan(
      luminance(darkTextColour("text-gray-500")),
    );
  });

  test("so a dead arrow keeps the live arrow's colour and only fades", () => {
    render(<Pagination {...baseProps} currentPageNumber={1} />);

    const dead: HTMLElement = screen.getByTestId("pagination-previous-button");
    const live: HTMLElement = screen.getByTestId("pagination-next-button");

    expect(live).toHaveClass(...ARROW_CLASS_NAME.split(" "));
    expect(dead).toHaveClass("text-gray-500", "opacity-40");
    expect(live).toHaveClass("text-gray-500");
    expect(live).not.toHaveClass("opacity-40");
  });

  test("nothing on the bar is drawn in text-gray-300, in any state", () => {
    for (const [, overrides] of STATES) {
      render(
        <Pagination {...baseProps} {...overrides} dataTestId="dark-bar" />,
      );

      expect(
        screen.getByTestId("dark-bar").querySelectorAll(".text-gray-300"),
      ).toHaveLength(0);

      cleanup();
    }
  });

  test("the current page's chip is remapped as a whole", () => {
    render(<Pagination {...baseProps} />);

    for (const token of [
      "bg-indigo-50",
      "text-indigo-700",
      "ring-indigo-200",
    ]) {
      expect(screen.getByTestId("pagination-page-12")).toHaveClass(token);
      expect(isRemappedForDarkTheme(token)).toBe(true);
    }
  });
});
