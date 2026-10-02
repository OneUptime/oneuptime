import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The owners picker and the Owners card in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has
 * no rule for keeps its light colour in the dark theme - a white search list
 * over a slate dialog - and nothing fails. So this holds every colour class
 * the picker, its search list, its chips and avatars, the Owners card and
 * the owners table cell use to what Theme.css actually remaps.
 *
 * Rendering is covered in Common/Tests/UI/Components/PeoplePicker and
 * Common/Tests/App/Dashboard/OwnersCard.test.tsx.
 */

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "Common");

const PICKER_DIR: string = path.join(
  COMMON_DIR,
  "UI",
  "Components",
  "PeoplePicker",
);

const DASHBOARD_COMPONENTS: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

// Every file the picker and the card draw with.
const SOURCE_PATHS: Array<string> = [
  ...fs
    .readdirSync(PICKER_DIR)
    .filter((name: string): boolean => {
      return TYPESCRIPT_FILE.test(name);
    })
    .sort()
    .map((name: string): string => {
      return path.join(PICKER_DIR, name);
    }),
  path.join(DASHBOARD_COMPONENTS, "Owners", "OwnersCard.tsx"),
  path.join(DASHBOARD_COMPONENTS, "ResourceOwners", "OwnersCell.tsx"),
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
 * string literals here (className="...", template literals and the palette
 * constants). A conditional class sits in a double-quoted string inside a
 * template literal's ${...}, so every double-quoted string is read on its
 * own first, then the static text of every template literal.
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 fill, ring, icon or gradient stop) reads the
 * same in both themes. Neutral greys do not: gray-500 text is what Theme.css
 * re-colours for a dark card, so a grey is only fine where a rule says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring|from|to)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

/*
 * A team's avatar is a dark tile on purpose, in both themes - the group
 * initials on near-black, ringed - so its gradient stops stay as they are.
 */
const DARK_TILE_STOPS: Array<string> = [
  "from-slate-700",
  "to-slate-900",
  "from-gray-700",
  "to-gray-900",
  "from-stone-700",
  "to-stone-900",
  "from-zinc-700",
  "to-zinc-900",
  "from-neutral-700",
  "to-neutral-900",
];

/*
 * Classes that are right in both themes without a rule, and why. Anything
 * else Theme.css does not remap keeps its light colour in the dark theme.
 */
const RIGHT_IN_BOTH_THEMES: Record<string, string> = {
  // The house colour of a form field's error, as FormField draws its own.
  "text-red-400": "a light red reads on white and on slate",
  // The Owners card's round add button turns indigo-600 under the pointer.
  "hover:text-white": "white on the indigo-600 hover fill, in both themes",
};

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

  if (
    SOLID.test(utility) ||
    DARK_TILE_STOPS.includes(token) ||
    token in RIGHT_IN_BOTH_THEMES
  ) {
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

describe("the owners picker in the dark theme", () => {
  test("reads the picker's folder, the Owners card and the owners cell", () => {
    expect(
      SOURCE_PATHS.map((sourcePath: string): string => {
        return path.basename(sourcePath);
      }),
    ).toEqual(
      expect.arrayContaining([
        "PeoplePicker.tsx",
        "PeopleSearchPopup.tsx",
        "PeopleList.tsx",
        "PeopleAvatar.tsx",
        "OwnersPicker.tsx",
        "OwnersCard.tsx",
        "OwnersCell.tsx",
      ]),
    );
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

  test("the scan found the picker's colours at all, so it is not vacuous", () => {
    // The search list: the panel, the box, the rows and the picked tick.
    expect(colorTokensOf(codeOf("PeopleSearchPopup.tsx"))).toEqual(
      expect.arrayContaining([
        "bg-white",
        "ring-gray-200",
        "bg-gray-50",
        "border-gray-200",
        "text-gray-900",
        "text-gray-500",
        "text-indigo-600",
      ]),
    );
    // The chips.
    expect(colorTokensOf(codeOf("PeopleList.tsx"))).toEqual(
      expect.arrayContaining(["bg-white", "ring-gray-200", "text-gray-900"]),
    );
    // The Owners card's empty state and its add button.
    expect(colorTokensOf(codeOf("OwnersCard.tsx"))).toEqual(
      expect.arrayContaining(["bg-gray-50/60", "border-gray-200", "bg-white"]),
    );
  });

  test("the scan knows an unmapped class when it sees one", () => {
    expect(utilityOf("hover:bg-gray-50")).toBe("bg-gray-50");
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
    expect(isRemapped("bg-gray-125")).toBe(false);
  });
});
