import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A PATTERN THAT FINDS A JWT IN TEXT LOOKS FOR IT ONCE PER RUN.
 *
 * Tokens are looked for in text somebody outside wrote: the server's log
 * lines, tool results and cluster or resource output on their way to a
 * model, exception messages at ingest, the instance health page's job and
 * log text. A token is "eyJ" and runs of base64url characters, and a
 * pattern tried from every "eyJ" (or every word boundary) of a long run of
 * those characters reads the rest of the run again from each one - its time
 * grows with the square of the text's length.
 *
 * So every such pattern in product code (read here from the source, across
 * all of it - ee/ and the agents' copies too, when checked out) begins with
 * the look-behind that lets a match start only where a run of those
 * characters starts, and settles on the run's first possible start with a
 * look-ahead (LogRedaction and Serializer say how) - unless it is listed
 * below with the reason it is linear on its own. And every one of them,
 * listed or not, reads the shapes that were slow in well under two seconds.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx|js|mjs|cjs)$/;

// A token's first segment, as a pattern writes it.
const TOKEN_START: string = "eyJ[A-Za-z0-9_-]";

// Where a run of the characters a token is made of starts.
const RUN_START: string = "(?<![A-Za-z0-9_-])";

/*
 * Patterns of another shape that are linear for a reason of their own, by
 * the file they are in.
 */
const LINEAR_FOR_ANOTHER_REASON: Record<string, string> = {
  "packages/Common/UI/Utils/ErrorSupportBundle.ts":
    "a token there may end after any of its segments, so the first start in a run ends in a match at the run's end and nothing is read twice",
};

interface FoundPattern {
  file: string;
  line: number;
  source: string;
  flags: string;
}

// Every regular expression literal of a file, and every RegExp built from a literal.
function patternsIn(file: string, text: string): Array<FoundPattern> {
  const found: Array<FoundPattern> = [];
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
        file,
        line: lineOf(node),
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
        file,
        line: lineOf(node),
        source: node.arguments[0].text,
        flags: flags && ts.isStringLiteralLike(flags) ? flags.text : "",
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const TOKEN_PATTERNS: Array<FoundPattern> = listProductFiles()
  .filter((file: string): boolean => {
    return CODE_FILE.test(file);
  })
  .flatMap((file: string): Array<FoundPattern> => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    if (!text.includes("eyJ")) {
      return [];
    }

    return patternsIn(file, text).filter((pattern: FoundPattern): boolean => {
      return pattern.source.includes(TOKEN_START);
    });
  });

const LENGTH: number = 100000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const SLOW_SHAPES: Array<string> = [
  repeat("eyJ", LENGTH),
  repeat("-eyJ-", LENGTH),
  repeat("eyJab-", LENGTH),
  repeat("eyJeeeeeeeeee", LENGTH),
  repeat("eyJ".repeat(170) + "." + "a".repeat(16384) + "!", LENGTH),
];

describe("a pattern that finds a JWT looks for it once per run", () => {
  test("the guard finds the patterns it holds to the rule", () => {
    const files: Array<string> = TOKEN_PATTERNS.map(
      (pattern: FoundPattern): string => {
        return pattern.file;
      },
    );

    // The server's own, read wherever the checkout is.
    for (const file of [
      "packages/Common/Server/Utils/LogRedaction.ts",
      "packages/Common/Server/Utils/AI/Toolbox/Serializer.ts",
      "packages/Common/Server/Utils/Telemetry/ExceptionSanitizer.ts",
      "packages/Common/Utils/AiRemediation/KubectlOutputRedactor.ts",
      "packages/Common/Utils/AiRemediation/Resource/ResourceOutputRedactor.ts",
      "packages/App/API/AdminHealthProbes.ts",
    ]) {
      expect({ file, found: files.includes(file) }).toEqual({
        file,
        found: true,
      });
    }
  });

  test("each starts only where a run of a token's characters starts", () => {
    const offending: Array<string> = TOKEN_PATTERNS.filter(
      (pattern: FoundPattern): boolean => {
        return (
          !LINEAR_FOR_ANOTHER_REASON[pattern.file] &&
          !pattern.source.startsWith(RUN_START)
        );
      },
    ).map((pattern: FoundPattern): string => {
      return `${pattern.file}:${pattern.line} /${pattern.source}/${pattern.flags}`;
    });

    expect(offending).toEqual([]);
  });

  test("each pattern listed as linear for another reason is still there", () => {
    for (const file of Object.keys(LINEAR_FOR_ANOTHER_REASON)) {
      expect(fs.existsSync(path.join(REPOSITORY_DIRECTORY, file))).toBe(true);
    }
  });

  test("each reads the shapes that were slow in well under two seconds", () => {
    const slow: Array<string> = [];

    for (const pattern of TOKEN_PATTERNS) {
      for (const text of SLOW_SHAPES) {
        const startedAt: number = Date.now();

        text.replace(new RegExp(pattern.source, pattern.flags), "x");

        const elapsed: number = Date.now() - startedAt;

        if (elapsed >= 2000) {
          slow.push(
            `${pattern.file}:${pattern.line} took ${elapsed} ms on ${text.slice(0, 20)}...`,
          );
        }
      }
    }

    expect(slow).toEqual([]);
  });
});
