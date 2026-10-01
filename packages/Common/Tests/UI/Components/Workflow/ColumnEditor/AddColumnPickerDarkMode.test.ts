import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Add a field" list and the two bodies it sits in, in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class with no
 * rule keeps its light colour in the dark theme - a white panel on a slate
 * modal - and nothing fails. So this holds every colour class these files use
 * to what Theme.css actually remaps.
 */

const COLUMN_EDITOR_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "Workflow",
  "ColumnEditor",
);

const FILES: Array<string> = [
  "AddColumnPicker.tsx",
  "ModelRecordForm.tsx",
  "ModelQueryBuilder.tsx",
];

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Styles",
  "Theme.css",
);

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (fileName: string) => string;

// Comments hold prose ("a white panel"), not classes.
const readCode: ReadCodeFunction = (fileName: string): string => {
  return fs
    .readFileSync(path.join(COLUMN_EDITOR_DIRECTORY, fileName), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

const DOUBLE_QUOTED: RegExp = /"([^"\n]*)"/g;
const TEMPLATE_LITERAL: RegExp = /`([^`]*)`/g;
const TEMPLATE_HOLE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: class lists are
 * string literals here, and prose tokens never look like a utility.
 *
 * Double-quoted strings are read wherever they are, including inside a
 * template literal's ${...} - the active option's colour is chosen there - and
 * then each template literal's own text, with its holes taken out.
 */
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const texts: Array<string> = [
    ...Array.from(code.matchAll(DOUBLE_QUOTED), (match: RegExpMatchArray) => {
      return match[1] || "";
    }),
    ...Array.from(
      code.matchAll(TEMPLATE_LITERAL),
      (match: RegExpMatchArray) => {
        return (match[1] || "").replace(TEMPLATE_HOLE, " ");
      },
    ),
  ];

  return texts.flatMap((text: string): Array<string> => {
    return text.split(WHITESPACE).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
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
    const character: string = token[i]!;

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
 * A mid-tone hue (a 500 or 600 ring or icon) reads the same in both themes.
 * Neutral greys do not, so a grey is only fine where a rule says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith, never
 * includes.
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

  // CSS escaping, as Theme.css writes the class: backslashes first.
  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
};

describe("the field picker in the dark theme", () => {
  test("the guard tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("text-gray-900")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    // A made-up shade no stylesheet will ever remap.
    expect(isRemapped("bg-gray-55")).toBe(false);
    expect(isRemapped("md:bg-white")).toBe(false);
  });

  for (const fileName of FILES) {
    test(`${fileName} uses no dark: variant and builds no colour class from a template`, () => {
      const code: string = readCode(fileName);

      expect(code).not.toContain("dark:");
      expect(code).not.toMatch(
        /(?:bg|text|border|ring|divide|from|via|to)-\$\{/,
      );
    });
  }

  test("every colour class the picker and its two bodies use is remapped", () => {
    const tokens: Array<string> = Array.from(
      new Set(
        FILES.flatMap((fileName: string): Array<string> => {
          return stringTokens(readCode(fileName)).filter(
            (token: string): boolean => {
              return COLOR_UTILITY.test(utilityOf(token));
            },
          );
        }),
      ),
    );

    // The scan found the picker's colours at all, so this is not vacuous.
    expect(tokens).toEqual(
      expect.arrayContaining([
        // The panel and its trigger.
        "bg-white",
        "border-gray-200",
        "border-gray-300",
        "text-gray-700",
        "hover:bg-gray-50",
        // Each field: its name, its kind of value, its description.
        "text-gray-900",
        "bg-gray-100",
        "text-gray-600",
        "text-gray-500",
        "text-gray-400",
        // The option the keyboard is on.
        "bg-indigo-50",
        // "Add a column by name".
        "text-indigo-600",
        "hover:text-indigo-700",
      ]),
    );

    const unmapped: Array<string> = tokens.filter((token: string): boolean => {
      return !isRemapped(token);
    });

    expect(unmapped).toEqual([]);
  });
});
