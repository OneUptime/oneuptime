import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A dashboard's Sharing page in the dark theme: the "Who can view this
 * dashboard" card (its public link, the locked-dashboard warning, the Saved
 * status) and the page around it (the IP allowlist's entries).
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.text-indigo-600` does not cover `hover:text-indigo-600`). A
 * class it has no rule for keeps its light colour in the dark theme, and
 * nothing fails. So this holds every colour class the Sharing files use to
 * what Theme.css actually remaps.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const FILES: Array<string> = [
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Dashboard",
    "Sharing",
    "DashboardSharingCard.tsx",
  ),
  path.join(DASHBOARD_SRC, "Pages", "Dashboards", "View", "Sharing.tsx"),
  // The card's ruled, edge-to-edge body takes its classes from here.
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Common",
    "UI",
    "Components",
    "Card",
    "CardSurface.ts",
  ),
];

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
function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

// Every whitespace-separated token of every string literal in the module.
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

// The utility a token applies, after its variants (brackets may hold colons).
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|decoration)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

// A mid-tone hue (500 or 600) reads the same in both themes; greys do not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-indigo-"]:hover.
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
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
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

describe("the Sharing page in the dark theme", () => {
  const code: string = FILES.map(codeOf).join("\n");

  const colorTokens: Array<string> = Array.from(
    new Set(
      stringTokens(code).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );

  test("the files use no dark: variants and build no colour class from a template", () => {
    expect(code).not.toContain("dark:");
    expect(code).not.toMatch(
      /(?:bg|text|border|ring|divide|from|via|to|decoration)-\$\{/,
    );
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the card's colours at all, so this is not vacuous.
    expect(colorTokens).toEqual(
      expect.arrayContaining([
        // The full-bleed rule above the choices.
        "border-gray-200",
        // The public link's title, and the link itself.
        "text-gray-700",
        "text-indigo-600",
        "hover:text-indigo-800",
        // The locked dashboard's warning.
        "text-amber-700",
        // Saved.
        "text-emerald-700",
        // The IP allowlist's entries.
        "text-gray-900",
      ]),
    );

    expect(
      colorTokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
