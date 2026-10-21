import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Affected Resources card's body (AffectedResourcesDisplay) on the
 * incident, alert and scheduled maintenance overview pages.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has no
 * rule for keeps its light colour in the dark theme - a near-white row on a
 * slate card - and nothing fails. So this holds every colour class the
 * display uses to what Theme.css actually remaps.
 *
 * It also holds the source to the redesign: the categories are sections of
 * the page's card, so no class that draws a card (a border, a shadow, a white
 * fill, card rounding, the coloured bar) may come back. Rendering is covered
 * in Common/Tests/App/Dashboard/AffectedResourcesDisplay.test.tsx and the
 * browser in packages/E2E/EventOverview.
 */

const DISPLAY_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "AffectedResources",
  "AffectedResourcesDisplay.tsx",
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

// Comments hold prose ("a bordered, shadowed tile"), not classes.
const CODE: string = fs
  .readFileSync(DISPLAY_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/.*$/gm, " ");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * Every whitespace-separated token of every string literal in the module:
 * class lists are string literals here (className="...", the category props
 * and the exported class-name helpers), and prose tokens never look like a
 * utility.
 */
function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      /\$\{[^}]*\}/g,
      " ",
    );

    tokens.push(
      ...text.split(/\s+/).filter((token: string): boolean => {
        return token.length > 0;
      }),
    );
  }

  return tokens;
}

/*
 * The utility a token applies, after its variants. An arbitrary variant's
 * brackets may hold a colon of their own ("[&_a:focus-visible]:"), so the
 * split skips anything inside brackets.
 */
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

/*
 * A mid-tone hue (a 500 or 600 fill, ring or icon) reads the same in both
 * themes. Neutral greys do not: gray-500 text is what Theme.css re-colours
 * for a dark card, so a grey is only fine where a rule of its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:bg-indigo-50` is not covered by the `:hover` rule
 * for `hover:bg-indigo-50`, which only fires on the element itself.
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

const TOKENS: Array<string> = stringTokens(CODE);

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    TOKENS.filter((token: string): boolean => {
      return COLOR_UTILITY.test(utilityOf(token));
    }),
  ),
);

describe("AffectedResourcesDisplay in the dark theme", () => {
  test("the display uses no dark: variants and builds no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring|divide|from|via|to)-\$\{/);
  });

  test("every colour class the display uses is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );

    // The scan found the display's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // Headings, counts and rows.
        "text-gray-900",
        "text-gray-700",
        "text-gray-600",
        "text-gray-500",
        "bg-gray-100",
        "hover:bg-gray-50",
        // The hairlines between sections.
        "divide-gray-100",
        // Show more / Show less.
        "text-indigo-600",
        "hover:bg-indigo-50",
        "hover:text-indigo-700",
        // The note past the 100-row cap.
        "text-amber-700",
        "text-amber-600",
        // The empty state's icon.
        "text-gray-400",
        // The keyboard focus ring round a row.
        "[&_a:focus-visible]:after:ring-indigo-500",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * Each category's icon tile: a pale tint behind a mid-tone icon. Both
   * shades must be remapped, or a pale tile glows on a dark card.
   */
  test("every category's icon tile and icon colour are remapped", () => {
    const tints: Array<string> = Array.from(
      CODE.matchAll(/iconBgClass="([^"]+)"/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
    const icons: Array<string> = Array.from(
      CODE.matchAll(/iconColorClass="([^"]+)"/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    // One tile per category: fifteen of them.
    expect(tints).toHaveLength(15);
    expect(icons).toHaveLength(15);

    for (const tint of tints) {
      expect({ tint, remapped: isRemapped(tint) }).toEqual({
        tint,
        remapped: true,
      });
      expect(tint).toMatch(/^bg-[a-z]+-50$/);
    }

    for (const icon of icons) {
      expect({ icon, remapped: isRemapped(icon) }).toEqual({
        icon,
        remapped: true,
      });
      expect(icon).toMatch(/^text-[a-z]+-600$/);
    }
  });

  test("the scan reads bracketed variants whole, so a focus ring is judged by its colour", () => {
    expect(utilityOf("[&_a:focus-visible]:after:ring-indigo-500")).toBe(
      "ring-indigo-500",
    );
    expect(utilityOf("hover:bg-gray-50")).toBe("bg-gray-50");
    expect(utilityOf("text-gray-900")).toBe("text-gray-900");
    // A light shade under a variant Theme.css does not know is caught.
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
  });
});

describe("AffectedResourcesDisplay draws no card inside the card", () => {
  /*
   * Each category used to be a bordered, shadowed, white, rounded-xl tile with
   * a coloured bar across its top (h-1 w-full bg-*-500), inside the page's
   * card. None of that belongs in the display: the page's card is the card.
   */
  const BORDER_OR_SHADOW: RegExp = /^(?:border|shadow)(?:-|$)/;
  const CARD_ROUNDING: RegExp = /^rounded-(?:lg|xl|2xl|3xl)$/;
  const ACCENT_BAR_FILL: RegExp = /^bg-[a-z]+-500$/;

  test("no class in the display draws a border, shadow, white fill, card rounding or accent bar", () => {
    const chrome: Array<string> = TOKENS.filter((token: string): boolean => {
      const utility: string = utilityOf(token);

      return (
        BORDER_OR_SHADOW.test(utility) ||
        utility === "bg-white" ||
        CARD_ROUNDING.test(utility) ||
        utility === "overflow-hidden" ||
        utility === "h-1" ||
        ACCENT_BAR_FILL.test(utility)
      );
    });

    expect(chrome).toEqual([]);
  });

  test("the empty state is not a dashed, tinted box either", () => {
    expect(TOKENS).not.toContain("border-dashed");
    expect(TOKENS).not.toContain("bg-gray-50/50");
    expect(TOKENS).not.toContain("ring-1");
  });

  test("sections are split by hairlines, which Theme.css remaps", () => {
    expect(TOKENS).toContain("divide-y");
    expect(TOKENS).toContain("divide-gray-100");
    expect(isRemapped("divide-gray-100")).toBe(true);
  });
});
