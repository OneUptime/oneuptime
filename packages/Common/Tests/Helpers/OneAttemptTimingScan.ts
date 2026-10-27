import ts from "typescript";

/*
 * THE DETECTOR BEHIND THE ONE-ATTEMPT TIMING GUARDS: A TEST THAT TIMES WORK
 * WITH ONE PAIR OF CLOCK READS AND HOLDS IT TO A LIMIT.
 *
 *   const started: number = Date.now();
 *   redact(text);
 *   expect(Date.now() - started).toBeLessThan(2000);
 *
 * One timing on a busy runner is noisy: the other workers, a garbage
 * collection or a slower machine stall one attempt for longer than the work
 * takes, and such suites failed master and release gates for code that had
 * not changed (Gsm7Text, MarkdownEditorLongLines, ProductionReviewDiff and
 * twelve suites of #5070 in October 2026). Tests/Helpers/FastestRun times
 * the work up to three times and counts the fastest, as it would have run
 * on a usual runner when every attempt overran on a slow one, so the 270
 * such timings left (257 assertions and 13 helpers) moved onto it on
 * 2026-10-27, and this detector keeps new ones out. It finds:
 *
 *   - an upper bound (toBeLessThan, toBeLessThanOrEqual) on the time
 *     between a clock read and a later one - inline, or through a variable
 *     that holds it;
 *   - a helper that returns that time, which a test then holds to a limit
 *     (the `timeOf` helpers of the linear-time suites).
 *
 * The clocks are Date.now(), performance.now() and new Date().getTime().
 * Work that awaits is left alone: it measures a deadline - a timer, a
 * socket, a process - and running it again would repeat what it did, so
 * FastestRun's attempts do not fit it. Synchronous work that is a deadline
 * all the same (a child process run to its end) says so in a comment just
 * above its first clock read: "Timed once: <why>".
 *
 * Two suites run this: packages/Common/Tests/Helpers/OneAttemptTimingGuard
 * over the checkout, and ee/Tests/Server/OneAttemptTimingGuard over ee/'s
 * files, from the only job that has ee/ checked out.
 */

export interface OneAttemptTiming {
  // The file, by its path from the repository's root.
  file: string;
  // The line of the assertion, or of a helper's return.
  line: number;
  // An assertion on the time, or a helper that returns it.
  kind: "assertion" | "helper";
  // The code on that line, trimmed.
  code: string;
}

// What a guard says to do instead.
export const ONE_ATTEMPT_TIMING_FIX: string =
  'time the work with Tests/Helpers/FastestRun (fastestRun({ run, limitInMs }).inMs), or, for a deadline that cannot run twice, say why above the first clock read: "Timed once: <why>"';

// The comment that marks a synchronous deadline, and so a site to leave alone.
const TIMED_ONCE: RegExp = /timed once:\s*\S/i;

const UPPER_BOUNDS: ReadonlySet<string> = new Set<string>([
  "toBeLessThan",
  "toBeLessThanOrEqual",
]);

const TSX_FILE: RegExp = /\.tsx$/;
const JSX_FILE: RegExp = /\.jsx$/;
const JS_FILE: RegExp = /\.[cm]?js$/;

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

function unwrap(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

export type IsClockReadFunction = (node: ts.Expression) => boolean;

// Date.now(), performance.now() or new Date().getTime().
export const isClockRead: IsClockReadFunction = (
  node: ts.Expression,
): boolean => {
  const call: ts.Expression = unwrap(node);

  if (
    !ts.isCallExpression(call) ||
    call.arguments.length !== 0 ||
    !ts.isPropertyAccessExpression(call.expression)
  ) {
    return false;
  }

  const object: ts.Expression = unwrap(call.expression.expression);
  const method: string = call.expression.name.text;

  if (method === "now" && ts.isIdentifier(object)) {
    return object.text === "Date" || object.text === "performance";
  }

  return (
    method === "getTime" &&
    ts.isNewExpression(object) &&
    ts.isIdentifier(object.expression) &&
    object.expression.text === "Date" &&
    (object.arguments === undefined || object.arguments.length === 0)
  );
};

// The name a clock read is kept in: `const started = Date.now()`.
function clockStartOf(node: ts.Node): string | null {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    isClockRead(node.initializer)
  ) {
    return node.name.text;
  }

  return null;
}

// `<clock read> - start`: the name of the start, if that is what it is.
function elapsedStartOf(node: ts.Expression): string | null {
  const expression: ts.Expression = unwrap(node);

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.MinusToken &&
    isClockRead(expression.left)
  ) {
    const right: ts.Expression = unwrap(expression.right);

    return ts.isIdentifier(right) ? right.text : null;
  }

  return null;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node.parent;

  while (current && !isFunctionLike(current) && !ts.isSourceFile(current)) {
    current = current.parent;
  }

  return current;
}

interface TimingSite extends OneAttemptTiming {
  // Marked "Timed once: <why>" above its first clock read.
  isTimedOnce: boolean;
}

/*
 * Every upper bound on a clock pair's time in a file of code, and every
 * helper returning one, around work that does not await: marked "Timed
 * once:" or not.
 */
function findTimingSites(file: string, text: string): Array<TimingSite> {
  // Most files read no clock: they need no parse.
  if (!text.includes("now()") && !text.includes("getTime()")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );

  const starts: Array<{ name: string; declaration: ts.VariableDeclaration }> =
    [];
  // A variable that holds a clock pair's time, and the start it counts from.
  const elapsedValues: Array<{
    name: string;
    declaration: ts.VariableDeclaration;
    startName: string;
  }> = [];
  const awaitPositions: Array<{
    position: number;
    owner: ts.Node | undefined;
  }> = [];
  const candidates: Array<{
    node: ts.Node;
    kind: "assertion" | "helper";
    subject: ts.Expression;
  }> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const startName: string | null = clockStartOf(node);

    if (startName) {
      starts.push({
        name: startName,
        declaration: node as ts.VariableDeclaration,
      });
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const from: string | null = elapsedStartOf(node.initializer);

      if (from) {
        elapsedValues.push({
          name: node.name.text,
          declaration: node,
          startName: from,
        });
      }
    }

    if (
      ts.isAwaitExpression(node) ||
      (ts.isForOfStatement(node) && node.awaitModifier)
    ) {
      awaitPositions.push({
        position: node.getStart(source),
        owner: enclosingFunction(node),
      });
    }

    // expect(<subject>).toBeLessThan(<limit>)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      UPPER_BOUNDS.has(node.expression.name.text)
    ) {
      const target: ts.Expression = unwrap(node.expression.expression);

      if (
        ts.isCallExpression(target) &&
        ts.isIdentifier(target.expression) &&
        target.expression.text === "expect" &&
        target.arguments.length >= 1
      ) {
        candidates.push({
          node: node,
          kind: "assertion",
          subject: target.arguments[0]!,
        });
      }
    }

    // return <clock read> - start
    if (ts.isReturnStatement(node) && node.expression) {
      candidates.push({
        node: node,
        kind: "helper",
        subject: node.expression,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  // The start a name refers to at a place: its last declaration before it.
  const startBefore: (
    name: string,
    position: number,
  ) => ts.VariableDeclaration | undefined = (
    name: string,
    position: number,
  ): ts.VariableDeclaration | undefined => {
    let found: ts.VariableDeclaration | undefined = undefined;

    for (const start of starts) {
      if (start.name === name && start.declaration.getEnd() <= position) {
        found = start.declaration;
      }
    }

    return found;
  };

  const timings: Array<TimingSite> = [];

  for (const candidate of candidates) {
    const at: number = candidate.node.getStart(source);
    let startName: string | null = elapsedStartOf(candidate.subject);
    let measuredAt: number = at;

    // expect(elapsed) where `const elapsed = Date.now() - started`.
    if (!startName && candidate.kind === "assertion") {
      const subject: ts.Expression = unwrap(candidate.subject);

      if (ts.isIdentifier(subject)) {
        let held: (typeof elapsedValues)[number] | undefined = undefined;

        for (const value of elapsedValues) {
          if (value.name === subject.text && value.declaration.getEnd() <= at) {
            held = value;
          }
        }

        if (held) {
          startName = held.startName;
          measuredAt = held.declaration.getStart(source);
        }
      }
    }

    if (!startName) {
      continue;
    }

    const start: ts.VariableDeclaration | undefined = startBefore(
      startName,
      measuredAt,
    );

    if (!start) {
      continue;
    }

    // A helper returns the time of work it ran itself.
    const owner: ts.Node | undefined = enclosingFunction(candidate.node);

    if (candidate.kind === "helper" && enclosingFunction(start) !== owner) {
      continue;
    }

    // Work that awaits measures a deadline: left alone.
    const startedAt: number = start.getEnd();
    const awaits: boolean = awaitPositions.some(
      (entry: { position: number; owner: ts.Node | undefined }): boolean => {
        return (
          entry.position >= startedAt &&
          entry.position < measuredAt &&
          entry.owner === enclosingFunction(start)
        );
      },
    );

    if (awaits) {
      continue;
    }

    // "Timed once: <why>" just above the first clock read.
    const statement: ts.Node =
      start.parent && start.parent.parent ? start.parent.parent : start;
    const leading: string = text.slice(
      statement.getFullStart(),
      statement.getStart(source),
    );
    const line: number = source.getLineAndCharacterOfPosition(at).line;

    timings.push({
      file: file,
      line: line + 1,
      kind: candidate.kind,
      code: (text.split("\n")[line] || "").trim(),
      isTimedOnce: TIMED_ONCE.test(leading),
    });
  }

  return timings.sort((a: TimingSite, b: TimingSite): number => {
    return a.line - b.line;
  });
}

function withoutMark(site: TimingSite): OneAttemptTiming {
  return { file: site.file, line: site.line, kind: site.kind, code: site.code };
}

export type FindOneAttemptTimingsFunction = (
  file: string,
  text: string,
) => Array<OneAttemptTiming>;

/*
 * The one-attempt timings of a file of code: every upper bound on a clock
 * pair's time, and every helper returning one, around work that does not
 * await and is not marked "Timed once:".
 */
export const findOneAttemptTimings: FindOneAttemptTimingsFunction = (
  file: string,
  text: string,
): Array<OneAttemptTiming> => {
  return findTimingSites(file, text)
    .filter((site: TimingSite): boolean => {
      return !site.isTimedOnce;
    })
    .map(withoutMark);
};

/*
 * The timings a file marks "Timed once: <why>": deadlines of synchronous
 * work, which the guards list so each one is a decision a review can see.
 */
export const findTimedOnceTimings: FindOneAttemptTimingsFunction = (
  file: string,
  text: string,
): Array<OneAttemptTiming> => {
  return findTimingSites(file, text)
    .filter((site: TimingSite): boolean => {
      return site.isTimedOnce;
    })
    .map(withoutMark);
};

export type ReportOneAttemptTimingFunction = (
  timing: OneAttemptTiming,
) => string;

// A finding as the guards print it.
export const reportOneAttemptTiming: ReportOneAttemptTimingFunction = (
  timing: OneAttemptTiming,
): string => {
  return `${timing.file}:${timing.line} ${
    timing.kind === "helper"
      ? "returns the time of one attempt"
      : "holds one attempt's time to a limit"
  }: ${timing.code}`;
};

/*
 * Where the guards look: the jest packages whose tests can import
 * Common/Tests/Helpers/FastestRun (Common itself, and every package that
 * maps "Common/..." in its jest config). Left out are the Playwright package
 * (its specs time pages, not functions), the packages that test with Node's
 * own runner and no Common (the agents, Nginx), Tests/Ops (plain JavaScript
 * with no TypeScript transform), the mobile app (jest-expo, no Common at run
 * time), and the two recorders published to npm from inside App (their own
 * jest, no Common) - their few timings are theirs to keep.
 */
export const ONE_ATTEMPT_TIMING_SCOPE: ReadonlyArray<string> = [
  "packages/Common/",
  "packages/App/",
  "packages/Probe/",
  "packages/Runner/",
  "packages/Home/",
  "packages/CLI/",
  "packages/TestServer/",
  "Scripts/TerraformProvider/",
  "ee/",
];

// Packages inside the scope's folders that cannot import Common's helper.
export const ONE_ATTEMPT_TIMING_LEFT_OUT: ReadonlyArray<string> = [
  "packages/App/FeatureSet/MobileRecorder/",
  "packages/App/FeatureSet/BrowserRecorder/",
];

export type IsInOneAttemptTimingScopeFunction = (file: string) => boolean;

export const isInOneAttemptTimingScope: IsInOneAttemptTimingScopeFunction = (
  file: string,
): boolean => {
  const startsWithOneOf: (prefixes: ReadonlyArray<string>) => boolean = (
    prefixes: ReadonlyArray<string>,
  ): boolean => {
    return prefixes.some((prefix: string): boolean => {
      return file.startsWith(prefix);
    });
  };

  return (
    startsWithOneOf(ONE_ATTEMPT_TIMING_SCOPE) &&
    !startsWithOneOf(ONE_ATTEMPT_TIMING_LEFT_OUT)
  );
};
