import { REPOSITORY_DIRECTORY } from "./TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The regular expressions a code file writes, read from its source: every
 * regular expression literal, and every RegExp built from a string literal -
 * each with the name of the constant it is assigned to, when it is.
 *
 * For the guards that hold a family of patterns to one shape across the
 * product, and for the tests that hold a pattern rewritten to read in time
 * in line with its text to the pattern it replaced: they read the pattern
 * the product runs, not a copy of it.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface SourcePattern {
  // The file's path from the repository's root.
  file: string;
  line: number;
  // The constant the pattern is assigned to, or null.
  name: string | null;
  source: string;
  flags: string;
}

type NameOfFunction = (node: ts.Node) => string | null;

// The constant a pattern is the initial value of: `const NAME: RegExp = /.../`.
const nameOf: NameOfFunction = (node: ts.Node): string | null => {
  const parent: ts.Node | undefined = node.parent;

  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }

  return null;
};

export type PatternsInSourceFunction = (
  file: string,
  text: string,
) => Array<SourcePattern>;

export const patternsInSource: PatternsInSourceFunction = (
  file: string,
  text: string,
): Array<SourcePattern> => {
  const found: Array<SourcePattern> = [];
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal: string = node.getText(source);
      const end: number = literal.lastIndexOf("/");

      found.push({
        file: file,
        line: lineOf(node),
        name: nameOf(node),
        source: literal.slice(1, end),
        flags: literal.slice(end + 1),
      });
    } else if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      node.expression.getText(source) === "RegExp" &&
      node.arguments &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const flags: ts.Expression | undefined = node.arguments[1];

      found.push({
        file: file,
        line: lineOf(node),
        name: nameOf(node),
        source: node.arguments[0].text,
        flags: flags && ts.isStringLiteralLike(flags) ? flags.text : "",
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
};

export type PatternsInFileFunction = (file: string) => Array<SourcePattern>;

// The patterns of a file, by its path from the repository's root.
export const patternsInFile: PatternsInFileFunction = (
  file: string,
): Array<SourcePattern> => {
  return patternsInSource(
    file,
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
  );
};

export type NamedPatternFunction = (file: string, name: string) => RegExp;

/*
 * The pattern a file assigns to the constant `name`, as a RegExp the test
 * can run; it fails when the file assigns that name no pattern, or more than
 * one.
 */
export const namedPattern: NamedPatternFunction = (
  file: string,
  name: string,
): RegExp => {
  const named: Array<SourcePattern> = patternsInFile(file).filter(
    (pattern: SourcePattern): boolean => {
      return pattern.name === name;
    },
  );

  if (named.length !== 1) {
    throw new Error(
      `${file} assigns ${named.length} patterns to ${name}, not one.`,
    );
  }

  return new RegExp(named[0]!.source, named[0]!.flags);
};

export type PatternWithFunction = (file: string, fragment: string) => RegExp;

/*
 * The one pattern of a file whose source holds `fragment` (for a pattern
 * no constant is named after, such as a rule's in a list of rules).
 */
export const patternWith: PatternWithFunction = (
  file: string,
  fragment: string,
): RegExp => {
  const holding: Array<SourcePattern> = patternsInFile(file).filter(
    (pattern: SourcePattern): boolean => {
      return pattern.source.includes(fragment);
    },
  );

  if (holding.length !== 1) {
    throw new Error(
      `${file} holds ${holding.length} patterns with ${fragment}, not one.`,
    );
  }

  return new RegExp(holding[0]!.source, holding[0]!.flags);
};
