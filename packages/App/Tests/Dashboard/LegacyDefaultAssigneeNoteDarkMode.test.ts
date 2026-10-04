import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The line under a grouping rule's Episode Owners that names an old default
 * assignee (Components/GroupingRule/LegacyDefaultAssigneeNote), in the dark
 * theme: its box, its text and its Add as owners and Remove buttons.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A
 * class it has no rule for keeps its light colour - a pale box glowing on a
 * slate dialog - and nothing fails. So this holds every colour class the
 * line draws with to what Theme.css actually remaps. Its chips are the
 * people picker's own (OwnersPickerDarkMode covers them).
 *
 * Rendering is covered in Common/Tests/App/Dashboard/LegacyDefaultAssigneeNote.test.tsx.
 */

const SOURCE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "GroupingRule",
  "LegacyDefaultAssigneeNote.tsx",
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

// Comments hold prose, not classes.
const CODE: string = fs
  .readFileSync(SOURCE_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/.*$/gm, " ");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_VALUE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

// Every whitespace-separated token of every string literal in the module.
function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(STRING_LITERAL)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      TEMPLATE_VALUE,
      " ",
    );

    tokens.push(
      ...text.split(WHITESPACE).filter((token: string): boolean => {
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

// A mid-tone hue reads the same in both themes; a neutral grey does not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const SUBSTRING_VARIANT: RegExp = /\[class\*="([^"]+)"\]/g;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-indigo-"].
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_VARIANT),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
  const utility: string = utilityOf(token);

  // An unprefixed mid-tone hue; a prefixed one needs a rule of its own.
  if (utility === token && SOLID.test(utility)) {
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

  // A focus ring's mid-tone colour reads the same in both themes.
  if (token.startsWith("focus-visible:") && SOLID.test(utility)) {
    return true;
  }

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

const TOKENS: Array<string> = stringTokens(CODE);

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    TOKENS.filter((token: string): boolean => {
      return COLOR_UTILITY.test(utilityOf(token));
    }),
  ),
);

describe("the old default assignee's line in the dark theme", () => {
  test("uses no dark: variants and builds no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring)-\$\{/);
  });

  test("every colour class the line draws with is remapped for dark mode", () => {
    // The scan found the line's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The box.
        "bg-gray-50",
        "border-gray-200",
        // Its title and its sentence.
        "text-gray-900",
        "text-gray-600",
        // Add as owners.
        "bg-white",
        "border-gray-300",
        "text-gray-700",
        "hover:bg-gray-50",
        // Remove.
        "hover:bg-gray-100",
        // The names could not be loaded.
        "text-red-600",
        // The keyboard focus ring.
        "focus-visible:ring-indigo-500",
      ]),
    );

    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the scan judges a variant by its own rule", () => {
    expect(utilityOf("hover:bg-gray-100")).toBe("bg-gray-100");
    expect(isRemapped("hover:bg-gray-100")).toBe(true);
    // A light shade under a variant Theme.css does not know is caught.
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
  });
});
