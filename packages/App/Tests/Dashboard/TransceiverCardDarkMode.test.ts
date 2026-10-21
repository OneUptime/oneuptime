import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Transceivers card in the dark theme, and where it sits.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has
 * no rule for keeps its light colour in the dark theme - a pale red pill on
 * a slate card - and nothing fails. So this holds every colour class the
 * card, its sparkline and its view model use to what Theme.css remaps.
 *
 * Rendering is covered in Common/Tests/App/Dashboard/TransceiverHealthCard
 * .test.tsx; the rules in TransceiverViewModel.test.ts.
 */

const COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NetworkDevice",
);

const SOURCE_PATHS: Array<string> = [
  path.join(COMPONENTS_DIR, "TransceiverHealthCard.tsx"),
  path.join(COMPONENTS_DIR, "TransceiverRxSparkline.tsx"),
  path.join(COMPONENTS_DIR, "TransceiverViewModel.ts"),
];

const INTERFACES_PAGE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "NetworkDevice",
  "View",
  "Interfaces.tsx",
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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const DOUBLE_QUOTED: RegExp = /"([^"\n]*)"/g;
const TEMPLATE_LITERAL: RegExp = /`([^`]*)`/g;
const TEMPLATE_EXPRESSION: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;
const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
const IDENTIFIER_CHAR: RegExp = /[\w-]/;
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 dot, bar band, marker or sparkline) reads the
 * same in both themes. Neutral greys do not: they are exactly what Theme.css
 * re-colours for a dark card.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring|from|to)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");
}

const SOURCES: Array<{ path: string; code: string }> = SOURCE_PATHS.map(
  (sourcePath: string) => {
    return {
      path: sourcePath,
      code: stripComments(fs.readFileSync(sourcePath, "utf8")),
    };
  },
);

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_RULE),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

// Every whitespace-separated token of every string literal.
function stringTokens(code: string): Array<string> {
  const texts: Array<string> = [];

  for (const match of code.matchAll(DOUBLE_QUOTED)) {
    texts.push(match[1] || "");
  }

  for (const match of code.matchAll(TEMPLATE_LITERAL)) {
    texts.push((match[1] || "").replace(TEMPLATE_EXPRESSION, " "));
  }

  return texts.flatMap((text: string): Array<string> => {
    return text.split(WHITESPACE).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
}

// The utility a token applies, after its variants.
function utilityOf(token: string): string {
  return token.slice(token.lastIndexOf(":") + 1);
}

function isRemapped(token: string): boolean {
  if (SOLID.test(utilityOf(token))) {
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

function colorTokensOf(code: string): Array<string> {
  return Array.from(
    new Set(
      stringTokens(code).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

describe("the Transceivers card in the dark theme", () => {
  test("reads the card, its sparkline and its view model", () => {
    for (const source of SOURCES) {
      expect(source.code.length).toBeGreaterThan(0);
    }

    // A guard against the token scan silently matching nothing.
    expect(colorTokensOf(SOURCES[0]!.code)).toEqual(
      expect.arrayContaining([
        "bg-red-50",
        "text-red-700",
        "bg-emerald-50",
        "text-gray-500",
      ]),
    );
  });

  test.each(
    SOURCES.map((source: { path: string; code: string }) => {
      return [path.basename(source.path), source.code];
    }),
  )(
    "every colour class in %s has a dark-theme rule",
    (_name: string, code: string) => {
      const unmapped: Array<string> = colorTokensOf(code).filter(
        (token: string): boolean => {
          return !isRemapped(token);
        },
      );

      expect(unmapped).toEqual([]);
    },
  );

  test("no dark: variants - Theme.css owns the dark theme", () => {
    for (const source of SOURCES) {
      expect(
        stringTokens(source.code).filter((token: string): boolean => {
          return token.startsWith("dark:");
        }),
      ).toEqual([]);
    }
  });
});

describe("where the card sits", () => {
  const page: string = stripComments(
    fs.readFileSync(INTERFACES_PAGE_PATH, "utf8"),
  );

  test("the device's Interfaces page shows it, for the device on the page", () => {
    expect(page).toContain(
      'import TransceiverHealthCard from "../../../Components/NetworkDevice/TransceiverHealthCard";',
    );
    expect(page).toContain(
      "<TransceiverHealthCard networkDeviceId={modelId} />",
    );
  });

  test("above the interface table, so a failing optic is seen before 48 ports", () => {
    expect(page.indexOf("<TransceiverHealthCard")).toBeLessThan(
      page.indexOf("<ModelTable<NetworkInterface>"),
    );
  });
});
