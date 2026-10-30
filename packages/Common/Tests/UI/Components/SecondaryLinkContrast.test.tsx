import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as React from "react";
import { RGB } from "../../../Types/Color";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import Button, {
  ButtonStyleType,
  SECONDARY_LINK_HOVER_CLASS_NAME,
  SECONDARY_LINK_TEXT_CLASS_NAME,
} from "../../../UI/Components/Button/Button";

/*
 * SECONDARY_LINK - Show More Details on every monitor's summary, Clear
 * Filters, Dismiss, Show more - was text-gray-400: 2.5:1 on a white card,
 * under WCAG's 4.5:1 for text, and it read as switched off (#5281). It is
 * gray-600 now, gray-900 under the pointer.
 *
 * Held here without a browser: the words' colour and the hover's, as the
 * Tailwind palette paints them on the light cards the links sit on (white,
 * gray-50), and as Theme.css repaints them in the dark theme on its card
 * surfaces - each at least 4.5:1. The SharedUi browser suite measures the
 * drawn colours.
 */

// Tailwind 3.4's grays, as the Dashboard's Tailwind build paints them.
const TAILWIND_GRAYS: Record<string, string> = {
  "gray-50": "#f9fafb",
  "gray-100": "#f3f4f6",
  "gray-200": "#e5e7eb",
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "gray-600": "#4b5563",
  "gray-700": "#374151",
  "gray-800": "#1f2937",
  "gray-900": "#111827",
};

const WCAG_AA_TEXT: number = 4.5;

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
  "utf8",
);

function rgb(color: string): RGB {
  const parsed: RGB | null = parseColor(color);

  if (!parsed) {
    throw new Error(`Not a colour: ${color}`);
  }

  return parsed;
}

// The gray a class like "text-gray-600" or "hover:text-gray-900" names.
function grayOf(className: string, prefix: string): string {
  const token: string | undefined = className
    .split(" ")
    .find((part: string): boolean => {
      return part.startsWith(prefix);
    });

  if (!token) {
    throw new Error(`No ${prefix} class in "${className}"`);
  }

  const shade: string = token.slice(prefix.length);
  const hex: string | undefined = TAILWIND_GRAYS[`gray-${shade}`];

  if (!hex) {
    throw new Error(`Not a gray Tailwind paints: ${token}`);
  }

  return hex;
}

// The body of the first rule whose selector is exactly `selector`.
function ruleBody(selector: string): string {
  const start: number = THEME_CSS.indexOf(`${selector} {`);

  if (start === -1) {
    throw new Error(`Theme.css has no "${selector}" rule`);
  }

  const open: number = THEME_CSS.indexOf("{", start);
  const close: number = THEME_CSS.indexOf("}", open);

  return THEME_CSS.slice(open + 1, close);
}

// A custom property's value in a rule's body.
function tokenIn(body: string, token: string): string {
  const at: number = body.indexOf(`${token}:`);

  if (at === -1) {
    throw new Error(`No ${token} in the rule`);
  }

  const end: number = body.indexOf(";", at);

  return body.slice(at + token.length + 1, end).trim();
}

// The colour Theme.css gives a gray text class in the dark theme.
function darkTextColorOf(shade: string): string {
  const selector: string = `html.dark :is(.text-gray-${shade}`;
  const at: number = THEME_CSS.indexOf(selector);

  if (at === -1) {
    throw new Error(`Theme.css repaints no .text-gray-${shade} in the dark theme`);
  }

  const open: number = THEME_CSS.indexOf("{", at);
  const close: number = THEME_CSS.indexOf("}", open);
  const declaration: string = THEME_CSS.slice(open + 1, close)
    .replace("!important", "")
    .trim();
  const value: string = declaration
    .slice(declaration.indexOf(":") + 1, declaration.indexOf(";"))
    .trim();

  if (value.startsWith("var(")) {
    const token: string = value.slice(4, value.indexOf(")")).trim();
    return tokenIn(ruleBody("html.dark"), token);
  }

  return value;
}

const textGray: string = grayOf(SECONDARY_LINK_TEXT_CLASS_NAME, "text-gray-");
const hoverGray: string = grayOf(
  SECONDARY_LINK_HOVER_CLASS_NAME,
  "hover:text-gray-",
);

const LIGHT_SURFACES: Array<[string, string]> = [
  ["a white card", "#ffffff"],
  ["a gray-50 panel", TAILWIND_GRAYS["gray-50"]!],
];

const DARK_SURFACES: Array<[string, string]> = [
  ["the dark card", tokenIn(ruleBody("html.dark"), "--ou-surface-primary")],
  ["a dark panel", tokenIn(ruleBody("html.dark"), "--ou-surface-secondary")],
];

describe("SECONDARY_LINK reads as a working link: WCAG AA in both themes", () => {
  test.each(LIGHT_SURFACES)(
    "its words are at least 4.5:1 on %s, and so under the pointer",
    (_name: string, surface: string) => {
      expect(getContrastRatio(rgb(textGray), rgb(surface))).toBeGreaterThanOrEqual(
        WCAG_AA_TEXT,
      );
      expect(
        getContrastRatio(rgb(hoverGray), rgb(surface)),
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    },
  );

  test("its words were gray-400, 2.5:1 on white: never a gray that light again", () => {
    expect(SECONDARY_LINK_TEXT_CLASS_NAME).not.toContain("text-gray-400");
    expect(SECONDARY_LINK_TEXT_CLASS_NAME).not.toContain("text-gray-300");
    expect(
      getContrastRatio(rgb(TAILWIND_GRAYS["gray-400"]!), rgb("#ffffff")),
    ).toBeLessThan(WCAG_AA_TEXT);
  });

  test("the pointer darkens it, it never lightens", () => {
    expect(getContrastRatio(rgb(hoverGray), rgb("#ffffff"))).toBeGreaterThan(
      getContrastRatio(rgb(textGray), rgb("#ffffff")),
    );
  });

  test.each(DARK_SURFACES)(
    "in the dark theme its words are at least 4.5:1 on %s",
    (_name: string, surface: string) => {
      const shade: string = SECONDARY_LINK_TEXT_CLASS_NAME.split("text-gray-")[1]!
        .split(" ")[0]!;
      const darkText: string = darkTextColorOf(shade);

      expect(
        getContrastRatio(rgb(darkText), rgb(surface)),
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    },
  );

  test("in the dark theme the pointer lights it in the primary text colour", () => {
    expect(THEME_CSS).toContain(`[class~="${SECONDARY_LINK_HOVER_CLASS_NAME}"]`);
  });
});

describe("a SECONDARY_LINK button carries those classes", () => {
  afterEach(() => {
    cleanup();
  });

  test("its words and, while it can be pressed, its hover", () => {
    render(
      <Button
        title="Show More Details"
        buttonStyle={ButtonStyleType.SECONDARY_LINK}
        onClick={() => {}}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Show More Details",
    });

    for (const className of [
      ...SECONDARY_LINK_TEXT_CLASS_NAME.split(" "),
      SECONDARY_LINK_HOVER_CLASS_NAME,
    ]) {
      expect(button).toHaveClass(className);
    }
    expect(button).not.toHaveClass("text-gray-400");
    expect(button).not.toHaveClass("hover:text-gray-500");
  });

  test("a locked one keeps its words and answers the pointer with nothing", () => {
    render(
      <Button
        title="Clear Filters"
        buttonStyle={ButtonStyleType.SECONDARY_LINK}
        disabled={true}
        onClick={() => {}}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Clear Filters",
    });

    expect(button).toHaveClass("text-gray-600");
    expect(button).not.toHaveClass(SECONDARY_LINK_HOVER_CLASS_NAME);
  });
});
