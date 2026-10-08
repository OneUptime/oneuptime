import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme, and nothing fails.
 *
 * So this reads the products menu's folding pieces - the category row
 * (icon, name, the products it holds, count, chevron, and the cursor's and
 * the hover's colours on it), the phone menu's list, the frame of the
 * desktop menu's list of categories and the plain headings above it - and
 * holds every colour class they draw with to what Theme.css remaps.
 */

const NAVBAR_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "Navbar",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Styles",
  "Theme.css",
);

const readCode: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(path.join(NAVBAR_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
};

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-gray-50` only with a rule of its own.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 hue reads the same on both themes (a focus ring, a
 * fill), and transparent is transparent in both. Never a grey: grey text is
 * exactly what has to be lightened.
 */
const SAME_IN_BOTH_THEMES: RegExp =
  /^(?:bg|text|border|ring)-(?:(?!gray|slate|zinc|neutral|stone)[a-z]+-(?:500|600)|transparent)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class put together at run time, which no scan can check.
const TEMPLATE_COLOR_TOKEN: RegExp = /(bg|text|border|ring)-\$\{/;

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

  if (SAME_IN_BOTH_THEMES.test(utility)) {
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

function colorTokens(code: string): Array<string> {
  return Array.from(
    new Set(
      Array.from(code.matchAll(COLOR_TOKEN), (match: RegExpMatchArray) => {
        return match[1]!;
      }),
    ),
  );
}

describe.each(["NavBarCategoryToggle.tsx", "NavBarMobileMenu.tsx"])(
  "%s in the dark theme",
  (file: string) => {
    const code: string = readCode(file);

    test("draws with no dark: variants and builds no colour class from a template", () => {
      expect(code.includes("dark:")).toBe(false);
      expect(TEMPLATE_COLOR_TOKEN.test(code)).toBe(false);
    });

    test("every colour class it draws with is remapped for dark mode", () => {
      expect(
        colorTokens(code).filter((token: string): boolean => {
          return !isRemapped(token);
        }),
      ).toEqual([]);
    });
  },
);

describe("the category row's colours", () => {
  const tokens: Array<string> = colorTokens(
    readCode("NavBarCategoryToggle.tsx"),
  );

  test("the scan finds them, so the check above is not vacuous", () => {
    expect(tokens).toEqual(
      expect.arrayContaining([
        // The name, the products it holds, the count and the chevron.
        "text-gray-900",
        "text-gray-500",
        "text-gray-600",
        "text-gray-400",
        "bg-gray-100",
        // The icon's tile.
        "bg-gray-50",
        "ring-gray-200",
        // The hover, and the keyboard cursor on the row.
        "hover:bg-gray-50",
        "bg-indigo-50",
        "bg-white",
        "ring-indigo-200",
        "bg-indigo-100",
        "text-indigo-700",
        "text-indigo-600",
        "text-indigo-500",
      ]),
    );
  });

  test("the row no longer draws a border of its own: the list draws the lines between rows", () => {
    expect(tokens).not.toContain("border-indigo-300");
    expect(tokens).not.toContain("border-transparent");
  });

  test("the plain headings of the desktop menu use only remapped colours too", () => {
    const modal: string = readCode("NavBarMenuModal.tsx");

    // The plain heading that lines up with the icons of the category rows.
    expect(modal).toContain("border border-transparent px-3");
    for (const token of ["border-transparent", "text-gray-500"]) {
      expect(isRemapped(token)).toBe(true);
    }
  });

  test("the frame of the desktop menu's list of categories is drawn in remapped colours", () => {
    const modal: string = readCode("NavBarMenuModal.tsx");
    // The class list of the element laid out on the list's columns.
    const frame: RegExpMatchArray | null = modal.match(
      /className=\{`([^`]*\$\{CATEGORY_LIST_COLUMNS\}[^`]*)`\}/,
    );

    expect(frame).not.toBeNull();
    const frameTokens: Array<string> = colorTokens(frame![1]!);

    // A border around the list and a rule between its rows.
    expect(frameTokens).toEqual(
      expect.arrayContaining(["border-gray-200", "divide-gray-100"]),
    );
    for (const token of frameTokens) {
      expect([token, isRemapped(token)]).toEqual([token, true]);
    }
  });

  test("the phone menu's rule and guide line are drawn in remapped colours", () => {
    const tokens: Array<string> = colorTokens(readCode("NavBarMobileMenu.tsx"));

    /*
     * Its every category is a row (NavBarCategoryToggle, scanned above), so
     * the menu itself draws only the rule above them and the guide line
     * under an open one.
     */
    expect(tokens).toEqual(["border-gray-100"]);
    for (const token of tokens) {
      expect([token, isRemapped(token)]).toEqual([token, true]);
    }
  });
});
