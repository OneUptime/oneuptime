import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A queue's Broker metrics card, the inline code in its steps and the
 * Broker health section around it, in the dark theme
 * (Components/MessageQueue/MessageQueueBrokerMetricsCard.tsx,
 * MessageQueueInlineCode.tsx and MessageQueueBrokerHealthSection.tsx,
 * #5771): the findings' amber and indigo callouts, the configuration lines,
 * the setup guidance the card holds while none arrived, the metric rows and
 * their links.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-indigo-50` does not cover `hover:bg-indigo-50`). A
 * class it has no rule for keeps its light colour - a pale callout glowing
 * on a slate card - and nothing fails. So this holds every colour class the
 * three draw with to what Theme.css actually remaps.
 *
 * Rendering is covered in
 * Common/Tests/App/Dashboard/MessageQueueBrokerMetricsCard.test.tsx.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "MessageQueue",
);

const SOURCES: Array<string> = [
  "MessageQueueBrokerMetricsCard.tsx",
  "MessageQueueInlineCode.tsx",
  "MessageQueueBrokerHealthSection.tsx",
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

describe("a queue's Broker metrics card and Broker health section in the dark theme", () => {
  test("use no dark: variants and build no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring|divide)-\$\{/);
  });

  test("every colour class they draw with is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The card's rows, words and dividers.
        "text-gray-900",
        "text-gray-700",
        "text-gray-500",
        "divide-gray-100",
        // A finding's callout: amber for what is missing or stopped.
        "border-amber-200",
        "bg-amber-50",
        "text-amber-800",
        "text-amber-900",
        // The setup guidance's dashed grey box, and the section's tiles.
        "border-gray-300",
        "bg-gray-50",
        "border-gray-200",
        // The links to the configuration and the Queues guide.
        "text-indigo-600",
        "text-indigo-700",
        // The inline code of a step.
        "bg-gray-100",
        "text-gray-800",
      ]),
    );

    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the scan judges a variant by its own rule", () => {
    expect(utilityOf("hover:bg-indigo-100")).toBe("bg-indigo-100");
    // A light shade under a variant Theme.css does not know is caught.
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
    expect(isRemapped("hover:bg-amber-200")).toBe(false);
    // An unprefixed light grey needs a rule of its own, and has one.
    expect(isRemapped("text-gray-500")).toBe(true);
  });
});
