import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The folded sections (FoldedSection, and CollapsibleFormSection and
 * AdvancedPageSection, which draw through it) in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has no
 * rule for keeps its light colour in the dark theme - a white header on a
 * slate dialog, a pale chip that glows - and nothing fails. So this holds
 * every colour class the folds use to what Theme.css actually remaps.
 */

const COMPONENTS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Components",
);

const FILES: Array<string> = [
  path.join(COMPONENTS, "FoldedSection", "FoldedSection.tsx"),
  path.join(COMPONENTS, "Forms", "CollapsibleFormSection.tsx"),
  path.join(COMPONENTS, "AdvancedPageSection", "AdvancedPageSection.tsx"),
];

const THEME_CSS: string = fs
  .readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "UI", "Styles", "Theme.css"),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, " ");

// Comments hold prose, not classes.
function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

const CODE: string = FILES.map(codeOf).join("\n");

/*
 * Every whitespace-separated token of every string: the double-quoted ones
 * wherever they are - inside a template literal's ${...} too, where a
 * ternary picks a tile's colours - and the static text of the template
 * literals themselves.
 */
function stringTokens(code: string): Array<string> {
  const texts: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"/g)) {
    texts.push(match[1] ?? "");
  }

  for (const match of code.matchAll(/`([^`]*)`/g)) {
    texts.push((match[1] ?? "").replace(/\$\{[\s\S]*?\}/g, " "));
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

// A mid-tone hue (500 or 600) reads the same in both themes; greys do not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

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

  if (SOLID.test(utility) && utility === token.replace(/^focus-visible:/, "")) {
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

    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    stringTokens(CODE).filter((token: string): boolean => {
      return COLOR_UTILITY.test(utilityOf(token));
    }),
  ),
);

describe("folded sections in the dark theme", () => {
  test("use no dark: variants and build no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(
      /(?:bg|text|border|ring|divide|from|via|to)-\$\{/,
    );
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The frame and the header.
        "border-gray-200",
        "bg-white",
        "hover:bg-gray-50",
        "text-gray-900",
        // The pills of what is inside, and the sentences under them.
        "text-gray-600",
        "ring-gray-200",
        "text-gray-500",
        // The chips of what is set.
        "bg-indigo-50",
        "text-indigo-700",
        "ring-indigo-200",
        // The icon tile, grey or tinted.
        "bg-gray-100",
        "text-indigo-600",
        // The chevron.
        "text-gray-400",
        // The keyboard focus ring.
        "focus-visible:ring-indigo-500",
      ]),
    );

    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
