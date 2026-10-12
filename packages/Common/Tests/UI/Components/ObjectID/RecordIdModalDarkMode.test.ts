import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Show ID dialog in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css re-colours
 * the light utility classes under html.dark, one rule per class. A class it
 * has no rule for keeps its light colour in the dark theme - a near-white ID
 * row glowing in a slate dialog - and nothing fails. So every colour class
 * the dialog draws with is held to what Theme.css actually remaps.
 */

const COMMON: string = path.join(__dirname, "..", "..", "..", "..");

const DIALOG: string = path.join(
  COMMON,
  "UI",
  "Components",
  "ObjectID",
  "RecordIdModal.tsx",
);

const THEME_CSS: string = fs
  .readFileSync(path.join(COMMON, "UI", "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const DOUBLE_QUOTED: RegExp = /"([^"\n]*)"/g;
const WHITESPACE: RegExp = /\s+/;
const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

// The dialog's code, without its comments: they hold prose, not classes.
const CODE: string = fs
  .readFileSync(DIALOG, "utf8")
  .replace(BLOCK_COMMENT, " ")
  .replace(LINE_COMMENT, " ");

function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(DOUBLE_QUOTED)) {
    for (const token of (match[1] || "").split(WHITESPACE)) {
      if (token) {
        tokens.push(token);
      }
    }
  }

  return tokens;
}

// The utility a token applies, after its variants ("hover:bg-gray-50").
function utilityOf(token: string): string {
  return token.slice(token.lastIndexOf(":") + 1);
}

function isRemapped(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
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

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    stringTokens(CODE).filter((token: string): boolean => {
      return COLOR_UTILITY.test(utilityOf(token));
    }),
  ),
);

describe("the Show ID dialog in the dark theme", () => {
  test("the scan reads the dialog's text, its ID row and the ID", () => {
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The words.
        "text-gray-600",
        // The ID's row.
        "border-gray-200",
        "bg-gray-50",
        // The ID.
        "text-gray-800",
      ]),
    );
  });

  test("uses no dark: variants", () => {
    for (const token of stringTokens(CODE)) {
      expect(token.startsWith("dark:")).toBe(false);
    }
  });

  test("every colour class it uses is remapped for dark mode", () => {
    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the check tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-600")).toBe(true);
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
