import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The 'Preview' link in the dark theme
 * (Components/Incident/SubscriberNotificationPreviewButton.tsx): the link
 * colour, its hover, the grey it turns with nothing to preview, and the
 * keyboard focus ring - and the two lines it sits on, beside the Yes of
 * Declare Incident's summary and beside the note composer's notify box.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.text-indigo-600` does not cover
 * `hover:text-indigo-600`). A class it has no rule for keeps its light
 * colour and nothing fails, so this holds every colour class the link draws
 * with to what Theme.css actually remaps.
 *
 * Rendering is covered in
 * Common/Tests/App/Dashboard/SubscriberNotificationPreviewButton.test.tsx,
 * and the real colours in a browser, in both themes, in the offline Event
 * Notes suite (packages/E2E/EventNotes).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LINK_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Incident",
  "SubscriberNotificationPreviewButton.tsx",
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

// Comments hold prose, not classes.
function codeOf(filePath: string): string {
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

const CODE: string = codeOf(LINK_PATH);

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_VALUE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

// Every whitespace-separated token of every string literal in the module.
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|decoration)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

// A mid-tone hue reads the same in both themes; a neutral grey does not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const SUBSTRING_VARIANT: RegExp = /\[class\*="([^"]+)"\]/g;

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

function colorTokensOf(code: string): Array<string> {
  return Array.from(
    new Set(
      stringTokens(code).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

const COLOR_TOKENS: Array<string> = colorTokensOf(CODE);

// The class string of the element a test id marks, as written in a source.
function classNameBefore(source: string, testId: string): string {
  const at: number = source.indexOf(`data-testid="${testId}"`);

  expect(at).toBeGreaterThan(-1);

  const opening: number = source.lastIndexOf("<div", at);
  const tag: string = source.slice(opening, at);
  const match: RegExpMatchArray | null = tag.match(/className="([^"]*)"/);

  expect(match).not.toBeNull();
  return match![1]!;
}

describe("the 'Preview' link in the dark theme", () => {
  test("uses no dark: variants and builds no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring)-\$\{/);
  });

  test("every colour class it draws with is remapped for dark mode", () => {
    // The scan found its colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The link colour, and its hover.
        "text-indigo-600",
        "hover:text-indigo-700",
        // The grey it turns with nothing to preview.
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

  /*
   * Theme.css paints the link colour and its hover the same light indigo
   * (#a5b4fc), so in the dark theme a colour change alone would not show the
   * pointer is on it. The underline does, in both themes.
   */
  test("its hover shows in the dark theme too: an underline, not only a colour", () => {
    expect(CODE).toContain(
      '"cursor-pointer text-indigo-600 hover:text-indigo-700 hover:underline"',
    );
    expect(CODE).toContain("underline-offset-2");
  });

  test("it draws no surface of its own to re-colour: no background, border or shadow", () => {
    const tokens: Array<string> = stringTokens(CODE);
    const SURFACE: RegExp = /^(?:[a-z-]+:)*(?:bg|border|shadow)(?:-|$)/;

    expect(
      tokens.filter((token: string): boolean => {
        return SURFACE.test(token);
      }),
    ).toEqual([]);
  });

  test("the scan judges a variant by its own rule", () => {
    expect(utilityOf("hover:text-indigo-700")).toBe("text-indigo-700");
    expect(isRemapped("hover:text-indigo-700")).toBe(true);
    // A light shade under a variant Theme.css does not know is caught.
    expect(isRemapped("disabled:text-gray-400")).toBe(false);
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
  });
});

describe("the lines it sits on draw no colour of their own", () => {
  test("beside the Yes on Declare Incident's summary", () => {
    const className: string = classNameBefore(
      codeOf(path.join(DASHBOARD_SRC, "Pages", "Incidents", "Create.tsx")),
      "incident-create-notify-subscribers-line",
    );

    expect(className).toBe("flex flex-wrap items-center gap-x-3 gap-y-1");
    expect(colorTokensOf(`"${className}"`)).toEqual([]);
  });

  test("beside the note composer's notify box", () => {
    const className: string = classNameBefore(
      codeOf(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "EventNotes",
          "NoteComposer.tsx",
        ),
      ),
      "note-notify-line",
    );

    expect(className).toBe("flex flex-wrap items-center gap-x-3 gap-y-0.5");
    expect(colorTokensOf(`"${className}"`)).toEqual([]);
  });
});
