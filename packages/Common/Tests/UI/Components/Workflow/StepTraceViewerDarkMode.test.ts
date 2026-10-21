import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A workflow run's Steps view in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant. A class without a rule keeps its light colour - a pale amber
 * warning box or a white "Took No" chip on a slate dialog - and nothing fails.
 * So this holds every colour class the run modal draws with to what Theme.css
 * actually remaps.
 *
 * Unlike a scan of whole string literals, this one also reads the quoted
 * strings inside a template's ${...}: the viewer picks a step's colours with
 * `${isFailed ? "border-red-200" : "border-gray-200"}`, and those branches are
 * exactly the colours worth checking.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

const FILES: Array<string> = [
  "Components/Workflow/StepTraceViewer.tsx",
  "Components/Workflow/WorkflowLogModal.tsx",
  "Components/Workflow/BreakableCode.tsx",
  // Copy log and Download, above the modal's tabs.
  "Components/Workflow/WorkflowRunExportActions.tsx",
];

/*
 * Right in both themes on purpose: the white step number and cross on the
 * path's solid dots (emerald, amber and red 500, which Theme.css leaves as
 * they are because they read on either surface).
 */
const SAME_IN_BOTH_THEMES: Array<string> = ["text-white"];

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose ("a pale amber warning box"), not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
};

type TokensFunction = (code: string) => Array<string>;

const splitTokens: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text.split(/\s+/).filter((token: string): boolean => {
    return token.length > 0;
  });
};

/*
 * Every whitespace-separated token of every quoted string (wherever it sits,
 * including inside a template's ${...}) and of every template's own text.
 */
const stringTokens: TokensFunction = (code: string): Array<string> => {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"/g)) {
    tokens.push(...splitTokens(match[1] || ""));
  }

  for (const match of code.matchAll(/`([^`]*)`/g)) {
    tokens.push(...splitTokens((match[1] || "").replace(/\$\{[^}]*\}/g, " ")));
  }

  return tokens;
};

type UtilityOfFunction = (token: string) => string;

/*
 * The utility a token applies, after its variants. An arbitrary variant's
 * brackets may hold a colon of their own, so the split skips anything inside
 * brackets.
 */
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
 * A mid-tone hue (a 500 or 600 dot or icon) reads the same in both themes.
 * Neutral greys do not: Theme.css re-colours gray text for a dark card, so a
 * grey is only fine where a rule of its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class built from a template, which no scan could check.
const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="focus-visible:ring-indigo-"]:focus-visible.
 */
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

  // CSS escaping, as Theme.css writes the class.
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

describe("the workflow run's Steps view in the dark theme", () => {
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

  test("every colour class it draws with is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token) && !SAME_IN_BOTH_THEMES.includes(token);
      },
    );

    // The scan found the view's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The step card and the path between steps.
        "bg-white",
        "border-gray-200",
        "bg-gray-200",
        "ring-white",
        // The dots: worked, warned, failed (chosen in a ${...}).
        "bg-emerald-500",
        "bg-amber-500",
        "bg-red-500",
        // "Took No", and the red "Took Error".
        "border-indigo-200",
        "bg-indigo-50",
        "text-indigo-700",
        "text-red-700",
        // Succeeded and Failed.
        "bg-emerald-50",
        "text-emerald-700",
        // The warning, the error and the test-of-one-step note.
        "bg-amber-50",
        "border-amber-200",
        "text-amber-800",
        "bg-red-50",
        "border-red-200",
        "text-red-800",
        "bg-blue-50",
        "border-blue-100",
        "text-blue-800",
        // The end of a sleeping run's path.
        "bg-indigo-500",
        "text-indigo-800",
        // Values.
        "text-gray-900",
        "text-gray-800",
        "bg-gray-50",
        // Copy log and Download in the header, and the copy's tick or cross.
        "text-gray-500",
        "hover:bg-gray-100",
        "hover:text-gray-700",
        "text-emerald-600",
        "text-red-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * The scan is only worth something if it would notice a class with no dark
   * rule. Prove it on one that has none.
   */
  test("the scan does notice a colour with no dark rule", () => {
    expect(isRemapped("bg-amber-50")).toBe(true);
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("bg-lime-50")).toBe(false);
    expect(isRemapped("text-gray-450")).toBe(false);
  });
});
