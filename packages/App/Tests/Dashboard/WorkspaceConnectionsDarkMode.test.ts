import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Workspace page a product's menu lists while nothing is connected, and
 * the "not connected" state of its Slack and Microsoft Teams pages, in the
 * dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme, and nothing fails. So this reads the sources these screens are drawn
 * from, the .ts module that holds the workspaces' tile colours included, and
 * holds every colour class to what Theme.css remaps.
 */

const WORKSPACE_COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Workspace",
);

const SOURCE_FILES: Array<string> = [
  "WorkspaceConnectionsOverview.tsx",
  "WorkspaceConnectionGate.tsx",
  "WorkspaceConnectionCopy.ts",
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

function readCode(fileName: string): string {
  return fs
    .readFileSync(path.join(WORKSPACE_COMPONENTS_DIR, fileName), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Solid fills, and the white text on them, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

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

describe("the Workspace pages in the dark theme", () => {
  test("no source uses dark: variants", () => {
    for (const fileName of SOURCE_FILES) {
      expect({ fileName, dark: readCode(fileName).includes("dark:") }).toEqual({
        fileName,
        dark: false,
      });
    }
  });

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const fileName of SOURCE_FILES) {
      for (const token of tokensIn(readCode(fileName))) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${fileName}: ${token}`);
        }
      }
    }

    // The walk found the tiles' colours at all, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "border-gray-200",
        "bg-white",
        "text-gray-900",
        "text-gray-500",
        "bg-emerald-50",
        "text-emerald-700",
        "ring-emerald-200",
        "bg-gray-100",
        "text-gray-600",
        "ring-gray-200",
        "text-indigo-600",
        "hover:text-indigo-700",
        "bg-fuchsia-500",
        "bg-blue-500",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the workspace tiles keep the checklist's colours: Slack fuchsia, Microsoft Teams blue", () => {
    const copy: string = readCode("WorkspaceConnectionCopy.ts");

    expect(copy).toContain('iconBackgroundClassName: "bg-fuchsia-500"');
    expect(copy).toContain('iconBackgroundClassName: "bg-blue-500"');
  });
});
