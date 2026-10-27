import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A metric table's threshold colors (issue #5231) - its amber and red
 * values, the filled cells of Colored background, the legend under each
 * column's thresholds in the settings and the two pictures of the Threshold
 * colors choice - are drawn on dashboards people read in the dark theme
 * too, often on a wall screen.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class. A class it
 * has no rule for keeps its light colour in the dark theme - an amber-100
 * cell glowing on a slate card, amber-900 text that cannot be read on it -
 * and nothing fails. So this reads the sources that draw the colors and
 * holds every colour class to what Theme.css actually remaps, the way the
 * other *DarkMode guards do. The browser suite in
 * packages/E2E/DashboardTableThresholds measures the contrast in both themes.
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
  path.join(
    DASHBOARD_COMPONENTS,
    "Components",
    "DashboardTableThresholdCopy.ts",
  ),
  path.join(DASHBOARD_COMPONENTS, "Components", "DashboardTableValueCell.tsx"),
  path.join(DASHBOARD_COMPONENTS, "Canvas", "TableColumnThresholdsEditor.tsx"),
  path.join(DASHBOARD_COMPONENTS, "Canvas", "TableThresholdStylePicker.tsx"),
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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
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
    .split("\\")
    .join("\\\\")
    .split(":")
    .join("\\:")
    .split("/")
    .join("\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-red-50 is not bg-red-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

function tokensOf(file: string): Array<string> {
  return Array.from(codeOf(file).matchAll(COLOR_TOKEN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("a metric table's threshold colors in the dark theme", () => {
  test("use no dark: variants and build no colour class from a template", () => {
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

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const file of SOURCES) {
      for (const token of tokensOf(file)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${path.basename(file)}: ${token}`);
        }
      }
    }

    // The scan found the levels' colours, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "text-amber-700",
        "text-red-700",
        "bg-amber-100",
        "text-amber-900",
        "bg-red-100",
        "text-red-900",
        "text-gray-900",
        "border-gray-200",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the levels' text turns light on the dark card, and the filled cells into dark washes", () => {
    /*
     * Not just "some rule exists": each level's light-theme text is in the
     * dark rule that gives it a light colour, and each fill in the one that
     * gives it a dark, see-through wash.
     */
    const ruleFor: (token: string) => string = (token: string): string => {
      const start: number =
        THEME_CSS.indexOf(`.${token},`) >= 0
          ? THEME_CSS.indexOf(`.${token},`)
          : THEME_CSS.indexOf(`.${token} `);
      expect([token, start >= 0]).toEqual([token, true]);
      const open: number = THEME_CSS.indexOf("{", start);
      const close: number = THEME_CSS.indexOf("}", open);
      return THEME_CSS.slice(open + 1, close);
    };

    expect(ruleFor("text-amber-700")).toContain("#fcd34d");
    expect(ruleFor("text-amber-900")).toContain("#fcd34d");
    expect(ruleFor("text-red-700")).toContain("#fca5a5");
    expect(ruleFor("text-red-900")).toContain("#fca5a5");
    expect(ruleFor("bg-amber-100")).toContain("rgb(120 53 15 / 32%)");
    expect(ruleFor("bg-red-100")).toContain("rgb(127 29 29 / 32%)");
  });
});
