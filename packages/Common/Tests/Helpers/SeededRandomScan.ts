import fs from "fs";
import path from "path";
import ts from "typescript";
import { REPOSITORY_DIRECTORY } from "./TagStripScan";

/*
 * The detector behind the seeded-generator guards: where a test file rolls a
 * pseudo-random generator of its own instead of drawing from the suites' one
 * generator, Tests/Helpers/SeededRandom. Two suites run it:
 *
 *   - packages/Common/Tests/Helpers/SeededRandomGuard.test.ts reads every
 *     test file of the checkout (TagStripScan's walk). It runs in the Common
 *     Test job, which removes ee/ first.
 *   - ee/Tests/Server/SeededRandomGuard.test.ts reads ee/'s test files from
 *     ee's own jest run, the only one with ee/ checked out.
 *
 * What it finds is the three kinds of generator the repository's tests
 * carried, wherever they are written - in code, or in a string or template
 * that a child process or a browser page runs:
 *
 *   1. a multiply by the multiplier of a known linear congruential
 *      generator (1103515245, 1664525, 16807, 9301 ... - LCG_MULTIPLIERS),
 *      written in decimal or hex, with or without "_" separators, as a
 *      number or a bigint, in place or held in a name the file multiplies
 *      by;
 *   2. mulberry32's step, an add of 0x6d2b79f5 (or splitmix64's
 *      0x9e3779b97f4a7c15);
 *   3. an xorshift step: a value XORed with a left shift of itself
 *      (x ^= x << 13, x ^ (x << 13)).
 *
 * Not a generator, and passed: a hash of a value (FNV, a multiplicative hash
 * such as Math.imul(index, 2654435761), a mixer's x ^= x >>> 16 - right
 * shifts only), a constant that is only compared or listed, a multiply by a
 * number no well-known generator uses, and anything in a comment. A value
 * XORed with a left shift of itself is read as an xorshift step wherever it
 * is, so a hash that mixes that way is flagged as well.
 *
 * It is a guard against the generators tests copy, not a proof that a file
 * has none: a generator of another kind (xoshiro, sfc32, a table) gets past
 * it, and a review has to catch that. Tests/Helpers/SeededRandom itself is
 * where the one generator lives.
 *
 * It imports nothing but node's fs and path, the TypeScript parser and
 * TagStripScan (for the repository's root).
 */

// The one file a seeded generator may be written in, from the repository's root.
export const SEEDED_RANDOM_HELPER: string =
  "packages/Common/Tests/Helpers/SeededRandom.ts";

// What a test draws from instead, as a failure says it.
export const SEEDED_RANDOM_FIX: string =
  'Draw from the suites\' one generator instead: import { seededRandom } from "Common/Tests/Helpers/SeededRandom" (a relative path outside Common), then seededRandom(seed)() for a fraction or seededRandom(seed)(limit) for a whole number below the limit; texts from an alphabet are generatedTexts in Tests/Helpers/GeneratedTexts.';

/*
 * Multipliers of linear congruential generators - the ones tests copied and
 * their usual neighbours - by value.
 */
export const LCG_MULTIPLIERS: ReadonlyMap<bigint, string> = new Map<
  bigint,
  string
>([
  [BigInt("1103515245"), "the ANSI C / glibc LCG"],
  [BigInt("1664525"), "the Numerical Recipes LCG"],
  [BigInt("22695477"), "the Borland LCG"],
  [BigInt("214013"), "the Microsoft LCG"],
  [BigInt("134775813"), "the Delphi LCG"],
  [BigInt("69069"), "Marsaglia's LCG"],
  [BigInt("1140671485"), "an LCG"],
  [BigInt("747796405"), "the PCG 32-bit LCG"],
  [BigInt("2891336453"), "an LCG"],
  [BigInt("1812433253"), "the Mersenne Twister's seeding LCG"],
  [BigInt("16807"), "the Park-Miller (MINSTD) generator"],
  [BigInt("48271"), "the Park-Miller (MINSTD) generator"],
  [BigInt("69621"), "the Park-Miller (MINSTD) generator"],
  [BigInt("65539"), "RANDU"],
  [BigInt("9301"), "the 9301 / 49297 / 233280 LCG"],
  [BigInt("25214903917"), "Java's LCG"],
  [BigInt("6364136223846793005"), "the Knuth MMIX / PCG 64-bit LCG"],
  [BigInt("2685821657736338717"), "the xorshift64* multiplier"],
]);

// Steps a counter-based generator adds on every draw.
export const WEYL_INCREMENTS: ReadonlyMap<bigint, string> = new Map<
  bigint,
  string
>([
  [BigInt("1831565813"), "mulberry32"],
  [BigInt("11400714819323198485"), "splitmix64"],
]);

export interface HandRolledGenerator {
  // From the repository's root, "/" between folders.
  file: string;
  line: number;
  // What was found: "a multiply by ...", "mulberry32's step", "an xorshift step".
  finding: string;
}

const NUMBER_TOKEN: RegExp = /\b(?:0[xX][0-9a-fA-F_]+|[0-9][0-9_]*)n?\b/g;
const NUMBER_SEPARATOR: RegExp = /_/g;
const BIGINT_SUFFIX: RegExp = /n$/;
/*
 * A multiply or an add in text, read from the few characters around a
 * number: "* 1103515245", "1103515245 *", "imul(x, 1103515245", "+ 0x6d2b79f5".
 */
const AROUND: number = 48;
const MULTIPLY_BEFORE: RegExp = /(?:\*=?|imul\s*\([^()]*,)\s*\(?\s*$/;
const MULTIPLY_AFTER: RegExp = /^\s*\)?\s*\*/;
const ADD_BEFORE: RegExp = /\+=?\s*\(?\s*$/;
// The name before an "^" or "^=", and what follows it: "x ^= x << 13", "x = x ^ (x << 13)".
const NAME_BEFORE: RegExp = /([\w$.]+)\s*(?:=\s*\(?\s*([\w$.]+)\s*)?$/;
const SHIFTED_AFTER: RegExp = /^=?\s*\(?\s*([\w$.]+)\s*<</;
// A line break as the TypeScript scanner counts one.
const LINE_BREAK: RegExp = /\r\n|[\r\n\u2028\u2029]/g;

// Files worth parsing: those that hold a number of the lists, or a left shift.
const CANDIDATE: RegExp = new RegExp(
  [
    "<<",
    ...[...LCG_MULTIPLIERS.keys(), ...WEYL_INCREMENTS.keys()].flatMap(
      (value: bigint): Array<string> => {
        const separated: (digits: string) => string = (
          digits: string,
        ): string => {
          return digits.split("").join("_?");
        };

        return [
          separated(value.toString(10)),
          `0[xX]${separated(value.toString(16))}`,
        ];
      },
    ),
  ].join("|"),
  "i",
);

type ValueOfFunction = (literalText: string) => bigint | null;

// The value of a number or bigint literal, as written in code or text.
export const valueOf: ValueOfFunction = (
  literalText: string,
): bigint | null => {
  const digits: string = literalText
    .replace(NUMBER_SEPARATOR, "")
    .replace(BIGINT_SUFFIX, "");

  try {
    return BigInt(digits);
  } catch {
    return null;
  }
};

type ParseFunction = (fileName: string, text: string) => ts.SourceFile;

const parse: ParseFunction = (
  fileName: string,
  text: string,
): ts.SourceFile => {
  let kind: ts.ScriptKind = ts.ScriptKind.TS;

  if (fileName.endsWith(".tsx")) {
    kind = ts.ScriptKind.TSX;
  } else if (fileName.endsWith(".jsx")) {
    kind = ts.ScriptKind.JSX;
  } else if (!fileName.endsWith(".ts")) {
    kind = ts.ScriptKind.JS;
  }

  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
};

type UnwrapFunction = (node: ts.Node) => ts.Node;

// A node without the parentheses, casts and "!" around it.
const unwrap: UnwrapFunction = (node: ts.Node): ts.Node => {
  let current: ts.Node = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

type OutsideFunction = (node: ts.Node) => ts.Node;

// The expression a node is an operand of, past the parentheses around it.
const outside: OutsideFunction = (node: ts.Node): ts.Node => {
  let current: ts.Node = node;

  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isPrefixUnaryExpression(current.parent))
  ) {
    current = current.parent;
  }

  return current;
};

const MULTIPLY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskEqualsToken,
]);

const ADD_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.PlusEqualsToken,
]);

type IsImulFunction = (callee: ts.Expression) => boolean;

// Math.imul, or an imul taken off it.
const isImul: IsImulFunction = (callee: ts.Expression): boolean => {
  const name: string = callee.getText();

  return name === "imul" || name.endsWith(".imul");
};

type IsOperandOfFunction = (
  node: ts.Node,
  operators: ReadonlySet<ts.SyntaxKind>,
) => boolean;

// Whether a value is multiplied (or added): an operand of the operator, or an argument of Math.imul.
const isOperandOf: IsOperandOfFunction = (
  node: ts.Node,
  operators: ReadonlySet<ts.SyntaxKind>,
): boolean => {
  const operand: ts.Node = outside(node);
  const parent: ts.Node | undefined = operand.parent;

  if (!parent) {
    return false;
  }

  if (ts.isBinaryExpression(parent)) {
    return operators.has(parent.operatorToken.kind);
  }

  return (
    operators === MULTIPLY_OPERATORS &&
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument: ts.Expression): boolean => {
      return argument === operand;
    }) &&
    isImul(parent.expression)
  );
};

type WithoutFoldFunction = (node: ts.Node) => ts.Node;

// A value without the 32-bit fold around it: (...) >>> 0, (...) | 0.
const withoutFold: WithoutFoldFunction = (node: ts.Node): ts.Node => {
  let value: ts.Node = unwrap(node);

  while (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind ===
      ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarToken) &&
    unwrap(value.right).getText() === "0"
  ) {
    value = unwrap(value.left);
  }

  return value;
};

type IsSelfLeftShiftFunction = (target: string, node: ts.Node) => boolean;

// Whether an expression is the target shifted left: x << 13.
const isSelfLeftShift: IsSelfLeftShiftFunction = (
  target: string,
  node: ts.Node,
): boolean => {
  const shift: ts.Node = withoutFold(node);

  return (
    ts.isBinaryExpression(shift) &&
    shift.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken &&
    unwrap(shift.left).getText() === target
  );
};

type IsXorshiftStepFunction = (node: ts.BinaryExpression) => boolean;

/*
 * x ^= x << 13, or x ^ (x << 13) wherever it is - assigned, returned, either
 * way round, inside a ">>> 0" or "| 0" or not.
 */
const isXorshiftStep: IsXorshiftStepFunction = (
  node: ts.BinaryExpression,
): boolean => {
  if (node.operatorToken.kind === ts.SyntaxKind.CaretEqualsToken) {
    return isSelfLeftShift(unwrap(node.left).getText(), node.right);
  }

  if (node.operatorToken.kind !== ts.SyntaxKind.CaretToken) {
    return false;
  }

  return (
    isSelfLeftShift(unwrap(node.left).getText(), node.right) ||
    isSelfLeftShift(unwrap(node.right).getText(), node.left)
  );
};

type XorshiftStepAtFunction = (text: string) => number;

/*
 * Where text holds an xorshift step, or -1: at an "^", the name XORed is the
 * name shifted left after it ("x ^= x << 13", "x ^ (x << 13)"). Each "^" is
 * read with the few characters around it, so a long string is read once.
 */
const xorshiftStepAt: XorshiftStepAtFunction = (text: string): number => {
  for (
    let caret: number = text.indexOf("^");
    caret !== -1;
    caret = text.indexOf("^", caret + 1)
  ) {
    const before: RegExpExecArray | null = NAME_BEFORE.exec(
      text.slice(Math.max(0, caret - AROUND), caret),
    );
    const after: RegExpExecArray | null = SHIFTED_AFTER.exec(
      text.slice(caret + 1, caret + 1 + AROUND),
    );

    if (!before || !after) {
      continue;
    }

    /*
     * The name XORed: the one before "^=", or before "^" - after an
     * assignment's "=" when there is one ("y = x ^ ...": x).
     */
    const xored: string =
      text.charAt(caret + 1) === "=" ? before[1]! : before[2] ?? before[1]!;

    if (after[1] === xored) {
      return caret;
    }
  }

  return -1;
};

interface TextFinding {
  // Where in the text it is.
  offset: number;
  finding: string;
}

type FindingsInTextFunction = (text: string) => Array<TextFinding>;

/*
 * Generators written in a string or a template - code a child process or a
 * browser page runs - read from the text itself.
 */
const findingsInText: FindingsInTextFunction = (
  text: string,
): Array<TextFinding> => {
  const findings: Array<TextFinding> = [];

  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const value: bigint | null = valueOf(match[0]);
    const multiplier: string | undefined =
      value === null ? undefined : LCG_MULTIPLIERS.get(value);
    const increment: string | undefined =
      value === null ? undefined : WEYL_INCREMENTS.get(value);

    if (!multiplier && !increment) {
      continue;
    }

    const start: number = match.index!;
    const before: string = text.slice(Math.max(0, start - AROUND), start);
    const after: string = text.slice(
      start + match[0].length,
      start + match[0].length + AROUND,
    );

    if (
      multiplier &&
      (MULTIPLY_BEFORE.test(before) || MULTIPLY_AFTER.test(after))
    ) {
      findings.push({
        offset: start,
        finding: `a multiply by ${multiplier}'s ${value!.toString()}`,
      });
    }

    if (increment && ADD_BEFORE.test(before)) {
      findings.push({ offset: start, finding: `${increment}'s step` });
    }
  }

  const xorshift: number = xorshiftStepAt(text);

  if (xorshift !== -1) {
    findings.push({ offset: xorshift, finding: "an xorshift step" });
  }

  return findings;
};

type FindGeneratorsFunction = (
  file: string,
  text: string,
) => Array<HandRolledGenerator>;

/*
 * The hand-rolled generators in one file's text, by its path from the
 * repository's root.
 */
export const findHandRolledGenerators: FindGeneratorsFunction = (
  file: string,
  text: string,
): Array<HandRolledGenerator> => {
  if (!CANDIDATE.test(text)) {
    return [];
  }

  const source: ts.SourceFile = parse(file, text);
  const found: Array<HandRolledGenerator> = [];
  // Names given a multiplier or an increment, and the names the file multiplies by or adds.
  const multiplierNames: Map<string, Array<[ts.Node, string]>> = new Map();
  const incrementNames: Map<string, Array<[ts.Node, string]>> = new Map();
  const multipliedNames: Set<string> = new Set<string>();
  const addedNames: Set<string> = new Set<string>();

  const report: (node: ts.Node, finding: string, linesIn?: number) => void = (
    node: ts.Node,
    finding: string,
    linesIn: number = 0,
  ): void => {
    found.push({
      file: file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line +
        1 +
        linesIn,
      finding: finding,
    });
  };

  const nameOf: (node: ts.Node) => string | null = (
    node: ts.Node,
  ): string | null => {
    const bare: ts.Node = unwrap(node);

    if (ts.isIdentifier(bare)) {
      return bare.text;
    }

    if (ts.isPropertyAccessExpression(bare)) {
      return bare.name.text;
    }

    return null;
  };

  const declaredName: (literal: ts.Node) => string | null = (
    literal: ts.Node,
  ): string | null => {
    const holder: ts.Node | undefined = outside(literal).parent;

    if (
      holder &&
      (ts.isVariableDeclaration(holder) ||
        ts.isPropertyDeclaration(holder) ||
        ts.isPropertyAssignment(holder)) &&
      holder.initializer === outside(literal) &&
      (ts.isIdentifier(holder.name) || ts.isStringLiteral(holder.name))
    ) {
      return holder.name.text;
    }

    return null;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
      const value: bigint | null = valueOf(node.text);
      const multiplier: string | undefined =
        value === null ? undefined : LCG_MULTIPLIERS.get(value);
      const increment: string | undefined =
        value === null ? undefined : WEYL_INCREMENTS.get(value);

      if (multiplier) {
        const finding: string = `a multiply by ${multiplier}'s ${value!.toString()}`;

        if (isOperandOf(node, MULTIPLY_OPERATORS)) {
          report(node, finding);
        } else {
          const name: string | null = declaredName(node);

          if (name) {
            multiplierNames.set(name, [
              ...(multiplierNames.get(name) || []),
              [node, finding],
            ]);
          }
        }
      }

      if (increment) {
        const finding: string = `${increment}'s step`;

        if (isOperandOf(node, ADD_OPERATORS)) {
          report(node, finding);
        } else {
          const name: string | null = declaredName(node);

          if (name) {
            incrementNames.set(name, [
              ...(incrementNames.get(name) || []),
              [node, finding],
            ]);
          }
        }
      }
    }

    if (ts.isBinaryExpression(node)) {
      if (MULTIPLY_OPERATORS.has(node.operatorToken.kind)) {
        for (const operand of [node.left, node.right]) {
          const name: string | null = nameOf(operand);

          if (name) {
            multipliedNames.add(name);
          }
        }
      }

      if (ADD_OPERATORS.has(node.operatorToken.kind)) {
        for (const operand of [node.left, node.right]) {
          const name: string | null = nameOf(operand);

          if (name) {
            addedNames.add(name);
          }
        }
      }

      if (isXorshiftStep(node)) {
        report(node, "an xorshift step");
      }
    }

    if (ts.isCallExpression(node) && isImul(node.expression)) {
      for (const argument of node.arguments) {
        const name: string | null = nameOf(argument);

        if (name) {
          multipliedNames.add(name);
        }
      }
    }

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      /*
       * A template's raw text keeps its line breaks as written ("\r\n",
       * "\n" ...), so a finding is reported on its own line; a quoted
       * string's text (escapes read) is reported where the string starts.
       */
      const rawText: string | undefined = ts.isStringLiteral(node)
        ? undefined
        : node.rawText;
      const isTemplate: boolean = rawText !== undefined;
      const raw: string = rawText ?? node.text;

      for (const { offset, finding } of findingsInText(raw)) {
        report(
          node,
          finding,
          isTemplate
            ? (raw.slice(0, offset).match(LINE_BREAK) || []).length
            : 0,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  // A multiplier held in a name: flagged where the name is given it, if the file multiplies by the name.
  for (const [name, places] of multiplierNames) {
    if (multipliedNames.has(name)) {
      for (const [node, finding] of places) {
        report(node, finding);
      }
    }
  }

  for (const [name, places] of incrementNames) {
    if (addedNames.has(name)) {
      for (const [node, finding] of places) {
        report(node, finding);
      }
    }
  }

  return found.sort(
    (a: HandRolledGenerator, b: HandRolledGenerator): number => {
      return a.line - b.line;
    },
  );
};

type ReportGeneratorsFunction = (
  files: Array<string>,
  root?: string,
) => Array<HandRolledGenerator>;

// The hand-rolled generators in test files, by their paths from the root.
export const reportHandRolledGenerators: ReportGeneratorsFunction = (
  files: Array<string>,
  root: string = REPOSITORY_DIRECTORY,
): Array<HandRolledGenerator> => {
  return files.flatMap((file: string): Array<HandRolledGenerator> => {
    return findHandRolledGenerators(
      file,
      fs.readFileSync(path.join(root, file), "utf8"),
    );
  });
};

type DescribeFunction = (generator: HandRolledGenerator) => string;

// One line of a failure: where, and what.
export const describeGenerator: DescribeFunction = (
  generator: HandRolledGenerator,
): string => {
  return `${generator.file}:${generator.line} rolls its own generator (${generator.finding}).`;
};
