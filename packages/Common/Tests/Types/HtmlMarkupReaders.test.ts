import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The product code that reads text out of markup does it through one walk,
 * removeHtmlMarkup (Common/Types/HtmlMarkup). Each of these modules took
 * tags out with a single pass of a tag pattern - /<[^>]*>/ or /<[^>]+>/ -
 * which code scanning reports as incomplete multi-character sanitization
 * (js/incomplete-multi-character-sanitization): an unclosed tag stays as it
 * came, and a ">" inside a quoted value or a comment ends the tag early.
 * This guard reads each of them and fails on:
 *
 *   1. a replace or replaceAll whose pattern takes out a whole HTML tag or
 *      comment - "<script>", "</script>", "<iframe src=x>", "<!-- note -->",
 *      the markup code scanning asks about - written in place, held in a
 *      constant or built with new RegExp, whatever it is replaced with and
 *      whether or not it runs in a loop;
 *   2. a module that no longer reads markup through the shared walk.
 *
 * A pattern for one element of a message - a line break, a list item, the
 * end of a paragraph, a Teams mention or attachment - turns markup into
 * text of its own and passes: it is not a tag strip.
 */

const PACKAGES_DIRECTORY: string = path.resolve(__dirname, "../../..");
const REPOSITORY_DIRECTORY: string = path.resolve(PACKAGES_DIRECTORY, "..");

interface MarkupReader {
  file: string;
  what: string;
  // The import that reads markup through the shared walk.
  readsThrough: string;
}

const MARKUP_READERS: Array<MarkupReader> = [
  {
    file: "packages/Common/Server/Types/MarkdownSlugify.ts",
    what: "a docs heading's anchor",
    readsThrough: "removeHtmlMarkup",
  },
  {
    file: "packages/Common/Server/Types/MarkdownDocsExtensions.ts",
    what: "a docs tab's key",
    readsThrough: "removeHtmlMarkup",
  },
  {
    file: "packages/App/FeatureSet/Docs/Utils/SearchIndex.ts",
    what: "the docs search index and page descriptions",
    readsThrough: "removeHtmlMarkup",
  },
  {
    file: "packages/Common/Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync.ts",
    what: "a Teams message saved as a note",
    readsThrough: "removeHtmlMarkup",
  },
  {
    file: "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    what: "a Teams message read by AI Ops and from a channel",
    readsThrough: "removeHtmlMarkup",
  },
  {
    file: "Scripts/Docs/FixAnchors.ts",
    what: "a heading's anchor under the old ASCII rule",
    // Through the one slugify, which reads markup with removeHtmlMarkup.
    readsThrough: "slugifyMarkdownHeading",
  },
];

// Markup a pattern that strips tags or comments takes out whole.
const MARKUP_PROBES: Array<string> = [
  "<script>",
  '<script src="x.js">',
  "</script>",
  "<iframe src=x>",
  "<style>",
  "<!-- note -->",
];

const STRIP_CALLS: Array<string> = ["replace", "replaceAll"];
const WHITESPACE_RUN: RegExp = /\s+/g;

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

// A pattern as it runs, or null when the runtime cannot build it.
function buildPattern(source: string, flags: string): RegExp | null {
  try {
    // Without g or y, exec() always reads from the start.
    return new RegExp(
      source,
      Array.from(flags)
        .filter((flag: string): boolean => {
          return flag !== "g" && flag !== "y";
        })
        .join(""),
    );
  } catch {
    return null;
  }
}

// The pattern an expression writes: a /literal/ or new RegExp("...", "...").
function patternOf(node: ts.Expression): RegExp | null {
  if (ts.isParenthesizedExpression(node)) {
    return patternOf(node.expression);
  }

  if (ts.isRegularExpressionLiteral(node)) {
    const lastSlash: number = node.text.lastIndexOf("/");

    return buildPattern(
      node.text.slice(1, lastSlash),
      node.text.slice(lastSlash + 1),
    );
  }

  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "RegExp" &&
    node.arguments !== undefined &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0] as ts.Expression)
  ) {
    const flags: ts.Expression | undefined = node.arguments[1];

    return buildPattern(
      (node.arguments[0] as ts.StringLiteralLike).text,
      flags && ts.isStringLiteralLike(flags) ? flags.text : "",
    );
  }

  return null;
}

// Whether the first thing a pattern matches in `text` is all of it.
function takesOutWhole(pattern: RegExp, text: string): boolean {
  const match: RegExpExecArray | null = pattern.exec(text);

  return match !== null && match.index === 0 && match[0] === text;
}

// A probe with its angle brackets written as letters: text, not markup.
function asText(probe: string): string {
  return Array.from(probe)
    .map((character: string): string => {
      return character === "<" || character === ">" ? "x" : character;
    })
    .join("");
}

/*
 * Whether a pattern takes out markup: on one of the probes, it matches the
 * whole tag or comment, and it does not take out the same text without its
 * angle brackets. A pattern of single characters ("<+", "[^a-z0-9]+") or of
 * one element and what it holds ("<at ...>...</at>") is not a tag strip.
 */
function stripsMarkup(pattern: RegExp): boolean {
  return MARKUP_PROBES.some((probe: string): boolean => {
    return (
      takesOutWhole(pattern, probe) && !takesOutWhole(pattern, asText(probe))
    );
  });
}

interface Finding {
  line: number;
  code: string;
}

// Every replace in a file whose pattern takes out markup.
function findTagStrips(fileName: string, text: string): Array<Finding> {
  const source: ts.SourceFile = parse(fileName, text);
  const findings: Array<Finding> = [];
  const constants: Map<string, RegExp> = new Map();

  // The patterns the file names: const TAG: RegExp = /<[^>]*>/g, or a class's.
  visit(source, (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const pattern: RegExp | null = patternOf(node.initializer);

      if (pattern) {
        constants.set(node.name.text, pattern);
      }
    }
  });

  visit(source, (node: ts.Node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !STRIP_CALLS.includes(node.expression.name.text) ||
      node.arguments.length === 0
    ) {
      return;
    }

    const argument: ts.Expression = node.arguments[0] as ts.Expression;
    let pattern: RegExp | null = patternOf(argument);

    if (!pattern && ts.isIdentifier(argument)) {
      pattern = constants.get(argument.text) || null;
    }

    if (!pattern && ts.isPropertyAccessExpression(argument)) {
      pattern = constants.get(argument.name.text) || null;
    }

    if (pattern && stripsMarkup(pattern)) {
      findings.push({
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        code: node.getText(source).replace(WHITESPACE_RUN, " ").slice(0, 80),
      });
    }
  });

  return findings;
}

// The names a file imports.
function importedNames(fileName: string, text: string): Array<string> {
  const names: Array<string> = [];

  for (const statement of parse(fileName, text).statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }

    const clause: ts.ImportClause = statement.importClause;

    if (clause.name) {
      names.push(clause.name.text);
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }
  }

  return names;
}

// Lines of TypeScript, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

describe("product code reads text out of markup through removeHtmlMarkup", () => {
  it.each(MARKUP_READERS)(
    "$file ($what) takes out no tag with a pattern of its own",
    (reader: MarkupReader) => {
      const file: string = path.join(REPOSITORY_DIRECTORY, reader.file);
      const findings: Array<string> = findTagStrips(
        reader.file,
        fs.readFileSync(file, "utf8"),
      ).map((finding: Finding): string => {
        return `${reader.file}:${finding.line} ${finding.code} - read the text with removeHtmlMarkup (Common/Types/HtmlMarkup)`;
      });

      expect(findings).toEqual([]);
    },
  );

  it.each(MARKUP_READERS)(
    "$file ($what) reads markup through $readsThrough",
    (reader: MarkupReader) => {
      const file: string = path.join(REPOSITORY_DIRECTORY, reader.file);

      expect(
        importedNames(reader.file, fs.readFileSync(file, "utf8")),
      ).toContain(reader.readsThrough);
    },
  );
});

describe("findTagStrips, on files written here", () => {
  const linesOf: (text: string) => Array<number> = (
    text: string,
  ): Array<number> => {
    return findTagStrips("Some.ts", text).map((finding: Finding): number => {
      return finding.line;
    });
  };

  it.each([
    ["the pattern the readers used", 'text.replace(/<[^>]*>/g, "");'],
    ["the search index's", 'text.replace(/<[^>]+>/g, "");'],
    ["replaceAll", 'text.replaceAll(/<[^>]*>/g, "");'],
    ["a replacement that is not empty", 'text.replace(/<[^>]*>/g, " ");'],
    ["new RegExp", 'text.replace(new RegExp("<[^>]*>", "g"), "");'],
    ["an end-tag-aware pattern", 'text.replace(/<\\/?[a-z][^>]*>/gi, "");'],
    ["a comment strip", 'text.replace(/<!--[\\s\\S]*?-->/g, "");'],
    ["a pattern in parentheses", 'text.replace((/<[^>]*>/g), "");'],
  ])("finds %s", (_shape: string, line: string) => {
    expect(linesOf(line)).toEqual([1]);
  });

  it("finds a pattern held in a constant, or in a class's static field", () => {
    expect(
      linesOf(
        code(
          "const TAG: RegExp = /<[^>]*>/g;",
          'html.replace(TAG, "");',
          "class A {",
          "  private static readonly TAG: RegExp = /<[^>]*>/g;",
          '  public static strip(html: string): string { return html.replace(A.TAG, ""); }',
          "}",
        ),
      ),
    ).toEqual([2, 5]);
  });

  it("finds a tag strip repeated until nothing changes", () => {
    expect(
      linesOf(
        code(
          "let text: string = html;",
          "let previous: string;",
          "do {",
          "  previous = text;",
          '  text = text.replace(/<[^>]*>/g, "");',
          "} while (text !== previous);",
        ),
      ),
    ).toEqual([5]);
  });

  it("passes what turns one element into text, and what is not a tag strip", () => {
    expect(
      linesOf(
        code(
          // ReactionNoteSync: Teams elements made into text of their own.
          'html.replace(/<attachment\\b[^>]*>[\\s\\S]*?<\\/attachment>/gi, "");',
          'html.replace(/<at\\b[^>]*>([\\s\\S]*?)<\\/at>/gi, "@$1");',
          'html.replace(/<br\\s*\\/?>/gi, "\\n");',
          'html.replace(/<li\\b[^>]*>/gi, "- ");',
          'html.replace(/<\\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\\n");',
          // An element and what it holds.
          'html.replace(/<script[\\s\\S]*?<\\/script>/gi, " ");',
          // Single characters, and runs of them.
          'text.replace(/<+/g, "");',
          'title.replace(/[^a-z0-9]+/g, "-");',
          'text.replace(/[<>]/g, "");',
          // Reading markup is not taking it out.
          "const TAG: RegExp = /<[^>]*>/;",
          "TAG.test(html);",
          "html.split(TAG);",
          // A string pattern, and the shared walk.
          'html.replace("<", "");',
          "removeHtmlMarkup(html);",
          // A pattern the runtime cannot build is passed over, not thrown on.
          'html.replace(new RegExp("(", "g"), "");',
        ),
      ),
    ).toEqual([]);
  });

  it("reads the names a file imports", () => {
    expect(
      importedNames(
        "Some.ts",
        code(
          'import Default, { named, other as renamed } from "./a";',
          'import { removeHtmlMarkup } from "../../Types/HtmlMarkup";',
          'import "./side-effect";',
        ),
      ),
    ).toEqual(["Default", "named", "renamed", "removeHtmlMarkup"]);
  });
});
