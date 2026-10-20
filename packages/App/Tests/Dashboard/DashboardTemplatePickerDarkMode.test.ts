import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Create a dashboard in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has
 * no rule for keeps its light colour in the dark theme - a white row on a
 * slate dialog - and nothing fails. So this holds every colour class the
 * dialog draws with - the shared template picker, the details' rows and
 * chips, the chosen template on the Name step, the dashboard's own details
 * and the wizard - to what Theme.css actually remaps.
 *
 * Rendering is covered in Common/Tests/App/Dashboard/DashboardTemplatePicker
 * .test.tsx and CreateDashboardModal.test.tsx, and the real dark theme in a
 * browser in packages/E2E/DashboardTemplates.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Every file the dialog draws with. The util modules only build data, but
 * they are read too, so a class that ever moves into one is still checked.
 */
const SOURCE_PATHS: Array<string> = [
  path.join(
    DASHBOARD_SRC,
    "Components",
    "TemplatePicker",
    "TemplatePicker.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "TemplatePicker",
    "TemplateDetails.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "TemplatePicker",
    "ChosenTemplate.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Dashboard",
    "DashboardTemplatePicker.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Dashboard",
    "CreateDashboardModal.tsx",
  ),
  path.join(
    DASHBOARD_SRC,
    "Utils",
    "Dashboard",
    "DashboardTemplatePickerUtil.ts",
  ),
  path.join(DASHBOARD_SRC, "Utils", "TemplatePicker", "TemplatePickerUtil.ts"),
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

type StripCommentsFunction = (source: string) => string;

// Comments hold prose ("a white row on a slate dialog"), not classes.
const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");
};

interface Source {
  path: string;
  code: string;
}

const SOURCES: Array<Source> = SOURCE_PATHS.map((sourcePath: string) => {
  return {
    path: sourcePath,
    code: stripComments(fs.readFileSync(sourcePath, "utf8")),
  };
});

// What the dialog draws on its first step: the shared step, its details' parts, and the dashboard's details.
const PICKER_CODE: string = [SOURCES[0]!, SOURCES[1]!, SOURCES[3]!]
  .map((source: Source): string => {
    return source.code;
  })
  .join("\n");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const DOUBLE_QUOTED: RegExp = /"([^"\n]*)"/g;
const TEMPLATE_LITERAL: RegExp = /`([^`]*)`/g;
const TEMPLATE_HOLE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: class lists are
 * string literals here, and prose tokens never look like a utility. Two
 * passes, so a class a condition picks inside a template literal's ${...}
 * is read too.
 */
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const texts: Array<string> = [];

  for (const match of code.matchAll(DOUBLE_QUOTED)) {
    texts.push(match[1] || "");
  }

  for (const match of code.matchAll(TEMPLATE_LITERAL)) {
    texts.push((match[1] || "").replace(TEMPLATE_HOLE, " "));
  }

  return texts.flatMap((text: string): Array<string> => {
    return text.split(WHITESPACE).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
};

type UtilityOfFunction = (token: string) => string;

/*
 * The utility a token applies, after its variants. An arbitrary variant's
 * brackets may hold a colon of their own, so the split skips anything inside
 * brackets.
 */
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
 * A mid-tone hue (a 500 or 600 fill, ring or icon) reads the same in both
 * themes. Neutral greys do not: gray-500 text is what Theme.css re-colours
 * for a dark card, so a grey is only fine where a rule of its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;
const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:bg-indigo-50` is not covered by the `:hover` rule
 * for `hover:bg-indigo-50`, which only fires on the element itself.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_RULE),
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

  /*
   * CSS escaping, as Theme.css writes the class: backslashes first, so the
   * ones added for ":" and "/" are not escaped a second time.
   */
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

const COLOR_FROM_TEMPLATE: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

describe("Create a dashboard in the dark theme", () => {
  test("no file uses dark: variants or builds a colour class from a template", () => {
    for (const source of SOURCES) {
      expect({
        file: path.basename(source.path),
        dark: source.code.includes("dark:"),
        built: COLOR_FROM_TEMPLATE.test(source.code),
      }).toEqual({
        file: path.basename(source.path),
        dark: false,
        built: false,
      });
    }
  });

  test.each(
    SOURCE_PATHS.map((sourcePath: string) => {
      return [path.basename(sourcePath)];
    }),
  )(
    "every colour class in %s is remapped for dark mode",
    (fileName: string) => {
      const source: Source | undefined = SOURCES.find((candidate: Source) => {
        return path.basename(candidate.path) === fileName;
      });
      const unmapped: Array<string> = colorTokensOf(source?.code || "").filter(
        (token: string): boolean => {
          return !isRemapped(token);
        },
      );

      expect(unmapped).toEqual([]);
    },
  );

  test("the scan found the dialog's colours at all, so it is not vacuous", () => {
    expect(colorTokensOf(PICKER_CODE)).toEqual(
      expect.arrayContaining([
        // Start from scratch: the card, its hover, the start chosen.
        "border-gray-200",
        "bg-white",
        "hover:border-indigo-300",
        "border-indigo-500",
        // Rows: the name, the description, the hover and the pick.
        "text-gray-900",
        "text-gray-500",
        "hover:bg-gray-50",
        "bg-indigo-50/60",
        // The list's frame, and the lines between its rows and groups.
        "divide-gray-200",
        "divide-gray-100",
        // The search box and the category select.
        "border-gray-300",
        "placeholder-gray-400",
        // A picked template's widget chips, and its variables.
        "ring-gray-200",
        "text-gray-700",
      ]),
    );
    // The chosen template on the Name step.
    expect(colorTokensOf(SOURCES[2]!.code)).toEqual(
      expect.arrayContaining(["border-indigo-100", "bg-indigo-100"]),
    );
  });
});

describe("the dialog's own rules", () => {
  /*
   * Bootstrap 3 and HTML5 Boilerplate ship `.hidden { display: none
   * !important }`, and a browser that carries it hides a bare `hidden` at
   * every width, whatever un-hides it. The picker switches its layout by
   * screen width, so it must only ever hide with a variant.
   */
  test("nothing is hidden with a bare `hidden` class", () => {
    for (const source of SOURCES) {
      expect({
        file: path.basename(source.path),
        bareHidden: stringTokens(source.code).includes("hidden"),
      }).toEqual({ file: path.basename(source.path), bareHidden: false });
    }
  });

  /*
   * A dialog has one primary button, its footer's: Use this template is
   * plain, and Create Dashboard is the action. Nothing on the first step may
   * look like a second one.
   */
  test("the first step draws no filled button", () => {
    const FILLED_BUTTON_FILL: RegExp =
      /^(?:hover:)?bg-(?:indigo|red|green|yellow)-(?:500|600|700)$/;
    const filled: Array<string> = stringTokens(PICKER_CODE).filter(
      (token: string): boolean => {
        return FILLED_BUTTON_FILL.test(token);
      },
    );

    expect(filled).toEqual([]);
  });
});
