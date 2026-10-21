import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The channel name preview under a rule's Channel Name Prefix field
 * (Components/Workspace/NotificationRuleForm/ChannelNamePreview.tsx). A
 * rule's card names the channel in its Then sentences now, with no prefix
 * chip of its own.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class.
 * A class it has no rule for keeps its light colour in the dark theme - a
 * pale chip on a slate card - and nothing fails. So this holds every colour
 * class the component uses to what Theme.css actually remaps.
 */

const COMPONENT_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Workspace",
  "NotificationRuleForm",
  "ChannelNamePreview.tsx",
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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_EXPRESSION: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;
const TEMPLATED_COLOUR: RegExp = /(?:bg|text|border|ring|divide)-\$\{/;

// Comments hold prose, not classes.
const CODE: string = fs
  .readFileSync(COMPONENT_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ")
  .replace(LINE_COMMENT, " ");

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(STRING_LITERAL)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      TEMPLATE_EXPRESSION,
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

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// Whether Theme.css has a rule for the class, matched as a whole class name.
function isRemapped(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  let from: number = THEME_CSS.indexOf(`.${token}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + token.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${token}`, from + 1);
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

describe("the channel name preview in the dark theme", () => {
  test("use no dark: variants and build no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(TEMPLATED_COLOUR);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the preview's name and its notes at all.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining(["text-gray-900", "text-gray-500"]),
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
