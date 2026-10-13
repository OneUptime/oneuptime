/*
 * What a dark-mode guard reads out of UI source: every colour class a set of
 * files uses, and which of them Theme.css does not re-colour.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant (`.bg-gray-50` does not cover `hover:bg-gray-50`). A class without
 * a rule keeps its light colour - a near-white box on a slate panel - and
 * nothing fails. A guard lists the files a surface draws with and holds
 * their colour classes to what Theme.css actually remaps.
 *
 * The same reading as the guards that carry their own copy of it
 * (ComponentSettingsModalDarkMode, ValuePickerDarkMode and the others), kept
 * in one place for the guards written since.
 */

import fs from "fs";
import path from "path";

const UI_DIR: string = path.join(__dirname, "..", "..", "UI");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose ("a near-white box"), not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: class lists are
 * string literals (className="...", a tone table), and prose tokens never
 * look like a utility.
 *
 * Read in two passes. A class list that depends on something is a template
 * with its choices inside it - `rounded ${isActive ? "bg-indigo-50" :
 * "hover:bg-gray-50"}` - and reading the template as one literal, with its
 * `${...}` taken out, loses exactly those choices: the colours most likely
 * to be new. So the quoted strings are read wherever they are, in a template
 * or not, and then each template's own words.
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
 * brackets may hold a colon of their own ("[&>section]:"), so the split skips
 * anything inside brackets.
 */
const utilityOf: UtilityOfFunction = (token: string): string => {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let i: number = 0; i < token.length; i++) {
    const character: string = token.charAt(i);

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
 * A mid-tone hue (a 500 or 600 icon or fill) reads the same in both themes.
 * Neutral greys do not: gray-500 text is what Theme.css re-colours for a dark
 * card, so a grey is only fine where a rule of its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class built from a template, which no scan could check.
const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith: a
 * `group-hover:` token is not covered by a rule for `hover:`.
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

/** Whether Theme.css re-colours this class token for the dark theme. */
export const isRemappedForDarkMode: IsRemappedFunction = (
  token: string,
): boolean => {
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
    const next: string =
      THEME_CSS.charAt(from + escapedClass.length + 1) || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
};

export interface DarkModeScan {
  // Every colour class the files use, once each.
  colorTokens: Array<string>;
  // The ones Theme.css has no dark rule for, and that are not meant to stay.
  unmapped: Array<string>;
  // Files that use a dark: variant, which the theme does not go by.
  filesUsingDarkVariant: Array<string>;
  // Files that build a colour class from a template, which no scan can check.
  filesWithTemplatedColour: Array<string>;
}

type ScanDarkModeFunction = (data: {
  // Paths under Common/UI.
  files: Array<string>;
  // Classes that are right in both themes on purpose.
  sameInBothThemes?: Array<string> | undefined;
}) => DarkModeScan;

/** Reads the files' colour classes and holds them to Theme.css. */
export const scanDarkMode: ScanDarkModeFunction = (data: {
  files: Array<string>;
  sameInBothThemes?: Array<string> | undefined;
}): DarkModeScan => {
  const same: Array<string> = data.sameInBothThemes || [];
  const codeByFile: Record<string, string> = {};

  for (const file of data.files) {
    codeByFile[file] = readCode(file);
  }

  const colorTokens: Array<string> = Array.from(
    new Set(
      Object.values(codeByFile)
        .flatMap(stringTokens)
        .filter((token: string): boolean => {
          return COLOR_UTILITY.test(utilityOf(token));
        }),
    ),
  );

  return {
    colorTokens: colorTokens,
    unmapped: colorTokens.filter((token: string): boolean => {
      return !isRemappedForDarkMode(token) && !same.includes(token);
    }),
    filesUsingDarkVariant: data.files.filter((file: string): boolean => {
      return (codeByFile[file] as string).includes("dark:");
    }),
    filesWithTemplatedColour: data.files.filter((file: string): boolean => {
      return TEMPLATED_COLOUR.test(codeByFile[file] as string);
    }),
  };
};
