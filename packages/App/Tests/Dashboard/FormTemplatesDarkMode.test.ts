import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A form's Templates page in the dashboard's dark theme
 * (Components/FormBuilder/Templates): the list - with the chips that say
 * what each template fills in and which questions it asks its own way
 * (Required, Optional, Hidden) - and the editor's Questions rows.
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css
 * re-colours the light utility classes under html.dark, one rule per class.
 * So every named colour class the folder draws with must be one Theme.css
 * remaps, or it stays pale on a slate card.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "FormBuilder",
  "Templates",
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

const MODULES: Array<string> = fs
  .readdirSync(COMPONENT_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts") || file.endsWith(".tsx");
  })
  .sort();

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

// Comments hold prose, not classes.
const CODE: string = MODULES.map((file: string): string => {
  return fs
    .readFileSync(path.join(COMPONENT_DIR, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}).join("\n");

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_HOLE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

function stringTokens(code: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(STRING_LITERAL)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      TEMPLATE_HOLE,
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

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

function isRemapped(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
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

const TOKENS: Array<string> = Array.from(new Set(stringTokens(CODE)));

describe("the Templates page in the dark theme", () => {
  test("reads every module of the folder", () => {
    expect(MODULES).toEqual([
      "FormTemplateQuestionSettings.tsx",
      "FormTemplates.tsx",
      "FormTemplatesState.ts",
    ]);
  });

  test("uses no dark: variants", () => {
    expect(CODE).not.toContain("dark:");
  });

  test("every named colour class it uses is remapped for dark mode", () => {
    const named: Array<string> = TOKENS.filter((token: string): boolean => {
      return COLOR_UTILITY.test(token);
    });

    // The scan found the rows, the chips of each setting and the notes.
    expect(named).toEqual(
      expect.arrayContaining([
        "divide-gray-100",
        "text-gray-900",
        "text-gray-500",
        "bg-indigo-50",
        "text-indigo-700",
        "ring-indigo-200",
        "bg-amber-50",
        "text-amber-800",
        "ring-amber-200",
        "bg-gray-50",
        "text-gray-600",
        "ring-gray-200",
      ]),
    );
    expect(
      named.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("a hidden question is marked with the builder's own Hidden colours", () => {
    const builderCard: string = fs.readFileSync(
      path.join(COMPONENT_DIR, "..", "Builder", "QuestionCard.tsx"),
      "utf8",
    );

    for (const token of ["bg-amber-50", "text-amber-800", "ring-amber-200"]) {
      expect(builderCard).toContain(token);
      expect(TOKENS).toContain(token);
    }
  });
});
