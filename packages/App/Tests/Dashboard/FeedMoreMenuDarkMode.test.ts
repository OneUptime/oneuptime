import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A feed's ⋯ menu, its event type filter and the box over a filtered feed,
 * in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has
 * no rule for keeps its light colour in the dark theme - a white checklist
 * row in a slate dialog - and nothing fails. So this holds every colour class
 * the feed card, its menu, the filter dialog and checklist, the filter box
 * and the shared card-header ⋯ draw with to what Theme.css actually remaps.
 *
 * Rendering is covered in Common/Tests/UI/Components (FeedCard, FeedMoreMenu,
 * FeedFilterModal, FeedEventTypeChecklist, FeedFilterSummary, AppliedFilters).
 */

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "Common");

const COMPONENTS_DIR: string = path.join(COMMON_DIR, "UI", "Components");

// Every file the feed's controls draw with.
const SOURCE_PATHS: Array<string> = [
  path.join(COMPONENTS_DIR, "Feed", "FeedCard.tsx"),
  path.join(COMPONENTS_DIR, "Feed", "FeedActionsMenu.tsx"),
  path.join(COMPONENTS_DIR, "Feed", "FeedMoreMenu.tsx"),
  path.join(COMPONENTS_DIR, "Feed", "FeedFilterModal.tsx"),
  path.join(COMPONENTS_DIR, "Feed", "FeedEventTypeChecklist.tsx"),
  path.join(COMPONENTS_DIR, "Feed", "FeedFilterSummary.tsx"),
  path.join(COMPONENTS_DIR, "Filters", "AppliedFilters.tsx"),
  path.join(COMPONENTS_DIR, "Card", "CardMoreMenu.tsx"),
];

const THEME_CSS_PATH: string = path.join(
  COMMON_DIR,
  "UI",
  "Styles",
  "Theme.css",
);

type StripCommentsFunction = (source: string) => string;

// Comments hold prose, not classes.
const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
};

const SOURCES: Array<{ path: string; code: string }> = SOURCE_PATHS.map(
  (sourcePath: string) => {
    return {
      path: sourcePath,
      code: stripComments(fs.readFileSync(sourcePath, "utf8")),
    };
  },
);

type CodeOfFunction = (fileName: string) => string;

const codeOf: CodeOfFunction = (fileName: string): string => {
  return (
    SOURCES.find((source: { path: string }): boolean => {
      return path.basename(source.path) === fileName;
    })?.code || ""
  );
};

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: class lists are
 * string literals here (className="..." and template literals). A
 * conditional class sits in a double-quoted string inside a template
 * literal's ${...}, so every double-quoted string is read on its own first,
 * then the static text of every template literal.
 */
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const texts: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"/g)) {
    texts.push(match[1] || "");
  }

  for (const match of code.matchAll(/`([^`]*)`/g)) {
    texts.push((match[1] || "").replace(/\$\{[^}]*\}/g, " "));
  }

  return texts.flatMap((text: string): Array<string> => {
    return text.split(/\s+/).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
};

type UtilityOfFunction = (token: string) => string;

// The utility a token applies, after its variants (brackets kept whole).
const utilityOf: UtilityOfFunction = (token: string): string => {
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
};

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder|accent)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 fill, ring, icon, accent or focus ring) reads
 * the same in both themes. Neutral greys do not: gray-500 text is what
 * Theme.css re-colours for a dark card, so a grey is only fine where a rule
 * says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring|accent)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-indigo-"]:hover.
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

type IsRemappedFunction = (token: string) => boolean;

const isRemapped: IsRemappedFunction = (token: string): boolean => {
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
};

type ColorTokensFunction = (code: string) => Array<string>;

const colorTokensOf: ColorTokensFunction = (code: string): Array<string> => {
  return Array.from(
    new Set(
      stringTokens(code).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
};

describe("a feed's ⋯ menu, filter dialog and filter box in the dark theme", () => {
  test("reads every file the feed's controls draw with", () => {
    for (const sourcePath of SOURCE_PATHS) {
      expect({ file: sourcePath, exists: fs.existsSync(sourcePath) }).toEqual({
        file: sourcePath,
        exists: true,
      });
    }
  });

  test("no file uses dark: variants or builds a colour class from a template", () => {
    for (const source of SOURCES) {
      expect({
        file: path.basename(source.path),
        dark: source.code.includes("dark:"),
      }).toEqual({
        file: path.basename(source.path),
        dark: false,
      });
      expect(source.code).not.toMatch(
        /(?:bg|text|border|ring|divide|from|via|to)-\$\{/,
      );
    }
  });

  test.each(
    SOURCE_PATHS.map((sourcePath: string) => {
      return [path.basename(sourcePath)];
    }),
  )(
    "every colour class in %s is remapped for dark mode",
    (fileName: string) => {
      const unmapped: Array<string> = colorTokensOf(codeOf(fileName)).filter(
        (token: string): boolean => {
          return !isRemapped(token);
        },
      );

      expect(unmapped).toEqual([]);
    },
  );

  test("the scan found the controls' colours at all, so it is not vacuous", () => {
    // The checklist: its rows, the search box, the summary and Show all.
    expect(colorTokensOf(codeOf("FeedEventTypeChecklist.tsx"))).toEqual(
      expect.arrayContaining([
        "text-gray-500",
        "text-gray-700",
        "hover:bg-gray-50",
        "bg-white",
        "border-gray-300",
        "text-gray-900",
        "text-indigo-600",
      ]),
    );
    // The filter box: its frame, chips and buttons.
    expect(colorTokensOf(codeOf("AppliedFilters.tsx"))).toEqual(
      expect.arrayContaining([
        "bg-gray-50",
        "border-gray-200",
        "bg-white",
        "text-gray-700",
        "text-gray-900",
      ]),
    );
    // The feed's chips.
    expect(colorTokensOf(codeOf("FeedFilterSummary.tsx"))).toEqual(
      expect.arrayContaining(["text-gray-800", "text-gray-400"]),
    );
    // The Actions button beside the ⋯.
    expect(colorTokensOf(codeOf("FeedActionsMenu.tsx"))).toEqual(
      expect.arrayContaining([
        "border-gray-300",
        "bg-white",
        "text-gray-700",
        "hover:bg-gray-50",
        "hover:border-gray-400",
        "hover:text-gray-900",
      ]),
    );
  });

  test("the scan knows an unmapped class when it sees one", () => {
    expect(utilityOf("hover:bg-gray-50")).toBe("bg-gray-50");
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
    expect(isRemapped("bg-gray-125")).toBe(false);
  });
});
