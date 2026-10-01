import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Add Component / Add Trigger picker in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant (`.bg-gray-50` does not cover `hover:bg-gray-50`). A class without a
 * rule keeps its light colour - a near-white tile on a slate panel - and
 * nothing fails. So this holds every colour class the picker uses to what
 * Theme.css actually remaps.
 *
 * The old picker drew its cards with inline styles and hex colours
 * (#6366f1, #ffffff), which no stylesheet can re-colour; the picker now has
 * none, and this keeps it that way.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "..", "UI");

const FILES: Array<string> = [
  "Components/Workflow/ComponentsModal.tsx",
  "Components/Workflow/ComponentPicker/PickerItems.tsx",
  // The keyboard hints in the footer.
  "Components/KeyboardShortcut/KeyboardShortcut.tsx",
];

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose ("a near-white tile"), not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: the fixed text
 * of each template literal, and each double-quoted string wherever it is -
 * including the branches of a `${isActive ? "bg-indigo-50" : ""}` inside a
 * template, which is where a state's colour usually lives.
 */
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const texts: Array<string> = [];

  for (const match of code.matchAll(/`([^`]*)`/g)) {
    texts.push((match[1] || "").replace(/\$\{[^}]*\}/g, " "));
  }

  for (const match of code.matchAll(/"([^"\n]*)"/g)) {
    texts.push(match[1] || "");
  }

  return texts.flatMap((text: string): Array<string> => {
    return text.split(/\s+/).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
};

type UtilityOfFunction = (token: string) => string;

// The utility a token applies, after its variants.
const utilityOf: UtilityOfFunction = (token: string): string => {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let i: number = 0; i < token.length; i++) {
    const character: string = token.charAt(i);

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = i;
    }
  }

  return token.slice(lastColon + 1);
};

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 icon or fill) reads the same in both themes.
 * Neutral greys do not.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

// A colour written out, which no stylesheet can re-colour.
const HEX_COLOUR: RegExp = /#[0-9a-fA-F]{3,8}\b/;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-indigo-"].
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

type IsRemappedFunction = (token: string) => boolean;

const isRemapped: IsRemappedFunction = (token: string): boolean => {
  if (SOLID.test(utilityOf(token))) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    SUBSTRING_VARIANTS.some((prefix: string): boolean => {
      return token.startsWith(prefix);
    })
  ) {
    return true;
  }

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string =
      THEME_CSS.charAt(from + escapedClass.length + 1) || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
};

const CODE_BY_FILE: Record<string, string> = {};

for (const file of FILES) {
  CODE_BY_FILE[file] = readCode(file);
}

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    Object.values(CODE_BY_FILE)
      .flatMap(stringTokens)
      .filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
  ),
);

describe("the component picker in the dark theme", () => {
  test("uses no dark: variant, no colour class built from a template, and no inline colour", () => {
    for (const [file, code] of Object.entries(CODE_BY_FILE)) {
      expect({ file, usesDarkVariant: code.includes("dark:") }).toEqual({
        file,
        usesDarkVariant: false,
      });
      expect({
        file,
        templatedColour: TEMPLATED_COLOUR.test(code),
      }).toEqual({ file, templatedColour: false });
      expect({
        file,
        hexColour: HEX_COLOUR.test(code),
      }).toEqual({ file, hexColour: false });
      expect({ file, inlineStyle: code.includes("style={{") }).toEqual({
        file,
        inlineStyle: false,
      });
    }
  });

  test("every colour class the picker uses is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );

    // The scan found the picker's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The panel's surfaces and the sticky search box.
        "bg-white",
        "border-gray-100",
        "border-gray-200",
        "border-gray-300",
        // Text: titles, descriptions, section headings.
        "text-gray-900",
        "text-gray-700",
        "text-gray-600",
        "text-gray-500",
        "text-gray-400",
        "placeholder-gray-400",
        // Icon tiles and the resource / count pills.
        "bg-gray-100",
        // A tile under the pointer, and the search result Enter would add.
        "hover:border-indigo-300",
        "hover:bg-indigo-50",
        "bg-indigo-50",
        "hover:bg-gray-50",
        "hover:bg-gray-100",
        // The words a search matched.
        "text-indigo-700",
        // The list of every resource.
        "divide-gray-100",
        // Back, and the × in the search box.
        "hover:text-gray-900",
        "hover:text-gray-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
