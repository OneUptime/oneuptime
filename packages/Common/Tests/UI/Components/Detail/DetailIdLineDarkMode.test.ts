import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The ID line in the dark theme - the record's ID, and the Created and
 * Updated times that share its line.
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css re-colours
 * the light utility classes under html.dark, one rule per class or family of
 * classes. A class it has no rule for keeps its light colour in the dark
 * theme - a near-white divider or a grey that vanishes on slate - and nothing
 * fails. So every colour class the line draws with, and the divider Detail
 * puts above it, is held to what Theme.css actually remaps. The strings are
 * read with the TypeScript parser, so a class inside a condition (the tick's
 * green, a failure's red) is read too.
 */

const COMMON: string = path.join(__dirname, "..", "..", "..", "..");

const ID_LINE: string = path.join(
  COMMON,
  "UI",
  "Components",
  "Detail",
  "DetailIdLine.tsx",
);

const RECORD_LINE: string = path.join(
  COMMON,
  "UI",
  "Components",
  "Detail",
  "DetailRecordLine.tsx",
);

const DETAIL: string = path.join(
  COMMON,
  "UI",
  "Components",
  "Detail",
  "Detail.tsx",
);

const THEME_CSS: string = fs
  .readFileSync(path.join(COMMON, "UI", "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

interface SourceRange {
  file: string;
  start: string;
  end: string;
}

const RANGES: Array<SourceRange> = [
  // The ID, its copy button and what a copy says.
  { file: ID_LINE, start: "const DetailIdLine", end: "export default" },
  // The line that holds it, and the Created and Updated times on it.
  {
    file: RECORD_LINE,
    start: "export const DetailRecordTimeElement",
    end: "export default",
  },
  // The divider Detail draws above the line.
  {
    file: DETAIL,
    start: "const recordLineClassName",
    end: "<DetailRecordLine",
  },
];

// Every string written in the range: literals and a template's own text.
function stringsIn(range: SourceRange): Array<string> {
  const source: string = fs.readFileSync(range.file, "utf8");
  const from: number = source.indexOf(range.start);
  const to: number = source.indexOf(range.end, from + range.start.length);

  if (from === -1 || to === -1) {
    throw new Error(`no "${range.start}" ... "${range.end}" in ${range.file}`);
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    range.file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const strings: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (node.getEnd() < from || node.getStart(sourceFile) > to) {
      return;
    }

    if (
      node.getStart(sourceFile) >= from &&
      node.getEnd() <= to &&
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node))
    ) {
      strings.push(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return strings;
}

function tokensIn(ranges: Array<SourceRange>): Array<string> {
  return ranges.flatMap(stringsIn).flatMap((text: string): Array<string> => {
    return text.split(/\s+/).filter((token: string): boolean => {
      return token.length > 0;
    });
  });
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
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// The prefixes Theme.css remaps a family of classes by.
const FAMILY_PREFIXES: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
);

function isRemapped(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  // A rule for a whole family: [class*="focus-visible:ring-indigo-"].
  if (
    FAMILY_PREFIXES.some((prefix: string): boolean => {
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
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

function colorTokens(ranges: Array<SourceRange>): Array<string> {
  return Array.from(
    new Set(
      tokensIn(ranges).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

describe("the ID line in the dark theme", () => {
  test("reads the label, the ID, the button, the tick, the failure and the divider", () => {
    expect(colorTokens(RANGES)).toEqual(
      expect.arrayContaining([
        // "ID", "Created" and "Updated", and their icons.
        "text-gray-500",
        "text-gray-400",
        // The ID and the times.
        "text-gray-600",
        "hover:text-gray-900",
        // The copy button and its tick.
        "hover:bg-gray-100",
        "hover:text-gray-700",
        "focus-visible:ring-indigo-500",
        "text-emerald-600",
        // A failed copy.
        "text-red-600",
        // The divider above the line.
        "border-gray-100",
      ]),
    );
  });

  test("reads the times' classes too, not just the ID's", () => {
    const timeTokens: Array<string> = colorTokens([RANGES[1]!]);

    expect(timeTokens).toEqual(
      expect.arrayContaining([
        "text-gray-500",
        "text-gray-400",
        "text-gray-600",
      ]),
    );
  });

  test("uses no dark: variants", () => {
    for (const token of tokensIn(RANGES)) {
      expect(token.startsWith("dark:")).toBe(false);
    }
  });

  test("every colour class it uses is remapped for dark mode", () => {
    expect(
      colorTokens(RANGES).filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the check tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-600")).toBe(true);
    expect(isRemapped("hover:bg-gray-100")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
