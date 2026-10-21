import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The AI Insights pages - a cluster's and a resource's, the Incidents' and
 * Alerts' (AiActivityInsightsView and AiActivityInsightsPage, with the tone
 * of each insight in AiActivityInsightsData) - and the AI Insights inbox's
 * lead (InsightHighlights).
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has no
 * rule for keeps its light colour in the dark theme - a near-white badge on a
 * slate card - and nothing fails. So this holds every colour class these
 * pages use to what Theme.css actually remaps. Rendering is covered in
 * Common/Tests/App/Dashboard/AiActivityInsightsPage.test.tsx,
 * IncidentAlertAiInsightsPage.test.tsx and AIInsightHighlights.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const FILES: Array<string> = [
  "Components/AI/ActivityInsights/AiActivityInsightsData.ts",
  "Components/AI/ActivityInsights/AiActivityInsightsView.tsx",
  "Components/AI/ActivityInsights/AiActivityInsightsPage.tsx",
  "Components/AIInsights/InsightHighlights.tsx",
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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function readCode(file: string): string {
  // Comments hold prose ("a quiet rule at their left"), not classes.
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_HOLE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

/*
 * Every whitespace-separated token of every string literal in a module:
 * class lists are string literals here (className="...", the class-name
 * constants and the tone tables), and prose tokens never look like a
 * utility.
 */
function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(STRING_LITERAL)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      TEMPLATE_HOLE,
      " ",
    );

    tokens.push(
      ...text.split(WHITESPACE).filter((token: string): boolean => {
        return token.length > 0;
      }),
    );
  }

  return tokens;
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

/*
 * A mid-tone hue (a 400, 500 or 600 fill, ring or icon) reads the same in
 * both themes. Neutral greys do not: gray-500 text is what Theme.css
 * re-colours for a dark card, so a grey is only fine where a rule of its
 * own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:400|500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;
const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith, never
 * includes.
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

  // CSS escaping, as Theme.css writes the class.
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

const TEMPLATED_COLOR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

describe.each(FILES)("%s in the dark theme", (file: string) => {
  const code: string = readCode(file);

  test("uses no dark: variants and builds no colour class from a template", () => {
    expect(code).not.toContain("dark:");
    expect(code).not.toMatch(TEMPLATED_COLOR);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    const tokens: Array<string> = colorTokensOf(code);

    // The scan found colours at all, so this is not vacuous.
    expect(tokens.length).toBeGreaterThan(0);
    expect(
      tokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});

describe("the AI Insights pages' colours", () => {
  test("each insight's tone badge is a pale tint behind a mid-tone icon, both remapped", () => {
    const tones: Array<string> = Array.from(
      readCode(FILES[0]!).matchAll(
        /\[AiActivityInsightTone\.\w+\]: "(bg-[a-z]+-50 text-[a-z]+-600)"/g,
      ),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    // Critical, Warning, Pattern and Positive.
    expect(tones).toEqual([
      "bg-red-50 text-red-600",
      "bg-amber-50 text-amber-600",
      "bg-indigo-50 text-indigo-600",
      "bg-green-50 text-green-600",
    ]);

    for (const tone of tones) {
      for (const token of tone.split(" ")) {
        expect({ token, remapped: isRemapped(token) }).toEqual({
          token,
          remapped: true,
        });
      }
    }
  });

  test("the badges beside a headline are remapped too", () => {
    const view: string = readCode(FILES[1]!);

    for (const badge of [
      "bg-red-50 text-red-700",
      "bg-amber-50 text-amber-700",
      "bg-indigo-50 text-indigo-700",
      "bg-green-50 text-green-700",
    ]) {
      expect(view).toContain(`"${badge}"`);

      for (const token of badge.split(" ")) {
        expect({ token, remapped: isRemapped(token) }).toEqual({
          token,
          remapped: true,
        });
      }
    }
  });

  test("the inbox lead's tiles are remapped, whatever the finding's severity", () => {
    const presentation: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/AIInsights/InsightPresentation.tsx"),
      "utf8",
    );
    const tiles: Array<string> = Array.from(
      presentation
        .slice(presentation.indexOf("SEVERITY_TILE_CLASSES"))
        .matchAll(/\]: "([^"]+)"/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ).slice(0, 3);

    expect(tiles.length).toBe(3);

    for (const tile of [...tiles, "bg-gray-100 text-gray-500"]) {
      for (const token of tile.split(" ")) {
        expect({ token, remapped: isRemapped(token) }).toEqual({
          token,
          remapped: true,
        });
      }
    }
  });

  // Negative control: the check does refuse a class Theme.css has no rule for.
  test("a pale tint Theme.css does not remap is caught", () => {
    expect(isRemapped("bg-lime-50")).toBe(false);
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("text-indigo-600")).toBe(true);
  });
});
