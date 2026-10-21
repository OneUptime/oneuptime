import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Cloud > Connect in the dark theme: the page, the clouds' tiles, the
 * guided form (its command, the test and what it found), the connections'
 * list and the way in from an empty All Resources - every module under
 * Components/Cloud/Connect, walked rather than listed, so a component added
 * later is held too, and the pages that draw them.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * and per variant. A class it has no rule for keeps its light colour in the
 * dark theme - a white tile on a slate page, gray-900 text on a gray-900
 * card - and nothing fails. The browser suite (packages/E2E/CloudConnect)
 * reads the colours drawn; this holds every class to what Theme.css
 * remaps.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ROOTS: Array<string> = [
  path.join(DASHBOARD_SRC, "Components", "Cloud", "Connect"),
];

const PAGES: Array<string> = [
  "Pages/Cloud/Connect.tsx",
  "Pages/Cloud/MonitoredResources.tsx",
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

const SOURCE_FILE: RegExp = /\.tsx?$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE_RUN: RegExp = /\s+/g;
const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;

// Every .ts and .tsx module under the roots, by its path from src.
function listModules(): Array<string> {
  const modules: Array<string> = [];
  const pending: Array<string> = [...ROOTS];

  while (pending.length > 0) {
    const directory: string = pending.shift()!;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        pending.push(full);
      } else if (SOURCE_FILE.test(entry.name)) {
        modules.push(path.relative(DASHBOARD_SRC, full).split(path.sep).join("/"));
      }
    }
  }

  return [...modules, ...PAGES].sort();
}

const MODULES: Array<string> = listModules();

// Comments hold prose, not classes.
function readCode(file: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE_RUN, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: `hover:bg-gray-100` needs a
 * rule of its own, apart from `bg-gray-100`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|current|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 400-600 mark (an icon, a cloud's logo, a focus ring, a
 * state's colour) reads on a light and a dark card alike. Greys are not
 * marks: their light shades are exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)(?:\/\d+)?$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A whole class built from a value ("text-${tone}"), not a test id's tail.
const TEMPLATE_COLOR_TOKEN: RegExp =
  /(?<![\w-])(bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_RULE),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (
    utility === "text-white" ||
    utility === "text-current" ||
    utility === "bg-current" ||
    utility === "border-current" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility)
  ) {
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

  /*
   * CSS escaping, as Theme.css writes the class: backslashes first, so the
   * ones added for ":" and "/" are not escaped a second time.
   */
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

describe("Cloud > Connect in the dark theme", () => {
  test("reads every component of Connect, and the pages that draw them", () => {
    expect(MODULES).toEqual(
      expect.arrayContaining([
        "Components/Cloud/Connect/CloudConnectCallout.tsx",
        "Components/Cloud/Connect/CloudConnectionFormModal.tsx",
        "Components/Cloud/Connect/CloudConnectionLogo.tsx",
        "Components/Cloud/Connect/CloudConnectionTestPanel.tsx",
        "Components/Cloud/Connect/CloudConnectionTiles.tsx",
        "Components/Cloud/Connect/CloudConnectionsTable.tsx",
        "Components/Cloud/Connect/CloudResourceGroups.tsx",
        "Components/Cloud/Connect/CloudSetupCommand.tsx",
        "Pages/Cloud/Connect.tsx",
        "Pages/Cloud/MonitoredResources.tsx",
      ]),
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const file of MODULES) {
      const code: string = readCode(file);

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

    for (const file of MODULES) {
      for (const token of tokensIn(readCode(file))) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${file}: ${token}`);
        }
      }
    }

    // The scan found the page's colours at all, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The tiles and the resource chips.
        "bg-white",
        "border-gray-200",
        // A test that works, and one that does not.
        "bg-emerald-50",
        "bg-red-50",
        // The shell button and the guide link.
        "bg-indigo-600",
        "text-indigo-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
