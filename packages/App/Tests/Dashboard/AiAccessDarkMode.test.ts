import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "What AI may do" in the dark theme: the shared rows and badges
 * (Components/AiAccess/AiAccessRow.tsx) — now only off (gray) and on
 * (green), with the line that says where the settings are set — and the
 * "Change what AI may do" dialog for settings an agent sets
 * (AgentAiSettingsModal.tsx).
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A
 * class it has no rule for keeps its light colour, and nothing fails. So
 * this holds every colour class the two draw with to what Theme.css
 * actually remaps.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "AiAccess",
);

const SOURCES: Array<string> = ["AiAccessRow.tsx", "AgentAiSettingsModal.tsx"];

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

// Comments hold prose, not classes.
const CODE: string = SOURCES.map((name: string): string => {
  return fs
    .readFileSync(path.join(COMPONENT_DIR, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}).join("\n");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_VALUE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

// Every whitespace-separated token of every string literal in the modules.
function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(STRING_LITERAL)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      TEMPLATE_VALUE,
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

// A mid-tone hue reads the same in both themes; a neutral grey does not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const SUBSTRING_VARIANT: RegExp = /\[class\*="([^"]+)"\]/g;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-amber-"].
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_VARIANT),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
  const utility: string = utilityOf(token);

  // An unprefixed mid-tone hue; a prefixed one needs a rule of its own.
  if (utility === token && SOLID.test(utility)) {
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

  // A focus ring's mid-tone colour reads the same in both themes.
  if (token.startsWith("focus-visible:") && SOLID.test(utility)) {
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

describe("What AI may do in the dark theme", () => {
  test("uses no dark: variants and builds no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring)-\$\{/);
  });

  test("every colour class it draws with is remapped for dark mode", () => {
    // The scan found the colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // Off and on: the only two looks a badge has.
        "bg-gray-50",
        "text-gray-600",
        "bg-emerald-50",
        "text-emerald-700",
        // Where the settings are set, and its action.
        "border-gray-200",
        "text-gray-700",
        "text-indigo-600",
        "hover:text-indigo-800",
        // The keyboard focus ring.
        "focus-visible:ring-indigo-500",
        // The dialog's headings and notes.
        "text-gray-900",
        "text-gray-500",
      ]),
    );

    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  /*
   * A setting looks off (gray) or on (green), whatever the mode. Red is the
   * danger tone, for an AI agent that stopped working (the Overview's
   * Connection badge), never a setting; amber and the rest are not badge
   * looks at all.
   */
  test("on and off are the only looks a setting has: no warning colour on a setting", () => {
    const rowSource: string = fs.readFileSync(
      path.join(COMPONENT_DIR, "AiAccessRow.tsx"),
      "utf8",
    );
    const maps: string =
      rowSource.match(
        /const BADGE_CLASSES[\s\S]*?const ROW_ICON_CLASSES[\s\S]*?};/,
      )?.[0] || "";
    const entries: Array<[string, string]> = Array.from(
      maps.matchAll(/^\s+(\w+): "([^"]*)",$/gm),
      (match: RegExpMatchArray): [string, string] => {
        return [match[1]!, match[2]!];
      },
    );
    const looksOf: (tone: string) => string = (tone: string): string => {
      return entries
        .filter(([name]: [string, string]): boolean => {
          return name === tone;
        })
        .map(([, classes]: [string, string]): string => {
          return classes;
        })
        .join(" ");
    };

    // Harness guard: the three maps were found, each with every tone.
    expect(
      entries.map(([name]: [string, string]): string => {
        return name;
      }),
    ).toEqual([
      "off",
      "on",
      "danger",
      "off",
      "on",
      "danger",
      "off",
      "on",
      "danger",
    ]);

    expect(looksOf("on")).toContain("emerald");
    expect(looksOf("off")).toContain("gray");
    for (const tone of ["off", "on"]) {
      expect(looksOf(tone)).not.toMatch(/amber|yellow|indigo|orange|red-/);
    }
    // Red is danger's alone, and danger has no warning amber either.
    expect(looksOf("danger")).toContain("red-");
    expect(looksOf("danger")).not.toMatch(/amber|yellow/);
  });
});
