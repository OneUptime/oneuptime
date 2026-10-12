import ts from "typescript";
import {
  CONTROL_ESCAPES,
  CharacterClass,
  ClassRange,
  characterClassesOf,
} from "Common/Tests/Helpers/RegExpCharacterClasses";

/*
 * The character class reader is shared with the product code guard
 * (Common/Tests/Helpers/RegExpCharacterClasses); the docs suites import it
 * from here as they always have.
 */
export { characterClassesOf };
export type { CharacterClass, ClassRange };

/*
 * The docs tests, read the way code scanning (CodeQL) reads them, for
 * DocsCodeScanningGuard. Code scanning reads test code as well as product
 * code, and the docs tests are written quickly, by many hands, from
 * patterns copied from suite to suite: within days, alerts #2111, #2137,
 * #2212, #2215, #2216 and #2217 were opened on them. Each check below is one
 * of code scanning's, read at least as strictly:
 *
 * js/incomplete-sanitization
 *   - "own escape": a replace that writes a backslash before what it
 *     matched ("\\$&", "\\$1", or "\\." for a "."), anywhere but the shared
 *     helpers (DocsTranslationChecks.ts). A suite escapes text for a pattern
 *     with escapeRegExp, or writes the escaped text out.
 *   - "incomplete escape": such an escape that misses a backslash in the
 *     text ("This does not escape backslash characters in the input") or
 *     escapes only the first match, wherever it is.
 *   - "first occurrence only": a replace of one meta-character, or of a URL
 *     escape or "..", that is not global ("This replaces only the first
 *     occurrence of ..."), with code scanning's exceptions: a replace that a
 *     loop feeds its own text (text = text.replace(...)), a pair that takes
 *     the delimiters off both ends ("[" then "]"), and a "\n", "%" or "$"
 *     taken out on its own.
 * js/overly-large-range
 *   - "overlapping ranges": two ranges of one character class that share
 *     characters, as U+2E80-U+9FFF and U+8C48-U+FAFF of the old
 *     WIDE_CHARACTER did.
 *   - "range overlapping a class escape": a range sharing characters with a
 *     \d, \w or \s of the same class.
 *   - "overly wide range": an ASCII range of ten or more characters that
 *     crosses from letters or digits into punctuation, such as A-z.
 *   Code scanning leaves out a range written with escapes, and the patterns
 *   built with new RegExp from a string; these checks read them too.
 * Two more, about the cause of #2216 and #2217:
 *   - "normalized character": a pattern holding a character that Unicode
 *     normalization (NFC) turns into another, such as a CJK compatibility
 *     ideograph. Tools and editors normalize text: U+F900, typed to
 *     start a range, became U+8C48, and the range started in the middle of
 *     the Chinese characters instead. Write such a character as an escape.
 *   - "own wide-character class": a pattern that matches Chinese, Japanese
 *     and Korean letters but no Latin, Cyrillic, Arabic or Devanagari ones,
 *     outside DocsTranslationChecks.ts: a suite measures a label line with
 *     labelLineWidth, which names the scripts it counts.
 * js/incomplete-url-substring-sanitization
 *   - "URL substring check": includes, startsWith, endsWith or a compared
 *     indexOf with a host on a common top-level domain or an http(s) URL, as
 *     code scanning matches one (#1718, #1719). Parse the URL and compare
 *     its origin or host whole.
 */

export type DocsCodeScanningProblem =
  | "own escape"
  | "incomplete escape"
  | "first occurrence only"
  | "overlapping ranges"
  | "range overlapping a class escape"
  | "overly wide range"
  | "normalized character"
  | "own wide-character class"
  | "URL substring check";

export interface DocsCodeScanningFinding {
  // The file's name in the docs tests folder.
  file: string;
  line: number;
  problem: DocsCodeScanningProblem;
  // The code, its whitespace runs as one space, cut to 80 characters.
  code: string;
  // What is wrong with it, in particular.
  detail: string;
}

// The file that escapes text for a pattern and names the wide characters.
export const SHARED_HELPERS_FILE: string = "DocsTranslationChecks.ts";

// What each problem asks for instead.
export const FIXES: Readonly<Record<DocsCodeScanningProblem, string>> = {
  "own escape":
    "escape text for a pattern with escapeRegExp from ./DocsTranslationChecks, or write the escaped text out",
  "incomplete escape":
    "escape every character a pattern reads as syntax, a backslash too, in every place it occurs (escapeRegExp)",
  "first occurrence only":
    "replace every occurrence (the g flag, or replaceAll), or build the text without a replace",
  "overlapping ranges":
    "give each character to one range of the class; name a script with \\p{Script=...} and the u flag",
  "range overlapping a class escape":
    "leave out the range or the escape: they match the same characters",
  "overly wide range":
    "list the characters the range is meant to match: it crosses from letters or digits into punctuation",
  "normalized character":
    "write the character as an escape (\\u{...}): Unicode normalization turns it into another character",
  "own wide-character class":
    "measure a diagram's label lines with labelLineWidth from ./DocsTranslationChecks",
  "URL substring check":
    "parse the URL (new URL(...).origin or .host) and compare it whole",
};

// A pattern as the code writes it: a /literal/ or RegExp("...", "...").
interface WrittenPattern {
  source: string;
  flags: string;
  // The code that writes it.
  node: ts.Node;
}

const LETTER_OR_DIGIT: RegExp = /^[A-Za-z0-9]$/;
const BACKSLASH: string = "\\";

/*
 * ---------------------------------------------------------------------------
 * The checks.
 * ---------------------------------------------------------------------------
 */

const WHITESPACE_RUN: RegExp = /\s+/g;

// "\\$&", "\\$1", "\\$<name>": a backslash, then what the pattern matched.
const SUBSTITUTION_ESCAPE: RegExp = /^\\\$(?:&|\d{1,2}|<[^>]+>)$/;

// The characters code scanning takes a replace of one of to be sanitizing.
const META_CHARACTERS: string = "'\"\\&<>\n\r\t*|{}[]%$";
const URL_ESCAPES: RegExp = /^(?:%[0-9A-Fa-f]{2})+$/;
const PATH_STEPS: ReadonlyArray<string> = ["..", "/..", "../", "/../"];
// What code scanning lets a lone replace take out: one of these, with "".
const LONE_REMOVALS: ReadonlyArray<string> = ["\n", "%", "$"];
// Delimiters a pair of replaces takes off both ends of a string.
const DELIMITER_PAIRS: ReadonlyArray<[string, string]> = [
  ["[", "]"],
  ["{", "}"],
  ["(", ")"],
  ['"', '"'],
  ["'", "'"],
];
const REPLACE_CALLS: ReadonlyArray<string> = ["replace", "replaceAll"];

// A character a pattern reads as syntax outside a character class.
const SYNTAX_CHARACTERS: string = "^$\\.*+?()[]{}|/";

// Letters of the scripts drawn wide, and of others that are not.
const WIDE_PROBES: ReadonlyArray<string> = [0x4e2d, 0x30ab, 0xd55c].map(
  (codePoint: number): string => {
    return String.fromCodePoint(codePoint);
  },
);
const NARROW_PROBES: ReadonlyArray<string> = [
  0x41, 0xe9, 0x436, 0x628, 0x915,
].map((codePoint: number): string => {
  return String.fromCodePoint(codePoint);
});

/*
 * A host on a common top-level domain, or an http(s) URL, as code scanning
 * matches the text a substring check looks for (whole, any case).
 */
const HOST_ON_COMMON_DOMAIN: RegExp =
  /^(?:[a-z]*:?\/\/)?\.?(?:[a-z0-9-]+\.)+(?:com|org|edu|gov|uk|net|io)(?![a-z0-9])(?::[0-9]+)?\/?$/i;
const HTTP_URL: RegExp = /^https?:\/\/(?:[a-z0-9-]+\.)+[a-z]+(?::[0-9]+)?\/?$/i;
const HTTP_URL_WITH_PATH: RegExp =
  /^https?:\/\/(?:[a-z0-9-]+\.)+[a-z]+(?::[0-9]+)?\/[a-z0-9/_-]+$/i;
// What code scanning lets a suffix check look for: a dot, then a domain.
const DOTTED_SUFFIX: RegExp = /^\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
// What it lets a prefix check look for: anything ending in a port or a "/".
const ENDS_IN_PORT_OR_SLASH: RegExp = /(?::[0-9]+|\/)$/;
// What a check on part of an unparsed URL lets through, as code scanning says it.
const URL_CHECK_GAPS: Readonly<Record<string, string>> = {
  includes: "can be anywhere in the URL, with any host before or after it",
  startsWith: "can be followed by any host name",
  endsWith: "can be preceded by any host name",
};
const SUBSTRING_CHECKS: ReadonlyArray<string> = Object.keys(URL_CHECK_GAPS);
const COMPARISONS: ReadonlyArray<ts.SyntaxKind> = [
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
];

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

function hex(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function describeRange(range: ClassRange): string {
  return `${range.text} (${hex(range.low)}-${hex(range.high)})`;
}

// A pattern as it runs, without g or y, or null when it cannot be built.
function build(pattern: WrittenPattern): RegExp | null {
  try {
    return new RegExp(
      pattern.source,
      Array.from(pattern.flags)
        .filter((flag: string): boolean => {
          return flag !== "g" && flag !== "y";
        })
        .join(""),
    );
  } catch {
    return null;
  }
}

/*
 * The one text a pattern matches, when it is a plain run of characters
 * ("\\.", "\"", "<!--", "\\n"); null when it matches more than one.
 */
function onlyMatchOf(pattern: WrittenPattern): string | null {
  if (pattern.flags.includes("i")) {
    return null;
  }

  let text: string = "";
  let at: number = 0;

  while (at < pattern.source.length) {
    const character: string = pattern.source.charAt(at);

    if (character === BACKSLASH) {
      const escaped: string = pattern.source.charAt(at + 1);

      // A newline, a tab and the like: one character.
      if (escaped !== "b" && CONTROL_ESCAPES[escaped] !== undefined) {
        text += String.fromCharCode(CONTROL_ESCAPES[escaped] as number);
        at += 2;
        continue;
      }

      // "\d", "\b", "\x41" and the like are not one character as written.
      if (LETTER_OR_DIGIT.test(escaped) || escaped === "") {
        return null;
      }

      text += escaped;
      at += 2;
      continue;
    }

    if (SYNTAX_CHARACTERS.includes(character) && character !== "/") {
      return null;
    }

    text += character;
    at++;
  }

  return text;
}

/*
 * The texts a non-global pattern replaces, as code scanning reads them: the
 * one text of a plain run, or each character of a class that lists
 * characters and nothing else ("[<>]").
 */
function matchedTexts(pattern: WrittenPattern): Array<string> {
  const only: string | null = onlyMatchOf(pattern);

  if (only !== null) {
    return [only];
  }

  const classes: Array<CharacterClass> = characterClassesOf(
    pattern.source,
    pattern.flags,
  );
  const whole: CharacterClass | undefined = classes[0];

  if (
    classes.length === 1 &&
    whole !== undefined &&
    whole.text === pattern.source &&
    !whole.negated &&
    whole.ranges.length === 0 &&
    whole.classEscapes.length === 0 &&
    whole.propertyEscapes.length === 0
  ) {
    return whole.characters.map((value: number): string => {
      return String.fromCodePoint(value);
    });
  }

  return [];
}

// What \d, \w and \s match, as runs of characters.
const CLASS_ESCAPE_RUNS: Readonly<Record<string, Array<[number, number]>>> = {
  d: [[0x30, 0x39]],
  w: [
    [0x30, 0x39],
    [0x41, 0x5a],
    [0x5f, 0x5f],
    [0x61, 0x7a],
  ],
  s: [
    [0x09, 0x0d],
    [0x20, 0x20],
    [0xa0, 0xa0],
    [0x1680, 0x1680],
    [0x2000, 0x200a],
    [0x2028, 0x2029],
    [0x202f, 0x202f],
    [0x205f, 0x205f],
    [0x3000, 0x3000],
    [0xfeff, 0xfeff],
  ],
};

// Whether a range shares a character with \d, \w or \s.
function sharesWithClassEscape(range: ClassRange, name: string): boolean {
  return (CLASS_ESCAPE_RUNS[name] || []).some(
    ([low, high]: [number, number]): boolean => {
      return range.low <= high && low <= range.high;
    },
  );
}

function isAlphanumeric(value: number): boolean {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x5a) ||
    (value >= 0x61 && value <= 0x7a)
  );
}

/*
 * Whether a range is one code scanning calls overly wide: ten or more
 * characters across Z-a or 9-A, or an ASCII range with a punctuation end,
 * except the ranges it allows (to "~", from " " or "!", @-_, from the zero
 * character, 0-? and @-Z).
 */
function isOverlyWide(range: ClassRange): boolean {
  const low: number = range.low;
  const high: number = range.high;

  if (high - low + 1 < 10) {
    return false;
  }

  const allowed: boolean =
    high === 0x7e ||
    low === 0x20 ||
    low === 0x21 ||
    (low === 0x40 && high === 0x5f) ||
    low === 0 ||
    (low === 0x30 && high === 0x3f) ||
    (low === 0x40 && high === 0x5a);

  if (allowed) {
    return false;
  }

  return (
    (low <= 0x5a && high >= 0x61) ||
    (low <= 0x39 && high >= 0x41) ||
    ((!isAlphanumeric(low) || !isAlphanumeric(high)) &&
      low < 0x80 &&
      high < 0x80)
  );
}

// The node a call is made on: `text` in text.replace(...).
function receiverOf(call: ts.CallExpression): ts.Expression | null {
  return ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression
    : null;
}

function methodNameOf(call: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : null;
}

// The call made on this call's result, as in a.replace(x).replace(y).
function callOnResultOf(call: ts.CallExpression): ts.CallExpression | null {
  const access: ts.Node = call.parent;

  if (
    ts.isPropertyAccessExpression(access) &&
    access.expression === call &&
    ts.isCallExpression(access.parent) &&
    access.parent.expression === access
  ) {
    return access.parent;
  }

  return null;
}

function isLoop(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

// Whether a node runs again and again in a loop of its own function.
function isInLoop(node: ts.Node): boolean {
  for (
    let ancestor: ts.Node = node.parent;
    ancestor && !ts.isSourceFile(ancestor);
    ancestor = ancestor.parent
  ) {
    if (ts.isFunctionLike(ancestor)) {
      return false;
    }

    if (isLoop(ancestor)) {
      return true;
    }
  }

  return false;
}

/*
 * Whether a replace feeds its own text, as `text = text.replace("<", "")`
 * in a loop does: the next round replaces the next occurrence. Code
 * scanning lets such a replace be.
 */
function feedsItsOwnText(call: ts.CallExpression): boolean {
  const receiver: ts.Expression | null = receiverOf(call);
  let assignment: ts.Node = call.parent;

  while (ts.isParenthesizedExpression(assignment)) {
    assignment = assignment.parent;
  }

  return (
    receiver !== null &&
    ts.isIdentifier(receiver) &&
    ts.isBinaryExpression(assignment) &&
    assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(assignment.left) &&
    assignment.left.text === receiver.text &&
    isInLoop(call)
  );
}

/*
 * What a file of the docs tests holds that code scanning reports, or that
 * the docs tests leave to the shared helpers. `fileName` is its name in the
 * folder, `text` its source.
 */
export function findCodeScanningProblems(
  fileName: string,
  text: string,
): Array<DocsCodeScanningFinding> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings: Array<DocsCodeScanningFinding> = [];
  const patterns: Map<string, WrittenPattern> = new Map();
  const strings: Map<string, string> = new Map();
  const isSharedHelpers: boolean = fileName === SHARED_HELPERS_FILE;

  const found: (
    node: ts.Node,
    problem: DocsCodeScanningProblem,
    detail: string,
  ) => void = (
    node: ts.Node,
    problem: DocsCodeScanningProblem,
    detail: string,
  ): void => {
    findings.push({
      file: fileName,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      problem: problem,
      code: node.getText(source).replace(WHITESPACE_RUN, " ").slice(0, 80),
      detail: detail,
    });
  };

  // The pattern an expression writes: a /literal/ or RegExp("...", "...").
  const writtenPatternOf: (node: ts.Node) => WrittenPattern | null = (
    node: ts.Node,
  ): WrittenPattern | null => {
    if (ts.isRegularExpressionLiteral(node)) {
      const lastSlash: number = node.text.lastIndexOf("/");

      return {
        source: node.text.slice(1, lastSlash),
        flags: node.text.slice(lastSlash + 1),
        node: node,
      };
    }

    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp" &&
      node.arguments !== undefined &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0] as ts.Expression)
    ) {
      const flags: ts.Expression | undefined = node.arguments[1];

      return {
        source: (node.arguments[0] as ts.StringLiteralLike).text,
        flags: flags && ts.isStringLiteralLike(flags) ? flags.text : "",
        node: node,
      };
    }

    return null;
  };

  // The pattern an argument passes: written there, or a constant's.
  const patternOf: (node: ts.Expression) => WrittenPattern | null = (
    node: ts.Expression,
  ): WrittenPattern | null => {
    if (ts.isParenthesizedExpression(node)) {
      return patternOf(node.expression);
    }

    if (ts.isIdentifier(node)) {
      return patterns.get(node.text) || null;
    }

    return writtenPatternOf(node);
  };

  // The text an argument passes: written there, or a constant's.
  const stringOf: (node: ts.Expression | undefined) => string | null = (
    node: ts.Expression | undefined,
  ): string | null => {
    if (node === undefined) {
      return null;
    }

    if (ts.isParenthesizedExpression(node)) {
      return stringOf(node.expression);
    }

    if (ts.isStringLiteralLike(node)) {
      return node.text;
    }

    if (ts.isIdentifier(node)) {
      const value: string | undefined = strings.get(node.text);

      return value === undefined ? null : value;
    }

    return null;
  };

  // The constants the file names: const ESCAPE: RegExp = /.../g, const URL = "...".
  visit(source, (node: ts.Node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      !node.initializer ||
      (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) === 0
    ) {
      return;
    }

    const pattern: WrittenPattern | null = writtenPatternOf(node.initializer);

    if (pattern) {
      patterns.set(node.name.text, pattern);
      return;
    }

    const value: string | null = stringOf(node.initializer);

    if (value !== null) {
      strings.set(node.name.text, value);
    }
  });

  // What a replace call replaces: a pattern, or a string.
  const replacedBy: (call: ts.CallExpression) => {
    pattern: WrittenPattern | null;
    text: string | null;
    replacement: string | null;
    global: boolean;
  } | null = (call: ts.CallExpression) => {
    const method: string | null = methodNameOf(call);

    if (
      method === null ||
      !REPLACE_CALLS.includes(method) ||
      call.arguments.length < 2
    ) {
      return null;
    }

    const first: ts.Expression = call.arguments[0] as ts.Expression;
    const pattern: WrittenPattern | null = patternOf(first);
    const text: string | null = pattern ? null : stringOf(first);

    return {
      pattern: pattern,
      text: text,
      replacement: stringOf(call.arguments[1]),
      global:
        method === "replaceAll" ||
        (pattern !== null && pattern.flags.includes("g")),
    };
  };

  // Whether a call escapes text, reported if it is incomplete or a copy.
  const checkEscape: (call: ts.CallExpression) => boolean = (
    call: ts.CallExpression,
  ): boolean => {
    const replace: ReturnType<typeof replacedBy> = replacedBy(call);

    if (!replace || replace.replacement === null) {
      return false;
    }

    const only: string | null = replace.pattern
      ? onlyMatchOf(replace.pattern)
      : replace.text;
    const isEscape: boolean =
      SUBSTITUTION_ESCAPE.test(replace.replacement) ||
      (only !== null &&
        only !== "" &&
        replace.replacement === `${BACKSLASH}${only}`);

    if (!isEscape) {
      return false;
    }

    const built: RegExp | null = replace.pattern
      ? build(replace.pattern)
      : null;
    const escapesBackslashes: boolean = replace.pattern
      ? built !== null && built.test(BACKSLASH)
      : replace.text === BACKSLASH;

    if (!replace.global || !escapesBackslashes) {
      found(
        call,
        "incomplete escape",
        !replace.global
          ? "it escapes only the first match"
          : "a backslash in the text is left as it is",
      );
      return true;
    }

    if (!isSharedHelpers) {
      found(call, "own escape", "it escapes text itself");
    }

    return true;
  };

  const checkFirstOccurrence: (call: ts.CallExpression) => void = (
    call: ts.CallExpression,
  ): void => {
    if (methodNameOf(call) !== "replace") {
      return;
    }

    const replace: ReturnType<typeof replacedBy> = replacedBy(call);

    if (!replace || replace.global) {
      return;
    }

    const texts: Array<string> = replace.pattern
      ? matchedTexts(replace.pattern)
      : replace.text !== null
        ? [replace.text]
        : [];
    const sanitizes: boolean = texts.some((matched: string): boolean => {
      return (
        (matched.length === 1 && META_CHARACTERS.includes(matched)) ||
        URL_ESCAPES.test(matched) ||
        PATH_STEPS.includes(matched) ||
        (replace.replacement !== null && URL_ESCAPES.test(replace.replacement))
      );
    });

    if (!sanitizes || feedsItsOwnText(call)) {
      return;
    }

    const removes: (
      other: ts.CallExpression | null,
      what: string,
    ) => boolean = (other: ts.CallExpression | null, what: string): boolean => {
      if (!other || methodNameOf(other) !== "replace") {
        return false;
      }

      const otherReplace: ReturnType<typeof replacedBy> = replacedBy(other);

      return (
        otherReplace !== null &&
        otherReplace.pattern === null &&
        otherReplace.text === what &&
        otherReplace.replacement === ""
      );
    };

    const receiver: ts.Expression | null = receiverOf(call);
    const before: ts.CallExpression | null =
      receiver && ts.isCallExpression(receiver) ? receiver : null;
    const after: ts.CallExpression | null = callOnResultOf(call);

    // A pair that takes a delimiter off each end: .replace("[", "").replace("]", "").
    const unwraps: boolean = DELIMITER_PAIRS.some(
      ([left, right]: [string, string]): boolean => {
        return (
          (removes(call, left) && removes(after, right)) ||
          (removes(call, right) && removes(before, left))
        );
      },
    );

    // One "\n", "%" or "$" taken out on its own, in no chain of replaces.
    const isLoneRemoval: boolean =
      replace.replacement === "" &&
      texts.length === 1 &&
      LONE_REMOVALS.includes(texts[0] as string) &&
      ![before, after].some((other: ts.CallExpression | null): boolean => {
        return (
          other !== null && REPLACE_CALLS.includes(methodNameOf(other) || "")
        );
      });

    if (!unwraps && !isLoneRemoval) {
      found(
        call,
        "first occurrence only",
        `it replaces only the first ${JSON.stringify(texts[0] ?? "")}`,
      );
    }
  };

  const checkPattern: (pattern: WrittenPattern) => void = (
    pattern: WrittenPattern,
  ): void => {
    const written: string = pattern.node.getText(source);
    const normalized: Array<string> = Array.from(written).filter(
      (character: string): boolean => {
        return character.normalize("NFC") !== character;
      },
    );

    if (normalized.length > 0 || written.normalize("NFC") !== written) {
      found(
        pattern.node,
        "normalized character",
        normalized.length > 0
          ? `NFC turns ${normalized
              .map((character: string): string => {
                return `${hex(character.codePointAt(0) as number)} into ${Array.from(
                  character.normalize("NFC"),
                )
                  .map((part: string): string => {
                    return hex(part.codePointAt(0) as number);
                  })
                  .join(" ")}`;
              })
              .join(", ")}`
          : "NFC joins characters of it into one",
      );
    }

    const built: RegExp | null = build(pattern);

    if (!built) {
      return;
    }

    if (
      !isSharedHelpers &&
      WIDE_PROBES.every((probe: string): boolean => {
        return built.test(probe);
      }) &&
      !NARROW_PROBES.some((probe: string): boolean => {
        return built.test(probe);
      })
    ) {
      found(
        pattern.node,
        "own wide-character class",
        "it matches Chinese, Japanese and Korean letters and no others",
      );
    }

    for (const characterClass of characterClassesOf(
      pattern.source,
      pattern.flags,
    )) {
      characterClass.ranges.forEach((range: ClassRange, index: number) => {
        for (const other of characterClass.ranges.slice(index + 1)) {
          if (range.low <= other.high && other.low <= range.high) {
            found(
              pattern.node,
              "overlapping ranges",
              `${describeRange(range)} and ${describeRange(other)} share ${hex(
                Math.max(range.low, other.low),
              )}-${hex(Math.min(range.high, other.high))}`,
            );
          }
        }

        for (const name of characterClass.classEscapes) {
          if (
            (name === "d" || name === "w" || name === "s") &&
            sharesWithClassEscape(range, name)
          ) {
            found(
              pattern.node,
              "range overlapping a class escape",
              `${describeRange(range)} and \\${name} match the same characters`,
            );
          }
        }

        if (isOverlyWide(range)) {
          found(
            pattern.node,
            "overly wide range",
            `${describeRange(range)} spans ${range.high - range.low + 1} characters, punctuation among them`,
          );
        }
      });
    }
  };

  const checkUrlSubstring: (call: ts.CallExpression) => void = (
    call: ts.CallExpression,
  ): void => {
    const method: string | null = methodNameOf(call);

    if (method === null || call.arguments.length === 0) {
      return;
    }

    let check: string | null = SUBSTRING_CHECKS.includes(method)
      ? method
      : null;

    if (method === "indexOf") {
      const parent: ts.Node = call.parent;

      if (
        ts.isBinaryExpression(parent) &&
        COMPARISONS.includes(parent.operatorToken.kind)
      ) {
        const other: ts.Expression =
          parent.left === call ? parent.right : parent.left;
        const isStart: boolean =
          ts.isNumericLiteral(other) &&
          other.text === "0" &&
          [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
          ].includes(parent.operatorToken.kind);

        check = isStart ? "startsWith" : "includes";
      } else if (
        ts.isPrefixUnaryExpression(parent) &&
        parent.operator === ts.SyntaxKind.TildeToken
      ) {
        check = "includes";
      }
    }

    if (check === null) {
      return;
    }

    const target: string | null = stringOf(call.arguments[0]);

    if (target === null) {
      return;
    }

    const looksLikeUrl: boolean =
      HOST_ON_COMMON_DOMAIN.test(target) ||
      HTTP_URL.test(target) ||
      (check === "includes" && HTTP_URL_WITH_PATH.test(target));
    const allowed: boolean =
      (check === "endsWith" && DOTTED_SUFFIX.test(target)) ||
      (check === "startsWith" && ENDS_IN_PORT_OR_SLASH.test(target));

    if (looksLikeUrl && !allowed) {
      found(
        call,
        "URL substring check",
        `${JSON.stringify(target)} ${URL_CHECK_GAPS[check]}`,
      );
    }
  };

  visit(source, (node: ts.Node) => {
    const pattern: WrittenPattern | null = writtenPatternOf(node);

    if (pattern) {
      checkPattern(pattern);
    }

    if (ts.isCallExpression(node)) {
      // An escape that misses the rest is reported once, as an escape.
      if (!checkEscape(node)) {
        checkFirstOccurrence(node);
      }
      checkUrlSubstring(node);
    }
  });

  return findings.sort(
    (left: DocsCodeScanningFinding, right: DocsCodeScanningFinding): number => {
      return left.line - right.line;
    },
  );
}
