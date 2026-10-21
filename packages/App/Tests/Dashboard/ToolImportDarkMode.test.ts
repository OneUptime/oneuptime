import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-white` does not cover `group-hover:bg-white`). A class it has
 * no rule for keeps its light colour in the dark theme - a white panel on a
 * slate page, or gray-900 text on a gray-900 card - and nothing fails.
 *
 * So these read every source of Project Settings > Import from another tool
 * (the page and everything in Components/ToolImport, listed from the folder
 * so a component added later is covered) and hold every colour class to what
 * Theme.css actually remaps.
 */

const DASHBOARD_SRC_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const TOOL_IMPORT_COMPONENTS_DIR: string = path.join(
  DASHBOARD_SRC_DIR,
  "Components",
  "ToolImport",
);

const PAGE_FILE: string = path.join(
  DASHBOARD_SRC_DIR,
  "Pages",
  "Settings",
  "ImportFromTool.tsx",
);

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
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const SOURCE_FILE: RegExp = /\.tsx?$/;

function readCodeAt(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function getToolImportModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const fileName of fs.readdirSync(TOOL_IMPORT_COMPONENTS_DIR).sort()) {
    if (SOURCE_FILE.test(fileName)) {
      modules.set(
        `Components/ToolImport/${fileName}`,
        readCodeAt(path.join(TOOL_IMPORT_COMPONENTS_DIR, fileName)),
      );
    }
  }

  modules.set("Pages/Settings/ImportFromTool.tsx", readCodeAt(PAGE_FILE));

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `lg:bg-white` only with a rule of its own, so it must never be read as the
 * bare `bg-white`. Gradient stops are colours too.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
const CLASS_NAME_ATTRIBUTE: RegExp = /className="([^"]*)"/g;
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:border-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:bg-indigo-50` is not covered by the `:hover` rule
 * for `hover:bg-indigo-50`, which only fires on the element itself.
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

describe("Import from another tool in the dark theme", () => {
  test("the walk reads the page and every component in Components/ToolImport", () => {
    const modules: Map<string, string> = getToolImportModules();

    expect(Array.from(modules.keys())).toEqual(
      expect.arrayContaining([
        "Pages/Settings/ImportFromTool.tsx",
        "Components/ToolImport/ToolImportPicker.tsx",
        "Components/ToolImport/ToolImportConnectForm.tsx",
        "Components/ToolImport/ToolImportProgressPanel.tsx",
        "Components/ToolImport/ToolImportReview.tsx",
        "Components/ToolImport/ToolImportReport.tsx",
        "Components/ToolImport/ToolImportHistory.tsx",
        "Components/ToolImport/ToolImportNoteList.tsx",
        "Components/ToolImport/ToolImportLogo.tsx",
        "Components/ToolImport/ToolImportPlanView.ts",
      ]),
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getToolImportModules()) {
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

    for (const [moduleKey, code] of getToolImportModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found the page's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(15);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // Tool tiles and their hover, the review's rows, notes and warnings.
        "bg-white",
        "border-gray-200",
        "hover:border-indigo-400",
        "hover:bg-gray-50",
        "divide-gray-200",
        "text-gray-900",
        "text-gray-500",
        "bg-amber-50",
        "text-amber-700",
        "bg-red-50",
        "text-red-700",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * Theme.css paints near-white over any hovered group child carrying a
   * text-gray-* class (it outranks the indigo hover rule), so the two on
   * one element turn white on hover in the dark theme, not indigo.
   */
  test("no element pairs a grey text colour with an indigo group-hover text colour", () => {
    for (const [moduleKey, code] of getToolImportModules()) {
      for (const match of code.matchAll(CLASS_NAME_ATTRIBUTE)) {
        const classes: Array<string> = match[1]!.split(" ");
        const clash: boolean =
          classes.some((name: string): boolean => {
            return name.startsWith("text-gray-");
          }) &&
          classes.some((name: string): boolean => {
            return name.startsWith("group-hover:text-indigo-");
          });

        expect({ moduleKey, classes: match[1], clash }).toEqual({
          moduleKey,
          classes: match[1],
          clash: false,
        });
      }
    }
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("hover:border-indigo-400")).toBe(true);
    expect(isRemapped("bg-indigo-600")).toBe(true);
    expect(isRemapped("text-white")).toBe(true);

    // The traps: no rule of their own, so they keep their light colour.
    expect(isRemapped("group-hover:bg-white")).toBe(false);
    expect(isRemapped("lg:bg-white")).toBe(false);
    expect(isRemapped("bg-slate-900")).toBe(false);
    expect(isRemapped("bg-gray-55")).toBe(false);
  });
});
