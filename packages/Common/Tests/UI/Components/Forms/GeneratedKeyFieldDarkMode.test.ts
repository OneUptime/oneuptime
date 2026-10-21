import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme - gray-800 key text on a gray-900 dialog - and nothing fails.
 *
 * So this reads GeneratedKeyField's source - the "Key  time-to-detect  Edit"
 * line under a Name field, on every form with a key made from the name -
 * and holds every colour class it draws with to what Theme.css remaps.
 */

const COMPONENT_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "Forms",
  "Fields",
  "GeneratedKeyField.tsx",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Styles",
  "Theme.css",
);

const CODE: string = fs
  .readFileSync(COMPONENT_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:text-indigo-800` only with a rule of its own.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 hue reads the same on both themes (a focus ring, a
 * fill). Never a grey: grey text is exactly what has to be lightened.
 */
const SAME_IN_BOTH_THEMES: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate|zinc|neutral|stone)[a-z]+-(?:500|600)$/;

/*
 * The shared Input's own error colour, which the line repeats so an error
 * reads the same open or closed: a light red that is legible on both.
 */
const SHARED_ERROR_COLOR: string = "text-red-400";

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class put together at run time, which no scan can check.
const TEMPLATE_COLOR_TOKEN: RegExp = /(bg|text|border|ring)-\$\{/;

const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (SAME_IN_BOTH_THEMES.test(utility) || token === SHARED_ERROR_COLOR) {
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
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

describe("GeneratedKeyField in the dark theme", () => {
  const tokens: Array<string> = Array.from(
    new Set(
      Array.from(CODE.matchAll(COLOR_TOKEN), (match: RegExpMatchArray) => {
        return match[1]!;
      }),
    ),
  );

  test("the scan finds the line's colours, so the check is not vacuous", () => {
    expect(tokens).toEqual(
      expect.arrayContaining([
        "text-gray-700",
        "bg-gray-100",
        "text-gray-800",
        "text-gray-500",
        "text-indigo-600",
        "hover:text-indigo-800",
      ]),
    );
  });

  test("draws with no dark: variants and builds no colour class from a template", () => {
    expect(CODE.includes("dark:")).toBe(false);
    expect(TEMPLATE_COLOR_TOKEN.test(CODE)).toBe(false);
  });

  test("every colour class it draws with is remapped for dark mode", () => {
    expect(
      tokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
