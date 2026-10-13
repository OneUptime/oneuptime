import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Push Notification Devices card in the dark theme: each device's icon
 * tile and kind, the Critical Alerts statuses (On, Off, Not available in
 * browsers) and their link, and the steps dialog - its phone, numbered
 * steps, "once it's on" note, fixes and store links
 * (Components/NotificationMethods).
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A
 * class it has no rule for keeps its light colour - a pale badge glowing on
 * a slate card - and nothing fails. So this holds every colour class the
 * card and its dialog draw with to what Theme.css actually remaps. The
 * browser check is the push registration E2E suite's dark screenshots.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NotificationMethods",
);

// The card, and the two pieces the critical alerts redesign drew it with.
const COMPONENT_FILES: Array<string> = [
  "Push.tsx",
  "PushDeviceCriticalAlertStatus.tsx",
  "PushDeviceCriticalAlertSteps.tsx",
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

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}

function codeOf(name: string): string {
  return code(path.join(COMPONENT_DIR, name));
}

const COMPONENT_CODE: string = COMPONENT_FILES.map((name: string): string => {
  return codeOf(name);
}).join("\n");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_VALUE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

// Every whitespace-separated token of every string literal in the code.
function stringTokens(source: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of source.matchAll(STRING_LITERAL)) {
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
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;
const TEMPLATED_COLOR: RegExp = /(?:bg|text|border|ring)-\$\{/;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-indigo-"].
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
  if (
    (token.startsWith("focus-visible:") || token.startsWith("focus:")) &&
    SOLID.test(utility)
  ) {
    return true;
  }

  const escapedClass: string = token
    .replace(BACKSLASH, "\\\\")
    .replace(COLON, "\\:")
    .replace(SLASH, "\\/");
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

function colorTokens(source: string): Array<string> {
  return Array.from(
    new Set(
      stringTokens(source).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

describe("the push devices card in the dark theme", () => {
  test("the scan reads the card and both pieces of its critical alerts", () => {
    for (const name of COMPONENT_FILES) {
      expect(fs.existsSync(path.join(COMPONENT_DIR, name))).toBe(true);
    }
  });

  test("they use no dark: variants and build no colour class from a template", () => {
    expect(COMPONENT_CODE).not.toContain("dark:");
    expect(COMPONENT_CODE).not.toMatch(TEMPLATED_COLOR);
  });

  test("the statuses draw with the colours they mean, in both themes", () => {
    const status: Array<string> = colorTokens(
      codeOf("PushDeviceCriticalAlertStatus.tsx"),
    );

    // The scan found their colours at all, so the check below is not vacuous.
    expect(status).toEqual(
      expect.arrayContaining([
        // On: a calm green badge.
        "bg-emerald-50",
        "text-emerald-700",
        "ring-emerald-200",
        // Off: a grey one.
        "bg-gray-50",
        "text-gray-700",
        "ring-gray-200",
        // Not available: a dashed outline, nothing filled.
        "border-gray-300",
        "text-gray-500",
        // The link to the steps.
        "text-indigo-600",
        "hover:text-indigo-500",
      ]),
    );
  });

  test("every colour class the card and its dialog draw with is remapped for dark mode", () => {
    const tokens: Array<string> = colorTokens(COMPONENT_CODE);

    expect(tokens).toEqual(
      expect.arrayContaining([
        // The device's icon tile and its kind.
        "bg-gray-50",
        "text-gray-500",
        "ring-gray-200",
        "text-gray-900",
        // The dialog's phone, numbered steps and "once it's on" note.
        "bg-white",
        "bg-indigo-50",
        "text-indigo-700",
        "ring-indigo-200",
        "ring-indigo-100",
        "text-gray-700",
        "text-gray-600",
        // The fixes' bullets, drawn in their text colour (bg-current).
        "text-gray-400",
        // The address the app connects to, as code.
        "bg-gray-100",
      ]),
    );

    expect(
      tokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
