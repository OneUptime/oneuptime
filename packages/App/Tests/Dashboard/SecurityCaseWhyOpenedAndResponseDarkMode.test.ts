import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme - a pale amber mark on a slate page - and nothing fails.
 *
 * So this reads the sources of a case's "Why This Case Was Opened" card and
 * its Response Plan (#9556, #9557), and holds every colour class they use to
 * what Theme.css actually remaps, as SecurityCaseContextDarkMode does for the
 * case's Story and Impact.
 */

const COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "SecurityCase",
);

const SOURCES: Array<string> = [
  "Matches/SecurityCaseWhyOpenedCard.tsx",
  "Response/SecurityCaseResponsePlanCard.tsx",
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

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

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

  if (utility === "text-white" || SOLID_FILL.test(utility)) {
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

function read(source: string): string {
  return squash(
    stripComments(fs.readFileSync(path.join(COMPONENTS_DIR, source), "utf8")),
  );
}

describe("why a case was opened, and its response plan, in the dark theme", () => {
  test("no source uses dark: variants or builds a colour class from a template", () => {
    for (const source of SOURCES) {
      const code: string = read(source);

      expect({ source, dark: code.includes("dark:") }).toEqual({
        source,
        dark: false,
      });
      expect({ source, template: TEMPLATE_COLOR_TOKEN.test(code) }).toEqual({
        source,
        template: false,
      });
    }
  });

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const source of SOURCES) {
      for (const match of read(source).matchAll(COLOR_TOKEN)) {
        const token: string = match[1]!;
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${source}: ${token}`);
        }
      }
    }

    // The read found their colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(10);
    expect(unmapped).toEqual([]);
  });
});
