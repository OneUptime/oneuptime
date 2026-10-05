import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The agent version's sign and the upgrade dialog in the dark theme
 * (Components/AgentVersion/AgentVersion.tsx and AgentUpgradeModal.tsx): the
 * amber chip and sign, the version's hover colour, the dialog's note and
 * link, and the keyboard focus rings.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-amber-50` does not cover `hover:bg-amber-50`). A
 * class it has no rule for keeps its light colour - a pale chip glowing on a
 * slate card - and nothing fails. So this holds every colour class the two
 * draw with to what Theme.css actually remaps.
 *
 * Rendering is covered in Common/Tests/App/Dashboard/AgentVersion.test.tsx.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "AgentVersion",
);

const SOURCES: Array<string> = ["AgentVersion.tsx", "AgentUpgradeModal.tsx"];

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
const CODE: string = SOURCES.map((name: string): string => {
  return fs
    .readFileSync(path.join(COMPONENT_DIR, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}).join("\n");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_VALUE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

// Every whitespace-separated token of every string literal in the modules.
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

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-amber-"].
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

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    stringTokens(CODE).filter((token: string): boolean => {
      return COLOR_UTILITY.test(utilityOf(token));
    }),
  ),
);

describe("the agent version sign and the upgrade dialog in the dark theme", () => {
  test("use no dark: variants and build no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring)-\$\{/);
  });

  test("every colour class they draw with is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The hero's gray chip, as the heroes always drew it.
        "border-gray-200",
        "bg-gray-50",
        "text-gray-700",
        "text-gray-500",
        // The outdated chip.
        "border-amber-200",
        "bg-amber-50",
        "text-amber-800",
        "hover:bg-amber-100",
        "hover:text-amber-900",
        "text-amber-600",
        // The sign beside a version, and the version on hover.
        "text-amber-500",
        "hover:text-amber-700",
        // The dialog's link to the setup guide.
        "text-indigo-600",
        "hover:text-indigo-700",
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
    expect(utilityOf("hover:text-amber-900")).toBe("text-amber-900");
    expect(isRemapped("hover:text-amber-900")).toBe(true);
    // A light shade under a variant Theme.css does not know is caught.
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
    expect(isRemapped("hover:bg-amber-200")).toBe(false);
  });
});
