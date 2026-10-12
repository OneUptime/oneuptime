import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`). A
 * class it has no rule for keeps its light colour in the dark theme and
 * nothing fails - a pale card on a dark page.
 *
 * The Traffic pages paint a lot of colour: the tiles' icon squares, the
 * share bars behind every row, the filter chips, the conversation diagram,
 * the set-up guide's steps and the "Not a device yet" badges. These read
 * every source of those pages and hold every colour class they use to what
 * Theme.css actually remaps.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The whole folder: a file added to it is checked without a list.
const FOLDERS: Array<string> = ["Components/NetworkTraffic"];

// The pages that draw it.
const FILES: Array<string> = [
  "Pages/NetworkDevice/Traffic.tsx",
  "Pages/NetworkDevice/View/Traffic.tsx",
  "Pages/NetworkSite/View/Traffic.tsx",
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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const folder of FOLDERS) {
    for (const name of fs.readdirSync(path.join(DASHBOARD_SRC, folder))) {
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        const relativePath: string = `${folder}/${name}`;
        modules.set(relativePath, readCode(relativePath));
      }
    }
  }

  for (const file of FILES) {
    modules.set(file, readCode(file));
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-gray-50` only with a rule of its own, so it must never be read
 * as the bare `bg-gray-50`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 400-600 mark (an icon, a dot, a share bar, the diagram's
 * bands) reads the same on a light and a dark card. Greys are not marks:
 * their light shades are exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_SELECTOR: RegExp = /\[class\*="([^"]+)"\]/g;

// Interaction variants Theme.css remaps by prefix, matched with startsWith.
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_SELECTOR),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

const GROUP_HOVER_GREY_TEXT_RULE: string =
  '.group:hover [class*="group-hover"][class*="text-gray-"]';

const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (
    utility === "text-white" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility)
  ) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    token.startsWith("group-hover:text-gray-") &&
    THEME_CSS.includes(GROUP_HOVER_GREY_TEXT_RULE)
  ) {
    return true;
  }

  if (
    SUBSTRING_VARIANTS.some((prefix: string): boolean => {
      return token.startsWith(prefix);
    })
  ) {
    return true;
  }

  // CSS escaping, as Theme.css writes the class.
  const escapedClass: string = token
    .replace(BACKSLASH, "\\\\")
    .replace(COLON, "\\:")
    .replace(SLASH, "\\/");
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

function tokensIn(code: string): Array<string> {
  return Array.from(code.matchAll(COLOR_TOKEN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the Traffic pages in the dark theme", () => {
  test("every component and page is read", () => {
    expect(Array.from(getModules().keys())).toEqual(
      expect.arrayContaining([
        "Components/NetworkTraffic/NetworkTrafficView.tsx",
        "Components/NetworkTraffic/TrafficTopList.tsx",
        "Components/NetworkTraffic/TrafficSummaryTiles.tsx",
        "Components/NetworkTraffic/TrafficConversationDiagram.tsx",
        "Components/NetworkTraffic/TrafficSetupGuide.tsx",
        "Components/NetworkTraffic/TrafficSourcesCard.tsx",
        "Components/NetworkTraffic/TrafficOverTimeChart.tsx",
        "Pages/NetworkDevice/Traffic.tsx",
      ]),
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getModules()) {
      expect({ moduleKey, dark: code.includes("dark:") }).toEqual({
        moduleKey,
        dark: false,
      });
      expect({
        moduleKey,
        template: TEMPLATE_COLOR_TOKEN.test(code),
      }).toEqual({ moduleKey, template: false });
    }
  });

  test("every colour class the pages use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The scan found the pages' colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(40);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // Cards, tiles and the filter chips.
        "bg-white",
        "ring-gray-200",
        "bg-indigo-50",
        "text-indigo-700",
        // The share bars' track, and a row on hover.
        "bg-gray-100",
        "hover:bg-gray-50",
        // "Not a device yet", and the device that stopped sending.
        "bg-amber-50",
        "text-amber-800",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the conversation diagram draws in the text colour, so it follows the theme", () => {
    const diagram: string = readCode(
      "Components/NetworkTraffic/TrafficConversationDiagram.tsx",
    );

    // Bands and bars are filled with currentColor from a mid-tone class.
    expect(diagram).toContain('fill="currentColor"');
    expect(diagram).toContain('<g className="text-indigo-500">');
    expect(diagram).toContain(
      'className={isSource ? "text-indigo-600" : "text-emerald-600"}',
    );
    // No fixed hex colour that would not follow the theme.
    expect(diagram).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
