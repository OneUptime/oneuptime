import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5184: a device's SNMP Walk page in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-white` does not cover `group-hover:bg-white`). A class it has
 * no rule for keeps its light colour in the dark theme - a white results
 * table on a slate page, or gray-900 text on a gray-900 card - and nothing
 * fails.
 *
 * So these read the sources of the walk's card and page, and every component
 * they import from their own folder, and hold every colour class to what
 * Theme.css actually remaps. The module set is walked from the entry points
 * rather than listed, so a part split out later is covered automatically.
 * Rendering is covered in Common/Tests/App/Dashboard/SnmpWalkCard.test.tsx
 * and in both themes in the browser by packages/E2E/SnmpWalk.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMPONENTS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
);

const PAGE_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "View",
  "SnmpWalk.tsx",
);

const ENTRY_FILES: Array<string> = ["SnmpWalkCard.tsx", "SnmpWalkResults.tsx"];

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

const IMPORT_FROM_FOLDER: RegExp = /from "\.\/([A-Za-z0-9_/]+)"/g;

/*
 * A comment starts after a space or a line break, so a path such as
 * `/monitors/*` or a link's `https://` is never taken for one.
 */
function readCodeAt(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1 ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

/*
 * The entry points plus every .tsx component they import from this folder,
 * followed transitively, plus the page. Plain .ts helpers (the view model)
 * hold no markup and are skipped.
 */
function getWalkModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [...ENTRY_FILES];

  while (pending.length > 0) {
    const fileName: string = pending.shift()!;

    if (modules.has(fileName)) {
      continue;
    }

    const code: string = readCodeAt(path.join(COMPONENTS_DIR, fileName));
    modules.set(fileName, code);

    for (const match of code.matchAll(IMPORT_FROM_FOLDER)) {
      const candidate: string = `${match[1]!}.tsx`;

      if (fs.existsSync(path.join(COMPONENTS_DIR, candidate))) {
        pending.push(candidate);
      }
    }
  }

  modules.set("Pages/NetworkDevice/View/SnmpWalk.tsx", readCodeAt(PAGE_PATH));

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `md:bg-white` only with a rule of its own, so it must never be read as the
 * bare `bg-white`. Gradient stops are colours too.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:text-indigo-800` is not covered by the `:hover`
 * rule for `hover:text-indigo-800`, which only fires on the element itself.
 */
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

  /*
   * CSS escaping, as Theme.css writes the class: backslashes first, so the
   * ones added for ":" and "/" are not escaped a second time.
   */
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

describe("the SNMP Walk page in the dark theme", () => {
  test("the walk starts at the card and the results, and adds the page", () => {
    const modules: Map<string, string> = getWalkModules();

    for (const entry of ENTRY_FILES) {
      expect(modules.has(entry)).toBe(true);
    }
    expect(modules.has("Pages/NetworkDevice/View/SnmpWalk.tsx")).toBe(true);
    // The view model holds no markup and is not walked.
    expect(modules.has("SnmpWalkViewModel.tsx")).toBe(false);
    expect(modules.size).toBe(3);
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getWalkModules()) {
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

  test("every colour class the page uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getWalkModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found the page's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(20);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The results table, its rows and its type pills.
        "bg-white",
        "divide-gray-100",
        "bg-gray-100",
        "text-gray-900",
        "text-gray-500",
        // The links, and the failure boxes in their two tones.
        "text-indigo-600",
        "hover:text-indigo-800",
        "bg-red-50",
        "border-red-200",
        "bg-amber-50",
        "border-amber-200",
        // The chosen starting point.
        "bg-indigo-50",
        "border-indigo-200",
        // A collected OID's badge, and what Collect came to in its row.
        "bg-green-50",
        "text-green-700",
        "text-green-600",
        "text-red-700",
        // "Alert on it", drawn as the small button Collect is.
        "border-gray-300",
        "hover:bg-gray-50",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("hover:text-indigo-800")).toBe(true);
    expect(isRemapped("bg-indigo-600")).toBe(true);
    expect(isRemapped("text-white")).toBe(true);

    // The traps: no rule of their own, so they keep their light colour.
    expect(isRemapped("group-hover:bg-white")).toBe(false);
    expect(isRemapped("bg-slate-900")).toBe(false);
    expect(isRemapped("md:bg-white")).toBe(false);
    // A made-up shade no stylesheet will ever remap.
    expect(isRemapped("bg-gray-55")).toBe(false);
    expect(isRemapped("text-purple-950")).toBe(false);
  });

  test("the module reader keeps paths and links, and drops comments", () => {
    const sample: string = path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Utils",
      "RouteMap.ts",
    );
    const code: string = readCodeAt(sample);

    // A wildcard route is code, not the start of a comment.
    expect(code).toContain("/monitors/*`");
    expect(code).toContain("NETWORK_DEVICE_VIEW_SNMP_WALK");
  });
});
