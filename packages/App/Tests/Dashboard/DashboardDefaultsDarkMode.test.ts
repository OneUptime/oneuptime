import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A dashboard's default time range and auto-refresh in the dark theme
 * (issue #5080): the editing row (DashboardDefaultsBar) and its menus, the
 * toolbar's auto-refresh menu with its Default (...) first, and the time
 * range picker with its Default (...) choice.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant: `.bg-gray-100` does not cover `focus-visible:bg-gray-100`. A class
 * it has no rule for keeps its light colour - the editing row's menus first
 * drew a keyboard-focused choice with `focus-visible:bg-gray-50`, which has
 * none, as a near-white bar under light text - and nothing fails. So this
 * holds every colour class these files use to what Theme.css remaps.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");

const TOOLBAR_DIR: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "Toolbar",
);

const DATE_DIR: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "Date",
);

const THEME_CSS_PATH: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

// Comments hold prose, not classes.
function readCode(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

/*
 * The toolbar's auto-refresh menu only: the rest of the toolbar is older
 * than these settings and is not what this file holds.
 */
function autoRefreshMenuCode(): string {
  const toolbar: string = readCode(
    path.join(TOOLBAR_DIR, "DashboardToolbar.tsx"),
  );
  const start: number = toolbar.indexOf("const AutoRefreshDropdown");
  const end: number = toolbar.indexOf("const DashboardToolbar", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return toolbar.slice(start, end);
}

const SOURCES: Array<{ name: string; code: string }> = [
  {
    name: "DashboardDefaultsBar.tsx",
    code: readCode(path.join(TOOLBAR_DIR, "DashboardDefaultsBar.tsx")),
  },
  { name: "the toolbar's auto-refresh menu", code: autoRefreshMenuCode() },
  {
    name: "RangeStartAndEndDateEdit.tsx",
    code: readCode(path.join(DATE_DIR, "RangeStartAndEndDateEdit.tsx")),
  },
];

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * Every whitespace-separated token of every string literal in the code: a
 * template literal's text, and every double-quoted string anywhere - the
 * ones inside a template's ${isOpen ? "..." : "..."} included, where the
 * open and the chosen states keep their colours.
 */
function stringTokens(code: string): Array<string> {
  const texts: Array<string> = [];

  for (const match of code.matchAll(/`([^`]*)`/g)) {
    texts.push((match[1] ?? "").replace(/\$\{[^}]*\}/g, " "));
  }

  for (const match of code.matchAll(/"([^"\n]*)"/g)) {
    texts.push(match[1] ?? "");
  }

  return texts.flatMap((text: string): Array<string> => {
    return text.split(/\s+/).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
}

// The utility a token applies, after its variants.
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

// A mid-tone hue (a 500 or 600) reads the same in both themes; a grey does not.
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

  // As Theme.css writes the class: backslashes first, then ":" and "/".
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

function colorTokensOf(code: string): Array<string> {
  return Array.from(
    new Set(
      stringTokens(code).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

describe("a dashboard's defaults in the dark theme", () => {
  test.each(SOURCES)(
    "$name uses no dark: variants and builds no colour class from a template",
    (source: { name: string; code: string }) => {
      expect(source.code).not.toContain("dark:");
      expect(source.code).not.toMatch(
        /(?:bg|text|border|ring|divide|from|via|to)-\$\{/,
      );
    },
  );

  test.each(SOURCES)(
    "every colour class $name uses is remapped for dark mode",
    (source: { name: string; code: string }) => {
      const tokens: Array<string> = colorTokensOf(source.code);

      // The scan found colours at all, so this is not vacuous.
      expect(tokens.length).toBeGreaterThan(4);
      expect(
        tokens.filter((token: string): boolean => {
          return !isRemapped(token);
        }),
      ).toEqual([]);
    },
  );

  test("the menus' keyboard focus and the editing row's words are among them", () => {
    const bar: Array<string> = colorTokensOf(SOURCES[0]!.code);
    const menu: Array<string> = colorTokensOf(SOURCES[1]!.code);
    const picker: Array<string> = colorTokensOf(SOURCES[2]!.code);

    expect(bar).toEqual(
      expect.arrayContaining([
        // The labels and the line under the pickers.
        "text-gray-600",
        "text-gray-500",
        // A choice reached with the keyboard, and one under the pointer.
        "focus-visible:bg-gray-100",
        "hover:bg-gray-50",
        // The choice in use, and the open button.
        "text-indigo-600",
        "bg-indigo-50",
        "border-indigo-200",
        "focus-visible:ring-indigo-400",
      ]),
    );
    expect(menu).toEqual(
      expect.arrayContaining([
        "focus-visible:bg-gray-100",
        "focus-visible:ring-indigo-400",
        "text-indigo-600",
      ]),
    );
    expect(picker).toEqual(
      expect.arrayContaining([
        // The rule between the rail and the preview, on its start side.
        "md:border-gray-200",
        "focus-visible:ring-indigo-400",
        "bg-indigo-50",
        "text-indigo-700",
      ]),
    );

    // The one that had no dark rule is gone from every menu.
    for (const tokens of [bar, menu, picker]) {
      expect(tokens).not.toContain("focus-visible:bg-gray-50");
    }
  });
});
