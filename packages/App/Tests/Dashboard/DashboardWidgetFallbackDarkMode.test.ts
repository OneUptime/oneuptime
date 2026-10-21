import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The note a dashboard widget shows when it cannot be drawn (issue #4571,
 * Components/Dashboard/Components/DashboardWidgetFallback) sits on every kind
 * of board, and the dashboard has a dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class. A class it
 * has no rule for keeps its light colour in the dark theme - an amber-50
 * circle glowing on a slate card, gray-700 text on a gray-800 one - and
 * nothing fails. So this reads the card's source and holds every colour class
 * to what Theme.css actually remaps, the way the other *DarkMode guards do.
 */

const DASHBOARD_COMPONENTS: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
);

const SOURCES: Array<string> = [
  path.join(DASHBOARD_COMPONENTS, "Components", "DashboardWidgetFallback.tsx"),
];

const THEME_CSS: string = fs
  .readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "UI",
      "Styles",
      "Theme.css",
    ),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (utility === "text-white" || SOLID_FILL.test(utility)) {
    return true;
  }

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

describe("a widget's could-not-be-shown note in the dark theme", () => {
  test("uses no dark: variants and builds no colour class from a template", () => {
    for (const file of SOURCES) {
      const code: string = codeOf(file);

      expect({ file, dark: code.includes("dark:") }).toEqual({
        file,
        dark: false,
      });
      expect({ file, template: TEMPLATE_COLOR_TOKEN.test(code) }).toEqual({
        file,
        template: false,
      });
    }
  });

  test("every colour class it uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const file of SOURCES) {
      for (const match of codeOf(file).matchAll(COLOR_TOKEN)) {
        const token: string = match[1]!;
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${path.basename(file)}: ${token}`);
        }
      }
    }

    // The scan found the card's colours, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "bg-amber-50",
        "text-amber-500",
        "text-gray-700",
        "text-gray-500",
        "text-gray-400",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
