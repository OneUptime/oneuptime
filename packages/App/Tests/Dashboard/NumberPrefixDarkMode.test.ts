import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Number Prefix pages' own markup: the prefix chip, the example number
 * and the live preview under each field (Components/NumberPrefix).
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class. A class it
 * has no rule for keeps its light colour in the dark theme - a pale chip on a
 * slate card - and nothing fails. So this holds every colour class these
 * components use to what Theme.css actually remaps, reading every module of
 * the folder, .ts as well as .tsx.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NumberPrefix",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

const MODULES: Array<string> = fs
  .readdirSync(COMPONENT_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts") || file.endsWith(".tsx");
  })
  .sort();

// Comments hold prose, not classes.
const CODE: string = MODULES.map((file: string): string => {
  return fs
    .readFileSync(path.join(COMPONENT_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}).join("\n");

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

function stringTokens(code: string): Array<string> {
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
}

// The utility a token applies, after its variants.
function utilityOf(token: string): string {
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
}

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

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

describe("the Number Prefix components in the dark theme", () => {
  test("reads every module of the folder", () => {
    expect(MODULES).toEqual(
      expect.arrayContaining([
        "NumberPrefixCard.tsx",
        "NumberPrefixExample.tsx",
        "NumberPrefixSettings.ts",
        "MovedNumberPrefixPageRedirect.tsx",
      ]),
    );
  });

  test("use no dark: variants and build no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring|divide)-\$\{/);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the chip, the example and the preview at all.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining(["bg-gray-100", "text-gray-900", "text-gray-500"]),
    );

    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("bg-gray-100")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
