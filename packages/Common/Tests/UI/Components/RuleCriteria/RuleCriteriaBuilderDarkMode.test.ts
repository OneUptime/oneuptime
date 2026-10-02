import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The rule conditions builder in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant (`.bg-gray-50` does not cover `hover:bg-gray-50`). A class without a
 * rule keeps its light colour - a white card on a slate dialog - and nothing
 * fails. So this holds every colour class the builder and its summary use to
 * what Theme.css actually remaps.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

const FILES: Array<string> = [
  "Components/RuleCriteria/RuleCriteriaBuilder.tsx",
  "Components/RuleCriteria/RuleCriteriaSummary.tsx",
  "Components/RuleCriteria/RuleCriteriaModelForm.tsx",
  "Components/RuleCriteria/RuleCriteriaModelTable.tsx",
  "Components/RuleCriteria/RuleCriteriaFields.ts",
];

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose ("a white card"), not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: the template
 * literals' own text, and every quoted string - including the ones inside a
 * template's ${...}, where the builder picks between two class lists.
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 icon, ring or error text) reads the same in
 * both themes. Neutral greys do not, so a grey is only fine where a rule of
 * its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class built from a template, which no scan could check.
const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

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
  const utility: string = utilityOf(token);

  if (SOLID.test(utility)) {
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

describe("the rule conditions builder in the dark theme", () => {
  test("no part uses a dark: variant or builds a colour class from a template", () => {
    for (const [file, code] of Object.entries(CODE_BY_FILE)) {
      expect({ file, usesDarkVariant: code.includes("dark:") }).toEqual({
        file,
        usesDarkVariant: false,
      });
      expect({
        file,
        templatedColour: TEMPLATED_COLOUR.test(code),
      }).toEqual({ file, templatedColour: false });
    }
  });

  test("every colour class the builder uses is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );

    // The scan found the builder's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The card, the empty state's dashed outline and its icon tile.
        "bg-white",
        "border-gray-200",
        "border-gray-300",
        "bg-indigo-50",
        // The Match all / Match any choice.
        "bg-gray-50",
        "text-gray-900",
        "text-gray-600",
        "hover:text-gray-900",
        // "If", and the And / Or words on later rows.
        "text-gray-700",
        "bg-blue-50",
        "text-blue-700",
        "border-blue-200",
        "bg-amber-50",
        "text-amber-700",
        "border-amber-200",
        // Hints and problems.
        "text-gray-500",
        "text-red-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
