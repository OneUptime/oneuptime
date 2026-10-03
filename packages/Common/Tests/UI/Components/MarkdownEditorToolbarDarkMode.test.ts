import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Markdown editor's toolbar and its More formatting menu in the dark
 * theme.
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * or family of classes. A class it has no rule for keeps its light colour in
 * the dark theme - a white bar over a slate editor - and nothing fails. So
 * this holds every colour class the toolbar, its buttons, the switch, the
 * menu's dividers and keys, and the menu item's mark use to what Theme.css
 * actually remaps. The strings are read with the TypeScript parser, so a
 * class written inside a condition in a template - the switch's colours
 * when it is on - is read too.
 */

const COMMON: string = path.join(__dirname, "..", "..", "..");

const MARKDOWN_EDITOR: string = path.join(
  COMMON,
  "UI",
  "Components",
  "Markdown.tsx",
  "MarkdownEditor.tsx",
);

const MORE_MENU_ITEM: string = path.join(
  COMMON,
  "UI",
  "Components",
  "MoreMenu",
  "MoreMenuItem.tsx",
);

const THEME_CSS: string = fs
  .readFileSync(path.join(COMMON, "UI", "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

interface SourceRange {
  file: string;
  start: string;
  end: string;
}

/*
 * The toolbar's own code: its button class, buttons and divider, the menu's
 * items, and the toolbar itself up to Insert variable, whose class is
 * TemplateVariablesDarkMode's (App/Tests/Dashboard). And the mark a menu
 * item draws in its icon's place.
 */
const TOOLBAR_RANGES: Array<SourceRange> = [
  {
    file: MARKDOWN_EDITOR,
    start: "const TOOLBAR_BUTTON_CLASS",
    end: "const MarkdownEditor",
  },
  {
    file: MARKDOWN_EDITOR,
    start: "const moreMenuItems",
    end: "let className",
  },
  {
    file: MARKDOWN_EDITOR,
    start: 'data-testid="markdown-editor-toolbar"',
    end: "<InsertTemplateVariableButton",
  },
];

const MENU_ITEM_MARK_RANGES: Array<SourceRange> = [
  {
    file: MORE_MENU_ITEM,
    start: "props.iconElement && (",
    end: "{props.iconElement}",
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

    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      node.getStart(sourceFile) >= from &&
      node.getEnd() <= to
    ) {
      strings.push(node.initializer.text);
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

  // A rule for a whole family: [class*="hover:border-indigo-"].
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

/*
 * A focus ring keeps the brand indigo in both themes, as every other focus
 * ring in the Dashboard does.
 */
const SAME_IN_BOTH_THEMES: Array<string> = [
  "focus-visible:ring-indigo-500",
  "focus:ring-indigo-500",
];

function colorTokens(ranges: Array<SourceRange>): Array<string> {
  return Array.from(
    new Set(
      tokensIn(ranges).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

describe("the Markdown editor's toolbar in the dark theme", () => {
  test("reads the toolbar, its buttons, the switch and the menu's items", () => {
    expect(colorTokens(TOOLBAR_RANGES)).toEqual(
      expect.arrayContaining([
        // The bar.
        "bg-gray-50",
        "border-gray-300",
        // Its buttons and their divider.
        "text-gray-600",
        "hover:bg-gray-100",
        "hover:text-gray-900",
        "bg-gray-300",
        // The switch, on.
        "bg-indigo-100",
        "text-indigo-700",
        // The menu's dividers and keys.
        "border-gray-100",
        "text-gray-400",
      ]),
    );
    expect(colorTokens(MENU_ITEM_MARK_RANGES)).toEqual(
      expect.arrayContaining([
        "text-gray-400",
        "group-hover:text-indigo-500",
        "text-red-500",
        "group-hover:text-red-600",
      ]),
    );
  });

  test("uses no dark: variants", () => {
    for (const token of tokensIn([
      ...TOOLBAR_RANGES,
      ...MENU_ITEM_MARK_RANGES,
    ])) {
      expect(token.startsWith("dark:")).toBe(false);
    }
  });

  test("every colour class it uses is remapped for dark mode", () => {
    const tokens: Array<string> = [
      ...colorTokens(TOOLBAR_RANGES),
      ...colorTokens(MENU_ITEM_MARK_RANGES),
    ];

    expect(
      tokens.filter((token: string): boolean => {
        return !SAME_IN_BOTH_THEMES.includes(token) && !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-600")).toBe(true);
    expect(isRemapped("hover:bg-gray-100")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
