import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme - a white tile on a slate page - and nothing fails.
 *
 * So this reads every source of Security Events > Detections > Watchlists -
 * the two pages and every component of their folder: the rows' cells, the
 * common lists' tiles, Import Values, Use It in a Rule and the line under a
 * rule's YAML - and holds each colour class to what Theme.css remaps, as
 * SecurityCaseContextDarkMode does for a case's Story. The folder is read
 * whole, so a part added to it later is covered too.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WATCHLISTS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "SecurityEvents",
  "Watchlists",
);

const PAGE_FILES: Array<string> = [
  path.join(DASHBOARD_SRC, "Pages", "SecurityEvents", "Watchlists.tsx"),
  path.join(DASHBOARD_SRC, "Pages", "SecurityEvents", "WatchlistView.tsx"),
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

const WHITESPACE: RegExp = /\s+/g;
/*
 * Read only over this repository's own sources and Theme.css - never text
 * from outside - so its retries on an unclosed comment cannot be driven.
 */
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function squash(text: string): string {
  return text.replace(WHITESPACE, " ");
}

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");
}

// Every source with markup: the pages, and the folder's components.
function getWatchlistModules(): Map<string, string> {
  const files: Array<string> = [
    ...PAGE_FILES,
    ...fs
      .readdirSync(WATCHLISTS_DIR)
      .filter((name: string): boolean => {
        return name.endsWith(".tsx");
      })
      .map((name: string): string => {
        return path.join(WATCHLISTS_DIR, name);
      }),
  ];

  const modules: Map<string, string> = new Map();

  for (const file of files) {
    modules.set(
      path.basename(file),
      squash(stripComments(fs.readFileSync(file, "utf8"))),
    );
  }

  return modules;
}

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_VARIANT: RegExp = /\[class\*="([^"]+)"\]/g;

const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_VARIANT),
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
    .split("\\")
    .join("\\\\")
    .split(":")
    .join("\\:")
    .split("/")
    .join("\\/");
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

function tokensIn(code: string): Array<string> {
  return Array.from(code.matchAll(COLOR_TOKEN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("Watchlists in the dark theme", () => {
  test("the read takes in both pages and every component of the folder", () => {
    const modules: Map<string, string> = getWatchlistModules();

    for (const name of [
      "Watchlists.tsx",
      "WatchlistView.tsx",
      "WatchlistCells.tsx",
      "WatchlistStarters.tsx",
      "WatchlistImportModal.tsx",
      "WatchlistRuleSnippet.tsx",
      "DetectionRuleWatchlists.tsx",
    ]) {
      expect({ name, read: modules.has(name) }).toEqual({ name, read: true });
    }
  });

  test("no source uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getWatchlistModules()) {
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

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getWatchlistModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The read found their colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(10);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "text-gray-900",
        "text-gray-500",
        "text-gray-400",
        "text-gray-300",
        "text-red-700",
        "border-gray-200",
        "bg-gray-100",
        "text-indigo-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
