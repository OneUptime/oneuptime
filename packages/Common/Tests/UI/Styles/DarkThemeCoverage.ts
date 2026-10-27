import { escapeRegExp } from "../../../Utils/RegExpEscape";
import fs from "fs";
import path from "path";

/*
 * Whether a light colour class has a dark theme: what the suites that hold
 * a whole page to the dark theme ask of every class it draws - the sign-in
 * pages (Common/Tests/App/Accounts/AccountsPagesDarkTheme.test.tsx, App's
 * Tests/Accounts/AccountsDarkModeGuard.test.ts) and the user menu's theme
 * row.
 *
 * The dark theme is not a second set of classes: Common/UI/Styles/Theme.css
 * remaps the light utilities a component already uses (bg-white,
 * text-gray-500, hover:bg-gray-100 ...) once <html> carries .dark, one rule
 * per class and per variant (`.bg-gray-50` does not cover
 * `hover:bg-gray-50`). A class it has no rule for keeps its light colour -
 * a white box, or dark words, on a dark page - and nothing fails. So a class
 * passes when the stylesheet remaps it, or when it reads the same in both
 * themes (isSameInBothThemes).
 *
 * Read as text, not through jsdom's CSS engine: Theme.css is written for a
 * real browser (:is(), color-mix()), and jsdom drops what it cannot parse,
 * silently (see ThemeStylesheet.ts).
 */

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(
    path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOUR_NAMES: string =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

// bg-white, text-gray-500, ring-indigo-200, bg-gray-50/50 ...
export const COLOUR_UTILITY: RegExp = new RegExp(
  `^(?:bg|text|border|ring|divide|placeholder|outline|fill|stroke|from|via|to)-(?:white|black|(?:${COLOUR_NAMES})-\\d{2,3})(?:/\\d{1,3})?$`,
);

/*
 * A mid-tone hue - a 500 or 600 fill, ring, border or icon - reads the same
 * in both themes: the page's filled buttons, a status dot. Neutral greys do
 * not: gray-500 text is what Theme.css recolours for a dark card, so a grey
 * passes only by a rule of its own.
 */
const MID_TONE_HUE: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

/*
 * White words and marks on a filled button or badge - which a mid-tone or
 * dark fill keeps in both themes.
 */
const WHITE_ON_A_FILL: RegExp = /^(?:text|fill|stroke)-white$/;

const SUBSTRING_PREFIX: RegExp = /\[class\*="([^"]+)"\]/g;

const IDENTIFIER_CHARACTER: RegExp = /[\w-]/;

const WHITESPACE: RegExp = /\s+/;

/*
 * Interaction variants Theme.css remaps by prefix, as
 * [class*="hover:text-indigo-"]:hover does. Matched with startsWith: a
 * `group-hover:bg-indigo-50` is not covered by a rule for
 * `hover:bg-indigo-50`, which fires on the element itself.
 */
const SUBSTRING_PREFIXES: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_PREFIX),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

/*
 * The utility a class applies, after its variants. An arbitrary variant's
 * brackets may hold a colon of their own ("[&_a:focus-visible]:"), so the
 * split skips anything inside brackets.
 */
export function utilityOf(token: string): string {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let index: number = 0; index < token.length; index++) {
    const character: string = token[index]!;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = index;
    }
  }

  return token.slice(lastColon + 1);
}

// Whether a class draws a colour (after its variants).
export function isColourClass(token: string): boolean {
  return COLOUR_UTILITY.test(utilityOf(token));
}

// Whether a colour class reads the same on a light and a dark page.
export function isSameInBothThemes(token: string): boolean {
  const utility: string = utilityOf(token);

  return MID_TONE_HUE.test(utility) || WHITE_ON_A_FILL.test(utility);
}

/*
 * Whether Theme.css gives the class a dark theme: as a class selector for a
 * plain utility (`.bg-white`, `.hover\:bg-gray-50`), by its exact token in a
 * [class~="..."] selector, or by a prefix in a [class*="..."] one.
 */
export function isRemappedForDarkTheme(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    SUBSTRING_PREFIXES.some((prefix: string): boolean => {
      return token.startsWith(prefix);
    })
  ) {
    return true;
  }

  const escaped: string = token
    .split("\\")
    .join("\\\\")
    .split(":")
    .join("\\:")
    .split("/")
    .join("\\/");
  const selector: RegExp = new RegExp(`\\.${escapeRegExp(escaped)}`, "g");

  for (const match of THEME_CSS.matchAll(selector)) {
    const next: string = THEME_CSS[(match.index || 0) + match[0].length] || " ";

    if (!IDENTIFIER_CHARACTER.test(next)) {
      return true;
    }
  }

  return false;
}

// Whether a colour class is drawn right on a dark page.
export function hasDarkTheme(token: string): boolean {
  return isSameInBothThemes(token) || isRemappedForDarkTheme(token);
}

// Every colour class the elements under a root draw.
export function colourClassesIn(root: Element): Array<string> {
  const tokens: Set<string> = new Set<string>();

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const classText: string =
      typeof element.className === "string"
        ? element.className
        : element.getAttribute("class") || "";

    for (const token of classText.split(WHITESPACE)) {
      if (token && isColourClass(token)) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens).sort();
}

// The colour classes among them that a dark page would draw in light colours.
export function classesWithoutDarkTheme(
  tokens: ReadonlyArray<string>,
): Array<string> {
  return tokens
    .filter((token: string): boolean => {
      return isColourClass(token) && !hasDarkTheme(token);
    })
    .sort();
}
