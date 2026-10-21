import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The value picker in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant. A class without a rule keeps its light colour - an indigo-50 chip
 * glowing on a slate dialog - and nothing fails. So this holds every colour
 * class the picker's parts use to what Theme.css actually remaps.
 *
 * The walk covers every file the picker draws with: the chip editor and its
 * field, the list and the popup it opens in, the typed settings' field, the
 * Insert value button, the chip itself, and the record editor's cells and the
 * Schedule trigger, which use them. The browser suite checks a chip's and
 * the list's computed colours in the dark theme too.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "..", "UI");

const FILES: Array<string> = [
  "Components/Workflow/ValuePicker/ReferenceChip.tsx",
  "Components/Workflow/ValuePicker/TemplateTextEditor.tsx",
  "Components/Workflow/ValuePicker/ValueTextField.tsx",
  "Components/Workflow/ValuePicker/ValueSingleField.tsx",
  "Components/Workflow/ValuePicker/ValuePickerMenu.tsx",
  "Components/Workflow/ValuePicker/ValuePickerPopup.tsx",
  "Components/Workflow/ValuePicker/InsertValueButton.tsx",
  "Components/Workflow/ColumnEditor/ColumnValueInput.tsx",
  "Components/Workflow/CronScheduleField.tsx",
];

/*
 * Right in both themes on purpose:
 * - the path box's Insert button, white on solid indigo, and its hover - a
 *   solid primary button, like Button's own;
 * - the error under a field, the light red every form field's error is
 *   (Input, TextArea), which is if anything easier to read on dark.
 */
const SAME_IN_BOTH_THEMES: Array<string> = [
  "text-white",
  "hover:bg-indigo-700",
  "text-red-400",
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

// A mid-tone hue (500/600) reads the same in both themes; greys do not.
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

describe("the value picker in the dark theme", () => {
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

  test("every colour class the picker uses is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token) && !SAME_IN_BOTH_THEMES.includes(token);
      },
    );

    // The scan found the picker's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The chip, and its warning tone.
        "border-indigo-200",
        "bg-indigo-50",
        "text-indigo-700",
        "border-amber-200",
        "bg-amber-50",
        "text-amber-700",
        // The field, its { } button and the list.
        "bg-white",
        "border-gray-300",
        "border-gray-200",
        "text-gray-500",
        "hover:bg-indigo-50",
        "hover:text-indigo-600",
        "text-gray-900",
        "text-gray-400",
        "bg-gray-50",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
