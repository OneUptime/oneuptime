import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TABLE_EMPTY_STATE_KIND_STYLES,
  TableEmptyStateKind,
} from "../../../../UI/Components/Table/TableEmptyState";

/*
 * Every table's empty state in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant (`.bg-gray-50` does not cover `hover:bg-gray-50`). A class without
 * a rule keeps its light colour - a white tile on a slate card, a pale
 * indigo card behind it - and nothing fails. The empty state is on every
 * empty table in the product, so this holds every colour class it uses to
 * what Theme.css actually remaps.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose ("a white tile"), not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: the template
 * literals' own text, and every quoted string - including the ones inside a
 * template's ${...}.
 */
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const texts: Array<string> = [];

  for (const match of code.matchAll(/`([^`]*)`/g)) {
    texts.push((match[1] || "").replace(/\$\{[^}]*\}/g, " "));
  }

  for (const match of code.matchAll(/"([^"\n]*)"/g)) {
    texts.push(match[1] || "");
  }

  return texts.flatMap((text: string): Array<string> => {
    return text.split(/\s+/).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
};

type UtilityOfFunction = (token: string) => string;

// The utility a token applies, after its variants.
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 icon) reads the same in both themes. Neutral
 * greys do not, so a grey is only fine where a rule of its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class built from a template, which no scan could check.
const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

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

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string =
      THEME_CSS.charAt(from + escapedClass.length + 1) || " ";

    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
};

type ColorTokensFunction = (code: string) => Array<string>;

const colorTokens: ColorTokensFunction = (code: string): Array<string> => {
  return Array.from(
    new Set(
      stringTokens(code).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
};

const EMPTY_STATE_CODE: string = readCode(
  "Components/Table/TableEmptyState.tsx",
);

describe("the empty state in the dark theme", () => {
  test("uses no dark: variant and builds no colour class from a template", () => {
    expect(EMPTY_STATE_CODE.includes("dark:")).toBe(false);
    expect(TEMPLATED_COLOUR.test(EMPTY_STATE_CODE)).toBe(false);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    const tokens: Array<string> = colorTokens(EMPTY_STATE_CODE);

    // The scan found the component's colours at all, so this is not vacuous.
    expect(tokens).toEqual(
      expect.arrayContaining([
        // The front card and its outline.
        "bg-white",
        "ring-gray-200",
        // The title and the description.
        "text-gray-900",
        "text-gray-500",
        // The card behind, in each kind's colour.
        "bg-indigo-100",
        "ring-indigo-200",
        "bg-emerald-100",
        "bg-red-100",
        "bg-gray-200",
        "ring-gray-300",
      ]),
    );

    expect(
      tokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test.each(Object.values(TableEmptyStateKind))(
    "the %s kind's colours are all remapped",
    (kind: TableEmptyStateKind) => {
      const style: { backCardClassName: string; iconClassName: string } =
        TABLE_EMPTY_STATE_KIND_STYLES[kind];
      const tokens: Array<string> =
        `${style.backCardClassName} ${style.iconClassName}`
          .split(/\s+/)
          .filter((token: string): boolean => {
            return token.length > 0;
          });

      expect(tokens.length).toBeGreaterThan(2);
      expect(
        tokens.filter((token: string): boolean => {
          return COLOR_UTILITY.test(utilityOf(token)) && !isRemapped(token);
        }),
      ).toEqual([]);
    },
  );

  /*
   * The two classes the Table and the List add around the state: the rule
   * under the header row, and the list's grey that runs on where its
   * footer used to be.
   */
  test("the blocks the Table and the List draw it in are remapped too", () => {
    const tableCode: string = readCode("Components/Table/Table.tsx");
    const listCode: string = readCode("Components/List/List.tsx");

    expect(tableCode).toContain('"border-t border-gray-200 "');
    /*
     * The list's grey runs on to the card's rounded bottom edge - or, in a
     * section of a card (CardSections), to its square one.
     */
    expect(listCode).toContain("`-mb-6 h-6 bg-gray-50${");
    expect(listCode).toContain('" rounded-b-xl"');

    for (const token of ["border-gray-200", "bg-gray-50"]) {
      expect([token, isRemapped(token)]).toEqual([token, true]);
    }
  });
});
