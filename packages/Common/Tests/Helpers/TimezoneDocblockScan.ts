import ts from "typescript";

/*
 * THE DETECTOR BEHIND THE TIMEZONE DOCBLOCK GUARDS: WHERE A TEST TRIES TO
 * RUN IN A ZONE IN A WAY THAT NEVER TAKES.
 *
 * A Jest test file cannot change the zone it runs in by assigning
 * process.env.TZ: Jest's process.env is a copy of the real one, so Node's
 * zone - Date's local getters, Intl, moment's local arithmetic - stays what
 * it was (UTC in CI). Such a test passes without proving anything about the
 * zone it names: DateClickhouseFormat, DateTelemetryHotPath,
 * ChartTrailingBucketGap and DateColumnValue all did, until 2026-10-27.
 *
 * What does work, in Common's tests and ee's UI tests, is the docblock: a
 * `@timezone Europe/London` pragma in the first comment of the file.
 * Common's test environment (Tests/Utils/TimezoneEnvironment.js) reads it
 * and sets the worker's real zone before the file loads. Jest reads only
 * that first comment, and only those two jest projects use that
 * environment, so a pragma anywhere else is ignored as quietly as the
 * assignment is.
 *
 * Two suites run this: packages/Common/Tests/Helpers/TimezoneDocblockGuard
 * over the checkout, and ee/Tests/Server/TimezoneDocblockGuard over ee/'s
 * files, from the only job that has ee/ checked out.
 */

export interface TimezoneProblem {
  // The file, by its path from the repository's root.
  file: string;
  // The line the problem is on, from 1.
  line: number;
  // What is wrong, and what to do instead.
  message: string;
}

export const RUNTIME_ASSIGNMENT_MESSAGE: string =
  "assigns process.env.TZ, which never changes the zone a Jest test runs in (Jest's process.env is a copy): give the zone a file of its own whose first comment is a @timezone docblock, and assert there that the zone took";

export const PRAGMA_NOT_FIRST_MESSAGE: string =
  "has a @timezone pragma outside the file's first comment, where Jest never reads it: make the docblock the first thing in the file";

export const PRAGMA_NOT_HONOURED_MESSAGE: string =
  "has a @timezone pragma in a jest project whose test environment ignores it: only Common's tests and ee/Tests/UI run in Tests/Utils/TimezoneEnvironment.js";

export const UNKNOWN_ZONE_MESSAGE: string =
  "names a zone Node does not know, which runs the file in UTC";

/*
 * Jest's own reading of a file's docblock (jest-docblock's extract): the
 * comment the file starts with, after any blank space.
 */
const LEADING_COMMENT: RegExp = /^\s*\/\*[\s\S]*?\*\//;

// A pragma line of a comment: "@timezone Zone", first after its "/**" or "*".
const PRAGMA_LINE: RegExp = /^\s*(?:\/\*\*?\s*|\*\s*)?@timezone\s+([^\s*]+)/;

const TSX_FILE: RegExp = /\.tsx$/;
const JSX_FILE: RegExp = /\.jsx$/;
const JS_FILE: RegExp = /\.[cm]?js$/;

/*
 * Where a @timezone docblock is honoured: the jest projects whose test
 * environment is Common's TimezoneEnvironment - every Common test, and ee's
 * UI project (ee/jest.config.js).
 */
export const DOCBLOCK_PROJECTS: ReadonlyArray<string> = [
  "packages/Common/",
  "ee/Tests/UI/",
];

/*
 * Test code that runs outside Jest, where process.env is the process's own:
 * the Playwright package (its specs, configs and fixture servers), the
 * packages that test with Node's own runner (node --test: the Kubernetes
 * and resource agents, Nginx), and the environment that reads the docblock
 * and sets the zone before a file loads.
 */
const OUTSIDE_JEST: ReadonlyArray<string> = [
  "packages/E2E/",
  "agents/",
  "packages/Nginx/",
  "packages/Common/Tests/Utils/TimezoneEnvironment.js",
];

export type IsJestTestCodeFunction = (file: string) => boolean;

// Whether a test file's code runs inside Jest's sandbox.
export const isJestTestCode: IsJestTestCodeFunction = (
  file: string,
): boolean => {
  return !OUTSIDE_JEST.some((prefix: string): boolean => {
    return file.startsWith(prefix);
  });
};

export type IsKnownZoneFunction = (zone: string) => boolean;

// Whether Node knows a zone by that name.
export const isKnownZone: IsKnownZoneFunction = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
};

function scriptKindOf(file: string): ts.ScriptKind {
  if (TSX_FILE.test(file)) {
    return ts.ScriptKind.TSX;
  }

  if (JSX_FILE.test(file)) {
    return ts.ScriptKind.JSX;
  }

  if (JS_FILE.test(file)) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

// `process.env.TZ` or `process.env["TZ"]`, read through parentheses.
function isProcessEnvTimezone(node: ts.Expression): boolean {
  let target: ts.Expression = node;

  while (ts.isParenthesizedExpression(target)) {
    target = target.expression;
  }

  let object: ts.Expression;
  let key: string;

  if (ts.isPropertyAccessExpression(target)) {
    object = target.expression;
    key = target.name.text;
  } else if (
    ts.isElementAccessExpression(target) &&
    ts.isStringLiteralLike(target.argumentExpression)
  ) {
    object = target.expression;
    key = target.argumentExpression.text;
  } else {
    return false;
  }

  return (
    key === "TZ" &&
    ts.isPropertyAccessExpression(object) &&
    object.name.text === "env" &&
    ts.isIdentifier(object.expression) &&
    object.expression.text === "process"
  );
}

const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/*
 * Every block comment of a file, from the parsed tree: the comments before
 * and after each token, so text in a string, a template or a regular
 * expression is never read as one.
 */
function blockComments(source: ts.SourceFile): Array<ts.CommentRange> {
  const text: string = source.getFullText();
  const byStart: Map<number, ts.CommentRange> = new Map<
    number,
    ts.CommentRange
  >();

  const keep: (ranges: Array<ts.CommentRange> | undefined) => void = (
    ranges: Array<ts.CommentRange> | undefined,
  ): void => {
    for (const range of ranges || []) {
      if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        byStart.set(range.pos, range);
      }
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    keep(ts.getLeadingCommentRanges(text, node.getFullStart()));
    keep(ts.getTrailingCommentRanges(text, node.getEnd()));
    node.getChildren(source).forEach(visit);
  };

  visit(source);

  return Array.from(byStart.values()).sort(
    (a: ts.CommentRange, b: ts.CommentRange): number => {
      return a.pos - b.pos;
    },
  );
}

export type FindTimezoneProblemsFunction = (
  file: string,
  text: string,
) => Array<TimezoneProblem>;

/*
 * What is wrong with how a test file asks for a zone: an assignment to
 * process.env.TZ inside Jest, a @timezone pragma Jest never reads or whose
 * environment ignores it, and a zone Node does not know.
 */
export const findTimezoneProblems: FindTimezoneProblemsFunction = (
  file: string,
  text: string,
): Array<TimezoneProblem> => {
  const problems: Array<TimezoneProblem> = [];

  // Most files name neither: they need no parse.
  if (
    !isJestTestCode(file) ||
    (!text.includes("TZ") && !text.includes("@timezone"))
  ) {
    return problems;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );

  const lineOf: (position: number) => number = (position: number): number => {
    return source.getLineAndCharacterOfPosition(position).line + 1;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      ASSIGNMENTS.has(node.operatorToken.kind) &&
      isProcessEnvTimezone(node.left)
    ) {
      problems.push({
        file: file,
        line: lineOf(node.getStart(source)),
        message: RUNTIME_ASSIGNMENT_MESSAGE,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  const leading: RegExpExecArray | null = LEADING_COMMENT.exec(text);
  const docblockEnd: number = leading ? leading[0].length : 0;
  const honoursDocblock: boolean = DOCBLOCK_PROJECTS.some(
    (prefix: string): boolean => {
      return file.startsWith(prefix);
    },
  );

  for (const comment of blockComments(source)) {
    let offset: number = comment.pos;

    for (const commentLine of text
      .slice(comment.pos, comment.end)
      .split("\n")) {
      const pragma: RegExpExecArray | null = PRAGMA_LINE.exec(commentLine);
      const line: number = lineOf(offset);

      offset += commentLine.length + 1;

      if (!pragma) {
        continue;
      }

      if (comment.end > docblockEnd) {
        problems.push({
          file: file,
          line: line,
          message: PRAGMA_NOT_FIRST_MESSAGE,
        });
        continue;
      }

      if (!honoursDocblock) {
        problems.push({
          file: file,
          line: line,
          message: PRAGMA_NOT_HONOURED_MESSAGE,
        });
        continue;
      }

      if (!isKnownZone(pragma[1]!)) {
        problems.push({
          file: file,
          line: line,
          message: `${UNKNOWN_ZONE_MESSAGE}: ${pragma[1]!}`,
        });
      }
    }
  }

  return problems.sort((a: TimezoneProblem, b: TimezoneProblem): number => {
    return a.line - b.line;
  });
};

export type ReportTimezoneProblemFunction = (
  problem: TimezoneProblem,
) => string;

// A problem as the guards print it.
export const reportTimezoneProblem: ReportTimezoneProblemFunction = (
  problem: TimezoneProblem,
): string => {
  return `${problem.file}:${problem.line} ${problem.message}`;
};
