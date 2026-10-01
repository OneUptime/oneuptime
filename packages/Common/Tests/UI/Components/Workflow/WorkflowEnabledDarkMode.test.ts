import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Builder's turned-off notice, its Enabled switch and the dialog that
 * turns a workflow on, in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant. A class without a rule keeps its light colour - a pale amber box on
 * a slate page - and nothing fails. So this holds every colour class these
 * parts use to what Theme.css actually remaps.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

const FILES: Array<string> = [
  "Components/Workflow/WorkflowTurnedOffNotice.tsx",
  "Components/Workflow/WorkflowEnabledSwitch.tsx",
  "Components/Workflow/WorkflowTurnOnModal.tsx",
];

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose, not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

type StringTokensFunction = (code: string) => Array<string>;

// Every whitespace-separated token of every string literal.
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      /\$\{[^}]*\}/g,
      " ",
    );

    tokens.push(
      ...text.split(/\s+/).filter((token: string): boolean => {
        return token.length > 0;
      }),
    );
  }

  return tokens;
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

// A mid-tone hue reads the same in both themes; a grey does not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

type IsRemappedFunction = (token: string) => boolean;

const isRemapped: IsRemappedFunction = (token: string): boolean => {
  const utility: string = utilityOf(token);

  if (SOLID.test(utility)) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
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

describe("the turned-off workflow's notice, switch and dialog in the dark theme", () => {
  test("the scan found the notice's colours, so the check below is not vacuous", () => {
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining(["bg-amber-50", "border-amber-200"]),
    );
  });

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

  test("every colour class is remapped for dark mode", () => {
    const missing: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );

    expect(missing).toEqual([]);
  });

  test("the check does catch a colour with no dark rule", () => {
    expect(isRemapped("bg-amber-50")).toBe(true);
    expect(isRemapped("bg-amber-950")).toBe(false);
  });
});
