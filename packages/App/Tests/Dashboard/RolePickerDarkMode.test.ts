import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ADD A ROLE DIALOG IN THE DARK THEME.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-white` does not cover `hover:bg-white`). A class it has no
 * rule for keeps its light colour in the dark theme - a white tile on a slate
 * dialog, or gray-900 text on a gray-900 panel - and nothing fails.
 *
 * So these read the sources the redesigned dialog draws with - the role
 * picker (its rows, area tiles, the pick under them and the search), the
 * switch it uses twice (Common's ViewSwitch, now able to fill a phone's
 * row) and the Built-in Roles card that lists the roles the same way - and
 * hold every colour class to what Theme.css actually remaps. The dialog is
 * also drawn dark in real Chromium: packages/E2E/CustomRoles/
 * AddRoleDialog.spec.ts.
 */

const DASHBOARD_SRC_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "Common");

const SOURCES: Array<[string, string]> = [
  [
    "Components/Permission/RolePicker.tsx",
    path.join(DASHBOARD_SRC_DIR, "Components", "Permission", "RolePicker.tsx"),
  ],
  [
    "Components/CustomRole/BuiltInRolesCard.tsx",
    path.join(
      DASHBOARD_SRC_DIR,
      "Components",
      "CustomRole",
      "BuiltInRolesCard.tsx",
    ),
  ],
  [
    "Common/UI/Components/ViewSwitch/ViewSwitch.tsx",
    path.join(COMMON_DIR, "UI", "Components", "ViewSwitch", "ViewSwitch.tsx"),
  ],
];

const THEME_CSS_PATH: string = path.join(
  COMMON_DIR,
  "UI",
  "Styles",
  "Theme.css",
);

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function readCodeAt(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const [key, file] of SOURCES) {
    modules.set(key, readCodeAt(file));
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `lg:bg-white` only with a rule of its own, so it must never be read as the
 * bare `bg-white`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
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

describe("the Add a Role dialog in the dark theme", () => {
  test("no source uses dark: variants or builds a colour class from a template", () => {
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

  test("every colour class it draws with is remapped for dark mode", () => {
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

    // The walk found the picker's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(15);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // A picked row or tile, and the pick under the tiles.
        "border-indigo-500",
        "bg-indigo-50/50",
        "border-indigo-200",
        "bg-indigo-100",
        /*
         * Resting and hovered rows and tiles. Under the pointer a resting
         * one only greys: an accent border on hover looked picked.
         */
        "border-gray-200",
        "bg-white",
        "hover:border-gray-300",
        "hover:bg-gray-50",
        // The empty pick and the search's empty state.
        "border-gray-300",
        // Words.
        "text-gray-900",
        "text-gray-500",
        "text-gray-400",
        // The switch's track.
        "bg-gray-100",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("a hovered row or tile never wears the picked one's accent border", () => {
    const picker: string = getModules().get(
      "Components/Permission/RolePicker.tsx",
    ) as string;

    expect(picker).not.toContain("hover:border-indigo-");
    expect(picker).toContain(
      'const CHOICE_PICKED: string = "border-indigo-500 bg-indigo-50/50";',
    );
  });

  /*
   * Theme.css softens a search box's placeholder through the placeholder
   * colour utility (placeholder-gray-400), as Input's own: the placeholder:
   * variant has no dark rule and would stay a light grey.
   */
  test("the search box's placeholder is the colour Theme.css softens", () => {
    const picker: string = getModules().get(
      "Components/Permission/RolePicker.tsx",
    ) as string;

    expect(picker).toContain("placeholder-gray-400");
    expect(picker).not.toContain("placeholder:text-");
    expect(THEME_CSS).toContain(".placeholder-gray-400");
  });

  test("the keyboard's focus ring is the accent colour, which reads the same in both themes", () => {
    const picker: string = getModules().get(
      "Components/Permission/RolePicker.tsx",
    ) as string;

    expect(picker).toContain(
      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500",
    );
  });
});
