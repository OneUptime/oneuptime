import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dialogs that add incidents or alerts to an episode, in the dark theme:
 * an episode's Add Alerts / Add Incidents, the lists' Add to Existing
 * Episode and Add to New Episode, the picker list they share, and the link
 * to the episode under a bulk action's result.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has
 * no rule for keeps its light colour in the dark theme - a white row in a
 * slate dialog - and nothing fails. So this holds every colour class these
 * files draw with to what Theme.css actually remaps.
 *
 * Rendering is covered in Common/Tests/App/Dashboard
 * (EpisodeMemberDialogs, BulkAddToEpisodeActions).
 */

const DASHBOARD_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const EPISODE_MEMBERS_DIR: string = path.join(
  DASHBOARD_DIR,
  "Components",
  "EpisodeMembers",
);

// Every file the dialogs draw with.
const SOURCE_PATHS: Array<string> = [
  path.join(EPISODE_MEMBERS_DIR, "EpisodePickerList.tsx"),
  path.join(EPISODE_MEMBERS_DIR, "AddEpisodeMembersModal.tsx"),
  path.join(EPISODE_MEMBERS_DIR, "AddToExistingEpisodeModal.tsx"),
  path.join(EPISODE_MEMBERS_DIR, "AddToNewEpisodeModal.tsx"),
  path.join(EPISODE_MEMBERS_DIR, "BulkAddToEpisodeActions.tsx"),
  path.join(DASHBOARD_DIR, "Pages", "Alerts", "EpisodeView", "Alerts.tsx"),
  path.join(
    DASHBOARD_DIR,
    "Pages",
    "Incidents",
    "EpisodeView",
    "Incidents.tsx",
  ),
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

describe("the episode add dialogs in the dark theme", () => {
  test("reads every file the dialogs draw with", () => {
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

  test("the scan found the dialogs' colours at all, so it is not vacuous", () => {
    // The picker: its rows, the picked row, the search box and the notes.
    expect(colorTokensOf(codeOf("EpisodePickerList.tsx"))).toEqual(
      expect.arrayContaining([
        "bg-indigo-50",
        "hover:bg-gray-50",
        "text-gray-900",
        "bg-white",
        "border-gray-300",
        "text-amber-700",
        "bg-gray-100",
        "divide-gray-100",
      ]),
    );
    // What could not be added.
    expect(colorTokensOf(codeOf("AddEpisodeMembersModal.tsx"))).toEqual(
      expect.arrayContaining(["bg-red-50", "text-red-700"]),
    );
    // The link to the episode under the result.
    expect(colorTokensOf(codeOf("BulkAddToEpisodeActions.tsx"))).toEqual(
      expect.arrayContaining(["text-indigo-600", "hover:text-indigo-700"]),
    );
  });

  test("the scan knows an unmapped class when it sees one", () => {
    expect(utilityOf("hover:bg-gray-50")).toBe("bg-gray-50");
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
    expect(isRemapped("bg-gray-125")).toBe(false);
  });
});
