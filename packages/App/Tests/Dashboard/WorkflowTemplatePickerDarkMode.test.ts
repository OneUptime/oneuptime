import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The create-a-workflow wizard's template picker in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class it has
 * no rule for keeps its light colour in the dark theme - a white row on a
 * slate dialog - and nothing fails. So this holds every colour class the
 * picker and the wizard around it use to what Theme.css actually remaps.
 *
 * Rendering is covered in Common/Tests/App/Dashboard/WorkflowTemplatePicker
 * .test.tsx and CreateWorkflowModal.test.tsx.
 */

const COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Workflow",
);

/*
 * Every file the picker draws with: the picker, and the wizard that holds it.
 * The util module only builds data, but it is read too, so a class that ever
 * moves into it is still checked.
 */
const SOURCE_PATHS: Array<string> = [
  path.join(COMPONENTS_DIR, "WorkflowTemplatePicker.tsx"),
  path.join(COMPONENTS_DIR, "CreateWorkflowModal.tsx"),
  path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Utils",
    "Workflow",
    "WorkflowTemplatePickerUtil.ts",
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

// Comments hold prose ("a white row on a slate dialog"), not classes.
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

const PICKER_CODE: string = SOURCES[0]!.code;

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: class lists are
 * string literals here (className="...", template literals and the class-name
 * constants), and prose tokens never look like a utility.
 *
 * Two passes. A conditional class sits in a double-quoted string inside a
 * template literal's ${...} (`flex ${isActive ? "bg-indigo-50" : ""}`), and a
 * single pass that takes the template literal whole never sees it: every
 * double-quoted string is read on its own first, then the static text of
 * every template literal.
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

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:bg-indigo-50` is not covered by the `:hover` rule
 * for `hover:bg-indigo-50`, which only fires on the element itself.
 */
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

  /*
   * CSS escaping, as Theme.css writes the class: backslashes first, so the
   * ones added for ":" and "/" are not escaped a second time.
   */
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

describe("the workflow template picker in the dark theme", () => {
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
      const source: { path: string; code: string } | undefined = SOURCES.find(
        (candidate: { path: string }) => {
          return path.basename(candidate.path) === fileName;
        },
      );
      const unmapped: Array<string> = colorTokensOf(source?.code || "").filter(
        (token: string): boolean => {
          return !isRemapped(token);
        },
      );

      expect(unmapped).toEqual([]);
    },
  );

  test("the scan found the picker's colours at all, so it is not vacuous", () => {
    expect(colorTokensOf(PICKER_CODE)).toEqual(
      expect.arrayContaining([
        // Rows: the name, the description, the hover and the highlight.
        "text-gray-900",
        "text-gray-500",
        "hover:bg-gray-50",
        "bg-indigo-50",
        "ring-indigo-200",
        // The icon tiles.
        "bg-gray-100",
        "bg-indigo-100",
        "text-indigo-600",
        // The search box and the plain buttons.
        "border-gray-300",
        "bg-white",
        "placeholder-gray-400",
        // The words a search matched, marked as the Add Component picker marks them.
        "text-indigo-700",
        // The preview panel.
        "bg-gray-50",
        "ring-gray-200",
        // The chosen category.
        "text-indigo-700",
      ]),
    );
  });

  test("the scan reads the classes a condition picks, inside a template literal", () => {
    expect(
      stringTokens(
        'const c = `flex ${isActive ? "bg-indigo-50 ring-indigo-200" : "hover:bg-gray-50"}`;',
      ),
    ).toEqual(
      expect.arrayContaining([
        "bg-indigo-50",
        "ring-indigo-200",
        "hover:bg-gray-50",
        "flex",
      ]),
    );
  });

  test("the scan reads bracketed variants whole, and knows an unmapped variant when it sees one", () => {
    expect(utilityOf("hover:bg-gray-50")).toBe("bg-gray-50");
    expect(utilityOf("[&_a:focus-visible]:ring-indigo-500")).toBe(
      "ring-indigo-500",
    );
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("group-hover/item:text-gray-500")).toBe(false);
  });
});

describe("the workflow template picker's own rules", () => {
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
   * A dialog has one primary button, its footer's: here "Use this template".
   * Nothing in the picker may be drawn as a second one.
   */
  test("the picker draws no filled button", () => {
    const FILLED_BUTTON_FILL: RegExp =
      /^(?:hover:)?bg-(?:indigo|red|green|yellow)-(?:500|600|700)$/;
    const filled: Array<string> = stringTokens(PICKER_CODE).filter(
      (token: string): boolean => {
        return FILLED_BUTTON_FILL.test(token);
      },
    );

    expect(filled).toEqual([]);
    expect(PICKER_CODE).not.toMatch(
      /ButtonStyleType\.(?:PRIMARY|DANGER|SUCCESS|WARNING)/,
    );
  });
});
