import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import { RGB } from "../../../Types/Color";
import { StyleRule, THEME_RULES } from "./ThemeStylesheet";

/*
 * Radio buttons and checkboxes in the dark theme (Theme.css).
 *
 * The browser draws its own in the dark scheme: flat neutral-grey discs and
 * squares from no palette of ours, which on the slate card read as holes -
 * a choice card's radios (ChoiceRows) most of all, a row of three of them
 * on every Theme, Access and Sharing card. The dark theme now draws them in
 * its own colours. This holds the sheet to it:
 *
 *   - every radio and checkbox the page shows is drawn by the sheet in the
 *     dark theme, and only there: the light theme keeps the browser's own;
 *   - one hidden to draw a picture of its own (sr-only) is left alone;
 *   - the components keep their sizes and margins: the sheet sets neither
 *     (h-4 w-4 mt-1 line a radio up with its title);
 *   - unchecked is the card with the theme's strong border, 3:1 on it;
 *     checked is the brand indigo, 3:1 on the card, with a white dot or tick
 *     at 4.5:1 on the indigo; partly ticked a white dash;
 *   - a locked one fades, and the keyboard's focus is an indigo ring.
 */

const RADIO: string = 'html.dark input[type="radio"]:not(.sr-only)';
const CHECKBOX: string = 'html.dark input[type="checkbox"]:not(.sr-only)';

// The dark theme's tokens, read from the sheet's own html.dark block.
const DARK_TOKENS: Record<string, string> = ((): Record<string, string> => {
  const block: StyleRule | undefined = THEME_RULES.find(
    (rule: StyleRule): boolean => {
      return rule.selectors.includes("html.dark");
    },
  );

  if (!block) {
    throw new Error("Theme.css has no html.dark block");
  }

  return block.declarations;
})();

const token: (value: string) => string = (value: string): string => {
  const name: string = value.replace("var(", "").replace(")", "").trim();
  const resolved: string | undefined = DARK_TOKENS[name];

  if (!resolved) {
    throw new Error(`No dark value for ${name}`);
  }

  return resolved;
};

const rgb: (value: string) => RGB = (value: string): RGB => {
  const colour: RGB | null = parseColor(value);

  if (!colour) {
    throw new Error(`Not a colour: ${value}`);
  }

  return colour;
};

const WHITE: RGB = { red: 255, green: 255, blue: 255 };

const WHITE_MARK: RegExp = /(fill|stroke)='white'/;

// The rules that name one of the two controls, by selector.
const rulesNaming: (control: string) => Array<StyleRule> = (
  control: string,
): Array<StyleRule> => {
  return THEME_RULES.filter((rule: StyleRule): boolean => {
    return rule.selectors.some((selector: string): boolean => {
      return selector.includes(control);
    });
  });
};

const declarationOf: (
  selector: string,
  property: string,
) => string | undefined = (
  selector: string,
  property: string,
): string | undefined => {
  const values: Array<string> = THEME_RULES.filter(
    (rule: StyleRule): boolean => {
      return (
        rule.selectors.includes(selector) &&
        rule.declarations[property] !== undefined
      );
    },
  ).map((rule: StyleRule): string => {
    return rule.declarations[property] as string;
  });

  return values[values.length - 1];
};

const withoutImportant: (value: string | undefined) => string = (
  value: string | undefined,
): string => {
  return (value || "").replace("!important", "").trim();
};

describe("radios and checkboxes in the dark theme", () => {
  test.each([
    ["radio", RADIO],
    ["checkbox", CHECKBOX],
  ])(
    "a %s is drawn by the sheet, not the browser",
    (_name: string, base: string) => {
      expect(declarationOf(base, "appearance")).toBe("none");
      expect(declarationOf(base, "-webkit-appearance")).toBe("none");
    },
  );

  test("only in the dark theme, and never for a control hidden behind a picture of its own", () => {
    for (const control of ['input[type="radio"]', 'input[type="checkbox"]']) {
      const selectors: Array<string> = rulesNaming(control).flatMap(
        (rule: StyleRule): Array<string> => {
          return rule.selectors.filter((selector: string): boolean => {
            return selector.includes(control);
          });
        },
      );

      expect(selectors.length).toBeGreaterThanOrEqual(5);

      for (const selector of selectors) {
        expect([selector, selector.startsWith("html.dark ")]).toEqual([
          selector,
          true,
        ]);
        expect([selector, selector.includes(":not(.sr-only)")]).toEqual([
          selector,
          true,
        ]);
      }
    }
  });

  test("the components keep their sizes and margins: the sheet sets neither", () => {
    for (const rule of [
      ...rulesNaming('input[type="radio"]'),
      ...rulesNaming('input[type="checkbox"]'),
    ]) {
      for (const property of [
        "width",
        "height",
        "margin",
        "margin-top",
        "vertical-align",
        "flex-shrink",
      ]) {
        expect([
          rule.selectors[0],
          property,
          rule.declarations[property],
        ]).toEqual([rule.selectors[0], property, undefined]);
      }
    }

    // One that sets no size keeps about the browser's own (13px).
    expect(declarationOf(RADIO, "min-width")).toBe("0.875rem");
    expect(declarationOf(RADIO, "min-height")).toBe("0.875rem");
  });

  test("a radio is round and a checkbox a rounded square", () => {
    expect(declarationOf(RADIO, "border-radius")).toBe("9999px");
    expect(declarationOf(CHECKBOX, "border-radius")).toBe("0.25rem");
  });

  test("unchecked: the card, with the strong border that holds 3:1 on it", () => {
    const card: RGB = rgb(
      token(withoutImportant(declarationOf(RADIO, "background-color"))),
    );
    const border: string = withoutImportant(declarationOf(RADIO, "border"));

    expect(withoutImportant(declarationOf(RADIO, "background-color"))).toBe(
      "var(--ou-surface-primary)",
    );
    expect(border).toBe("1px solid var(--ou-border-strong)");
    expect(
      getContrastRatio(rgb(token("var(--ou-border-strong)")), card),
    ).toBeGreaterThanOrEqual(3);
    // Every remap of a border class it may carry (border-gray-300) loses.
    expect(declarationOf(RADIO, "border")).toContain("!important");
    expect(declarationOf(RADIO, "background-color")).toContain("!important");
  });

  test("checked: the brand indigo at 3:1 on the card, its white dot and tick at 4.5:1 on the indigo", () => {
    const card: RGB = rgb(token("var(--ou-surface-primary)"));

    for (const selector of [
      `${RADIO}:checked`,
      `${CHECKBOX}:checked`,
      `${CHECKBOX}:indeterminate`,
    ]) {
      const fill: string = withoutImportant(
        declarationOf(selector, "background-color"),
      );

      expect([selector, fill]).toEqual([selector, "#6366f1"]);
      expect([
        selector,
        withoutImportant(declarationOf(selector, "border-color")),
      ]).toEqual([selector, "#6366f1"]);
      expect(getContrastRatio(rgb(fill), card)).toBeGreaterThanOrEqual(3);
      expect(getContrastRatio(WHITE, rgb(fill))).toBeGreaterThanOrEqual(4.45);
    }

    expect(declarationOf(`${RADIO}:checked`, "background-image")).toContain(
      "circle",
    );
    expect(declarationOf(`${CHECKBOX}:checked`, "background-image")).toContain(
      "path",
    );
    expect(
      declarationOf(`${CHECKBOX}:indeterminate`, "background-image"),
    ).toContain("M4 8h8");

    for (const selector of [
      `${RADIO}:checked`,
      `${CHECKBOX}:checked`,
      `${CHECKBOX}:indeterminate`,
    ]) {
      // Drawn in white: a filled dot or tick, or a stroked dash.
      expect(declarationOf(selector, "background-image")).toMatch(WHITE_MARK);
    }
  });

  test("the hover lightens the edge of an unchecked one only: a checked one keeps its indigo", () => {
    const hovers: Array<string> = THEME_RULES.flatMap(
      (rule: StyleRule): Array<string> => {
        return rule.selectors.filter((selector: string): boolean => {
          return (
            selector.includes(":hover") &&
            (selector.includes('input[type="radio"]') ||
              selector.includes('input[type="checkbox"]'))
          );
        });
      },
    );

    expect(hovers.length).toBe(2);

    for (const selector of hovers) {
      expect(selector).toContain(":not(:checked)");
      expect(selector).toContain(":not(:disabled)");
    }
  });

  test("a locked one fades; the keyboard's focus is an indigo ring", () => {
    expect(declarationOf(`${RADIO}:disabled`, "opacity")).toBe("0.5");
    expect(declarationOf(`${CHECKBOX}:disabled`, "opacity")).toBe("0.5");
    expect(declarationOf(`${RADIO}:focus-visible`, "outline")).toBe(
      "2px solid #818cf8",
    );
    expect(declarationOf(`${CHECKBOX}:focus-visible`, "outline")).toBe(
      "2px solid #818cf8",
    );
  });

  test("the pictures carry no address but their own: nothing is fetched to draw them", () => {
    const css: string = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );

    for (const rule of [
      ...rulesNaming('input[type="radio"]'),
      ...rulesNaming('input[type="checkbox"]'),
    ]) {
      const image: string | undefined = rule.declarations["background-image"];

      if (image) {
        expect(image.startsWith('url("data:image/svg+xml,')).toBe(true);
      }
    }

    expect(css).toContain("Radio buttons and checkboxes.");
  });
});
