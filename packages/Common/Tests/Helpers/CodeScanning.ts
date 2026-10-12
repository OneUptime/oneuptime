import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  CharacterClass,
  ClassRange,
  characterClassesOf,
} from "./RegExpCharacterClasses";
import { REPOSITORY_DIRECTORY, isTestCode } from "./TagStripScan";

/*
 * CODE READ THE WAY CODE SCANNING READS IT, FOR TWO OF ITS QUERIES.
 *
 * Code scanning (CodeQL) reads every file of the repository and reports,
 * among much else:
 *
 *   js/incomplete-sanitization - a replace that escapes or removes a
 *   character a sink reads as syntax, but not every one of them:
 *
 *     "This does not escape backslash characters in the input." A global
 *     replace that writes a backslash before what it matches ("\\$&",
 *     "\\$1", or "\\|" for a "|"), when a backslash the text holds of its own
 *     can still reach it: the replace does not match a backslash too, and
 *     nothing before it on the way (an earlier replace, JSON.stringify)
 *     escaped them. A "\" left in the text then escapes the escape.
 *
 *     "This replaces only the first occurrence of X." A replace of a
 *     character sinks read as syntax (' " \ & < > a tab or line break * | {
 *     } [ ] % $), a URL escape or a ".." that is not global - except in a
 *     loop that feeds the replace its own result, a pair of replaces that
 *     takes the delimiters off both ends of a text, and a single "\n", "%"
 *     or "$" taken out on its own.
 *
 *   js/overly-large-range - a range of a character class, in a pattern
 *   literal, that matches more than it seems to: ten or more characters
 *   across Z-a or 9-A, or ASCII with punctuation at an end (A-z, !-z);
 *   one that shares characters with another range of the class; one that
 *   shares them with the class's \d, \w or \s. A range written with an
 *   escape (\u3000-\u303F, \x23-\x5B) names its code points on purpose and
 *   is not reported, nor is a pattern built from a string.
 *
 * This reads a file's code as those queries do - IncompleteSanitization.ql
 * and the shared OverlyLargeRangeQuery.qll, with their exceptions - so a
 * guard fails where code scanning would open an alert, before it does: on
 * the pull request, not after the merge. Its reading of what flows where is
 * the local one those queries use - a value through its variable, a chain of
 * string methods, a conditional - and it resolves a pattern or a string held
 * in a constant, a variable or a class's field of the same file.
 *
 * Two more findings keep the fix in one place:
 *
 *   "own regular expression escape" - a replace of every character a pattern
 *   reads as syntax (\ ^ $ . * + ? ( ) [ ] { } |), or a function named for
 *   one (escapeRegex, escapeForRegExp, ...), anywhere but the shared
 *   escapeRegExp (Common/Utils/RegExpEscape). One escape, complete, for all
 *   of the code.
 *   "normalized character" - a pattern literal holding a character Unicode
 *   normalization (NFC) turns into another: a CJK compatibility ideograph
 *   meant to start a range became its canonical twin in the docs tests and
 *   moved the range into the middle of the Chinese characters (#2216).
 *
 * TypeScript, JavaScript and the code of EJS and HTML templates are read:
 * the template's own code (<% %>, <%= %>, <%- %>) as one program, and each
 * inline <script> on its own.
 */

export type CodeScanningRule =
  | "js/incomplete-sanitization"
  | "js/overly-large-range"
  | "own regular expression escape"
  | "normalized character";

export interface CodeScanningFinding {
  // The file's path as it was given.
  file: string;
  line: number;
  rule: CodeScanningRule;
  // What is wrong, worded as code scanning words it where it can be.
  message: string;
  // The code, its whitespace runs as one space, cut to 100 characters.
  code: string;
}

export interface CodeScanningOptions {
  /*
   * The file that may write a regular expression escape of its own, by the
   * same path the file is given as. Without it, copies are not looked for.
   */
  regExpEscapeFile?: string | undefined;
  /*
   * Whether a file can import the shared escape; a copy is reported only
   * where it can. Every file can when it is not given.
   */
  reachesSharedHelpers?: ((file: string) => boolean) | undefined;
}

// The one regular expression escape of the product code.
export const SHARED_REGEXP_ESCAPE_FILE: string =
  "packages/Common/Utils/RegExpEscape.ts";

// What each finding asks for instead.
export const CODE_SCANNING_FIXES: Readonly<Record<CodeScanningRule, string>> = {
  "js/incomplete-sanitization":
    "escape every character the sink reads as syntax, the backslash first and in the same pass (escapeRegExp for a pattern, markdownTableCell for a Markdown table cell, the query's parameter binding for SQL), replace every occurrence, or read the text with a walk instead of a replace",
  "js/overly-large-range":
    "list exactly the characters meant: a range within one block of letters or digits, a \\p{Script=...} class with the u flag, or code points written as escapes",
  "own regular expression escape":
    "escape text for a pattern with escapeRegExp from Common/Utils/RegExpEscape",
  "normalized character":
    "write the character as an escape (\\u{...}): Unicode normalization turns it into another character",
};

/*
 * ---------------------------------------------------------------------------
 * Patterns, read as CodeQL's regular expression library reads them.
 * ---------------------------------------------------------------------------
 */

/*
 * A pattern's terms, as far as the two queries look into them: what is
 * "simple" (a union of constants) and which strings a term can match.
 */
type RegExpTerm =
  // A run of plain characters, or one escaped character.
  | { kind: "constant"; value: string; plain: boolean }
  | { kind: "sequence"; elements: Array<RegExpTerm> }
  | { kind: "alternation"; alternatives: Array<RegExpTerm> }
  // A group, capturing or not (not a lookaround).
  | { kind: "group"; child: RegExpTerm }
  | { kind: "class"; negated: boolean; items: Array<RegExpTerm> }
  /*
   * A range of a class, a class escape (\d), an anchor, a dot, a quantified
   * term, a lookaround, a backreference: no constant of its own.
   */
  | { kind: "other" };

const OTHER: RegExpTerm = { kind: "other" };
const BACKSLASH: string = "\\";
const HEX_DIGITS: RegExp = /^[0-9A-Fa-f]+$/;
const CONTROL_ESCAPE_CHARACTERS: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  f: "\f",
  v: "\v",
  "0": "\0",
};
const QUANTIFIER_BRACE: RegExp = /^\{\d+(?:,\d*)?\}/;
// A template whose code is read: EJS and HTML.
const TEMPLATE_FILE: RegExp = /\.(?:ejs|html?)$/i;
const CONTROL_LETTER: RegExp = /^[A-Za-z]$/;

class PatternReader {
  private at: number = 0;

  public constructor(
    private readonly source: string,
    private readonly unicode: boolean,
  ) {}

  public read(): RegExpTerm {
    const term: RegExpTerm = this.readAlternation();

    return this.at >= this.source.length ? term : OTHER;
  }

  private peek(): string {
    return this.source.charAt(this.at);
  }

  private readAlternation(): RegExpTerm {
    const alternatives: Array<RegExpTerm> = [this.readSequence()];

    while (this.peek() === "|") {
      this.at++;
      alternatives.push(this.readSequence());
    }

    return alternatives.length === 1
      ? alternatives[0]!
      : { kind: "alternation", alternatives: alternatives };
  }

  private readSequence(): RegExpTerm {
    const elements: Array<RegExpTerm> = [];

    while (
      this.at < this.source.length &&
      this.peek() !== "|" &&
      this.peek() !== ")"
    ) {
      let term: RegExpTerm = this.readAtom();

      if (this.readQuantifier()) {
        term = OTHER;
      }

      // Plain characters next to each other are one constant, as in CodeQL.
      const last: RegExpTerm | undefined = elements[elements.length - 1];

      if (
        term.kind === "constant" &&
        term.plain &&
        last !== undefined &&
        last.kind === "constant" &&
        last.plain
      ) {
        elements[elements.length - 1] = {
          kind: "constant",
          value: last.value + term.value,
          plain: true,
        };
        continue;
      }

      elements.push(term);
    }

    return elements.length === 1
      ? elements[0]!
      : { kind: "sequence", elements: elements };
  }

  private readQuantifier(): boolean {
    const character: string = this.peek();
    let read: boolean = false;

    if (character === "*" || character === "+" || character === "?") {
      this.at++;
      read = true;
    } else if (character === "{") {
      const brace: RegExpMatchArray | null = this.source
        .slice(this.at)
        .match(QUANTIFIER_BRACE);

      if (brace) {
        this.at += brace[0].length;
        read = true;
      }
    }

    // A lazy quantifier: "*?".
    if (read && this.peek() === "?") {
      this.at++;
    }

    return read;
  }

  private readAtom(): RegExpTerm {
    const character: string = this.peek();
    this.at++;

    if (character === "(") {
      let lookaround: boolean = false;

      if (this.source.startsWith("?:", this.at)) {
        this.at += 2;
      } else if (
        this.source.startsWith("?=", this.at) ||
        this.source.startsWith("?!", this.at)
      ) {
        this.at += 2;
        lookaround = true;
      } else if (
        this.source.startsWith("?<=", this.at) ||
        this.source.startsWith("?<!", this.at)
      ) {
        this.at += 3;
        lookaround = true;
      } else if (this.source.startsWith("?<", this.at)) {
        const close: number = this.source.indexOf(">", this.at);
        this.at = close === -1 ? this.source.length : close + 1;
      }

      const child: RegExpTerm = this.readAlternation();

      if (this.peek() === ")") {
        this.at++;
      }

      return lookaround ? OTHER : { kind: "group", child: child };
    }

    if (character === "[") {
      return this.readClass();
    }

    if (character === "." || character === "^" || character === "$") {
      return OTHER;
    }

    if (character === BACKSLASH) {
      return this.readEscape(false);
    }

    return { kind: "constant", value: character, plain: true };
  }

  // The escape whose backslash was just read.
  private readEscape(inClass: boolean): RegExpTerm {
    const name: string = this.peek();
    this.at++;

    if ("dDwWsS".includes(name)) {
      return OTHER;
    }

    if (!inClass && (name === "b" || name === "B")) {
      return OTHER;
    }

    if (inClass && name === "b") {
      return { kind: "constant", value: "\b", plain: false };
    }

    if (!inClass && name >= "1" && name <= "9") {
      while (this.peek() >= "0" && this.peek() <= "9") {
        this.at++;
      }

      return OTHER;
    }

    if (!inClass && name === "k" && this.peek() === "<") {
      const close: number = this.source.indexOf(">", this.at);
      this.at = close === -1 ? this.source.length : close + 1;
      return OTHER;
    }

    if ((name === "p" || name === "P") && this.unicode && this.peek() === "{") {
      const close: number = this.source.indexOf("}", this.at);
      this.at = close === -1 ? this.source.length : close + 1;
      return OTHER;
    }

    if (CONTROL_ESCAPE_CHARACTERS[name] !== undefined) {
      return {
        kind: "constant",
        value: CONTROL_ESCAPE_CHARACTERS[name]!,
        plain: false,
      };
    }

    if (name === "x") {
      const digits: string = this.source.slice(this.at, this.at + 2);

      if (digits.length === 2 && HEX_DIGITS.test(digits)) {
        this.at += 2;
        return {
          kind: "constant",
          value: String.fromCharCode(parseInt(digits, 16)),
          plain: false,
        };
      }
    }

    if (name === "u") {
      if (this.peek() === "{" && this.unicode) {
        const close: number = this.source.indexOf("}", this.at);
        const digits: string = this.source.slice(this.at + 1, close);

        if (close !== -1 && HEX_DIGITS.test(digits)) {
          this.at = close + 1;
          return {
            kind: "constant",
            value: String.fromCodePoint(parseInt(digits, 16)),
            plain: false,
          };
        }
      }

      const digits: string = this.source.slice(this.at, this.at + 4);

      if (digits.length === 4 && HEX_DIGITS.test(digits)) {
        this.at += 4;
        return {
          kind: "constant",
          value: String.fromCharCode(parseInt(digits, 16)),
          plain: false,
        };
      }
    }

    if (name === "c") {
      const letter: string = this.peek();

      if (CONTROL_LETTER.test(letter)) {
        this.at++;
        return {
          kind: "constant",
          value: String.fromCharCode(letter.charCodeAt(0) % 32),
          plain: false,
        };
      }
    }

    // Any other escaped character is that character.
    return { kind: "constant", value: name, plain: false };
  }

  // The class whose "[" was just read.
  private readClass(): RegExpTerm {
    const items: Array<RegExpTerm> = [];
    let negated: boolean = false;

    if (this.peek() === "^") {
      negated = true;
      this.at++;
    }

    while (this.at < this.source.length && this.peek() !== "]") {
      const character: string = this.peek();
      this.at++;

      let item: RegExpTerm =
        character === BACKSLASH
          ? this.readEscape(true)
          : { kind: "constant", value: character, plain: false };

      // "a-b": a range, unless the "-" is the class's last character.
      if (
        item.kind === "constant" &&
        this.peek() === "-" &&
        this.at + 1 < this.source.length &&
        this.source.charAt(this.at + 1) !== "]"
      ) {
        this.at++;
        const end: string = this.peek();
        this.at++;

        const second: RegExpTerm =
          end === BACKSLASH
            ? this.readEscape(true)
            : { kind: "constant", value: end, plain: false };

        if (second.kind === "constant") {
          item = OTHER;
        } else {
          items.push(item, { kind: "constant", value: "-", plain: false });
          item = second;
        }
      }

      items.push(item);
    }

    if (this.peek() === "]") {
      this.at++;
    }

    return { kind: "class", negated: negated, items: items };
  }
}

// The terms of a pattern, or OTHER when they cannot be read.
function patternTerm(source: string, flags: string): RegExpTerm {
  if (flags.includes("v")) {
    return OTHER;
  }

  return new PatternReader(source, flags.includes("u")).read();
}

// A union of constants (CodeQL's isSimple).
function isSimple(term: RegExpTerm): boolean {
  switch (term.kind) {
    case "constant":
      return true;
    case "group":
      return isSimple(term.child);
    case "class":
      return (
        !term.negated &&
        term.items.every((item: RegExpTerm): boolean => {
          return item.kind === "constant";
        })
      );
    case "alternation":
      return term.alternatives.every(isSimple);
    default:
      return false;
  }
}

// The one string a term matches, when it is a constant run.
function constantValueOf(term: RegExpTerm): string | undefined {
  if (term.kind === "constant") {
    return term.value;
  }

  if (term.kind === "group") {
    return constantValueOf(term.child);
  }

  if (term.kind === "sequence") {
    let value: string = "";

    for (const element of term.elements) {
      const elementValue: string | undefined = constantValueOf(element);

      if (elementValue === undefined) {
        return undefined;
      }

      value += elementValue;
    }

    return value;
  }

  return undefined;
}

// The strings a term matches, as CodeQL's getAMatchedString lists them.
function matchedStringsOf(term: RegExpTerm): Array<string> {
  if (term.kind === "alternation") {
    return term.alternatives.flatMap(matchedStringsOf);
  }

  if (term.kind === "class") {
    return term.negated ? [] : term.items.flatMap(matchedStringsOf);
  }

  if (term.kind === "group") {
    return matchedStringsOf(term.child);
  }

  const value: string | undefined = constantValueOf(term);

  return value === undefined ? [] : [value];
}

/*
 * ---------------------------------------------------------------------------
 * Values, followed through the code the way the queries follow them.
 * ---------------------------------------------------------------------------
 */

interface PatternValue {
  // The pattern's terms; OTHER when its source is not a constant.
  term: RegExpTerm;
  // Its flags; "?" when they are not a constant.
  flags: string;
  // Its source, when that is a constant.
  source: string | null;
}

const STRING_METHODS_KEEPING_ESCAPES: ReadonlyArray<string> = [
  "replace",
  "replaceAll",
  "slice",
  "substr",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "trim",
];

// The characters the first-occurrence rule takes a replace to sanitize.
const META_CHARACTERS: string = "'\"\\&<>\n\r\t*|{}[]%$";
const URL_ESCAPES: RegExp = /^(?:%[0-9A-Fa-f]{2})+$/;
const PATH_STEPS: ReadonlyArray<string> = ["..", "/..", "../", "/../"];
const LONE_REMOVALS: ReadonlyArray<string> = ["\n", "%", "$"];
const DELIMITER_PAIRS: ReadonlyArray<[string, string]> = [
  ["[", "]"],
  ["{", "}"],
  ["(", ")"],
  ['"', '"'],
  ["'", "'"],
];
// "\$&" or "\$1": a backslash, then what the pattern matched.
const BACKSLASH_SUBSTITUTION: RegExp = /^\\\$(?:&|\d)$/;
// Every character a pattern reads as syntax outside a class.
const REGEXP_SYNTAX_CHARACTERS: string = "\\^$.*+?()[]{}|";
// What a copy of the shared escape is called.
const REGEXP_ESCAPE_HELPER_NAME: RegExp = /^escape\w*reg(?:exp|ex)$/i;
const WHITESPACE_RUN: RegExp = /\s+/g;

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }

    return current;
  }
}

function isScopeNode(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isFunctionLike(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isCatchClause(node) ||
    ts.isClassLike(node)
  );
}

// The declaration of `name` that `scope` makes itself, if it makes one.
function declarationIn(
  scope: ts.Node,
  name: string,
): ts.VariableDeclaration | ts.ParameterDeclaration | null {
  let found: ts.VariableDeclaration | ts.ParameterDeclaration | null = null;

  const consider: (declaration: ts.VariableDeclaration) => void = (
    declaration: ts.VariableDeclaration,
  ): void => {
    if (
      found === null &&
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === name
    ) {
      found = declaration;
    }
  };

  if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) {
      if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
        return parameter;
      }
    }

    return null;
  }

  if (
    (ts.isForStatement(scope) ||
      ts.isForOfStatement(scope) ||
      ts.isForInStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    scope.initializer.declarations.forEach(consider);
    return found;
  }

  if (ts.isCatchClause(scope)) {
    if (
      scope.variableDeclaration &&
      ts.isIdentifier(scope.variableDeclaration.name) &&
      scope.variableDeclaration.name.text === name
    ) {
      return scope.variableDeclaration;
    }

    return null;
  }

  const statements: ReadonlyArray<ts.Statement> =
    ts.isSourceFile(scope) ||
    ts.isBlock(scope) ||
    ts.isModuleBlock(scope) ||
    ts.isCaseClause(scope) ||
    ts.isDefaultClause(scope)
      ? scope.statements
      : [];

  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach(consider);
    }
  }

  return found;
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

// What valuesOfIdentifier found for a declaration, read once per file.
const valuesOfDeclaration: WeakMap<ts.Node, Array<ts.Expression>> = new WeakMap<
  ts.Node,
  Array<ts.Expression>
>();

/*
 * The values a variable can hold where it is used: its initializer and
 * every assignment to it in the scope that declares it. A parameter, an
 * import or a name declared elsewhere holds none that can be read here.
 */
function valuesOfIdentifier(identifier: ts.Identifier): Array<ts.Expression> {
  for (
    let scope: ts.Node | undefined = identifier.parent;
    scope !== undefined;
    scope = scope.parent
  ) {
    if (!isScopeNode(scope)) {
      continue;
    }

    const declaration: ts.VariableDeclaration | ts.ParameterDeclaration | null =
      declarationIn(scope, identifier.text);

    if (declaration === null) {
      continue;
    }

    if (ts.isParameter(declaration)) {
      return [];
    }

    const known: Array<ts.Expression> | undefined =
      valuesOfDeclaration.get(declaration);

    if (known !== undefined) {
      return known;
    }

    const values: Array<ts.Expression> = declaration.initializer
      ? [declaration.initializer]
      : [];

    visit(scope, (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === identifier.text
      ) {
        values.push(node.right);
      }
    });

    valuesOfDeclaration.set(declaration, values);

    return values;
  }

  return [];
}

// The initializers of a class field named `name` in the file.
function valuesOfField(
  source: ts.SourceFile,
  name: string,
): Array<ts.Expression> {
  const values: Array<ts.Expression> = [];

  visit(source, (node: ts.Node) => {
    if (
      ts.isPropertyDeclaration(node) &&
      node.initializer &&
      (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) &&
      node.name.text === name
    ) {
      values.push(node.initializer);
    }
  });

  return values;
}

/*
 * The expressions a value can come from, one step back: through a
 * variable, a class field, a conditional, or "||" and "??".
 */
function sourcesOf(node: ts.Expression): Array<ts.Expression> {
  const value: ts.Expression = unwrapExpression(node);

  if (ts.isIdentifier(value)) {
    return valuesOfIdentifier(value);
  }

  if (
    ts.isPropertyAccessExpression(value) &&
    (value.expression.kind === ts.SyntaxKind.ThisKeyword ||
      ts.isIdentifier(value.expression))
  ) {
    return valuesOfField(value.getSourceFile(), value.name.text);
  }

  if (ts.isConditionalExpression(value)) {
    return [value.whenTrue, value.whenFalse];
  }

  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [value.left, value.right];
  }

  return [];
}

// Every expression a value can come from, itself first.
function originsOf(node: ts.Expression): Array<ts.Expression> {
  const origins: Array<ts.Expression> = [];
  const seen: Set<ts.Node> = new Set<ts.Node>();
  const waiting: Array<ts.Expression> = [node];

  while (waiting.length > 0) {
    const value: ts.Expression = unwrapExpression(waiting.pop()!);

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    origins.push(value);
    waiting.push(...sourcesOf(value));
  }

  return origins;
}

// The patterns a replace's first argument can be.
function patternsOf(node: ts.Expression): Array<PatternValue> {
  const patterns: Array<PatternValue> = [];

  for (const origin of originsOf(node)) {
    if (ts.isRegularExpressionLiteral(origin)) {
      const lastSlash: number = origin.text.lastIndexOf("/");
      const source: string = origin.text.slice(1, lastSlash);
      const flags: string = origin.text.slice(lastSlash + 1);

      patterns.push({
        term: patternTerm(source, flags),
        flags: flags,
        source: source,
      });
      continue;
    }

    if (
      (ts.isNewExpression(origin) || ts.isCallExpression(origin)) &&
      ts.isIdentifier(origin.expression) &&
      origin.expression.text === "RegExp"
    ) {
      const argumentsGiven: ReadonlyArray<ts.Expression> =
        origin.arguments || [];
      const sourceStrings: Array<string> =
        argumentsGiven[0] !== undefined
          ? stringValuesOf(argumentsGiven[0])
          : [];
      const flagStrings: Array<string> =
        argumentsGiven[1] === undefined
          ? [""]
          : stringValuesOf(argumentsGiven[1]);
      const flags: string = flagStrings.length === 1 ? flagStrings[0]! : "?";
      const source: string | null =
        sourceStrings.length === 1 ? sourceStrings[0]! : null;

      patterns.push({
        term: source === null ? OTHER : patternTerm(source, flags),
        flags: flags,
        source: source,
      });
    }
  }

  return patterns;
}

// The constant strings a value can be.
function stringValuesOf(node: ts.Expression): Array<string> {
  const values: Array<string> = [];

  for (const origin of originsOf(node)) {
    if (
      ts.isStringLiteral(origin) ||
      ts.isNoSubstitutionTemplateLiteral(origin)
    ) {
      values.push(origin.text);
    }
  }

  return values;
}

interface ReplaceCall {
  call: ts.CallExpression;
  method: string;
  receiver: ts.Expression;
  patterns: Array<PatternValue>;
  // The first argument's constant strings, when it is no pattern.
  replacedStrings: Array<string>;
  replacements: Array<string>;
}

function replaceCallOf(node: ts.Node): ReplaceCall | null {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.arguments.length !== 2
  ) {
    return null;
  }

  const method: string = node.expression.name.text;

  if (method !== "replace" && method !== "replaceAll") {
    return null;
  }

  const patterns: Array<PatternValue> = patternsOf(node.arguments[0]!);

  return {
    call: node,
    method: method,
    receiver: node.expression.expression,
    patterns: patterns,
    replacedStrings:
      patterns.length > 0 ? [] : stringValuesOf(node.arguments[0]!),
    replacements: stringValuesOf(node.arguments[1]!),
  };
}

function maybeGlobal(replace: ReplaceCall): boolean {
  return (
    replace.method === "replaceAll" ||
    replace.patterns.some((pattern: PatternValue): boolean => {
      return pattern.flags === "?" || pattern.flags.includes("g");
    })
  );
}

function isGlobal(replace: ReplaceCall): boolean {
  return (
    replace.method === "replaceAll" ||
    replace.patterns.some((pattern: PatternValue): boolean => {
      return pattern.flags.includes("g");
    })
  );
}

// The strings a replace replaces (CodeQL's getAReplacedString).
function replacedStringsOf(replace: ReplaceCall): Array<string> {
  return [
    ...replace.patterns.flatMap((pattern: PatternValue): Array<string> => {
      return matchedStringsOf(pattern.term);
    }),
    ...replace.replacedStrings,
  ];
}

// Whether the replace writes a backslash before what it matches.
function backslashEscapePatterns(replace: ReplaceCall): Array<PatternValue> {
  if (!maybeGlobal(replace) || replace.patterns.length === 0) {
    return [];
  }

  const replaced: Array<string> = replacedStringsOf(replace);

  const escapes: boolean = replace.replacements.some(
    (replacement: string): boolean => {
      return (
        BACKSLASH_SUBSTITUTION.test(replacement) ||
        replaced.some((old: string): boolean => {
          return replacement.split("$&").join(old) === BACKSLASH + old;
        })
      );
    },
  );

  return escapes ? replace.patterns : [];
}

// Whether no backslash of its own can come out of a value unescaped.
function escapesEveryBackslash(
  node: ts.Expression,
  seen: Set<ts.Node> = new Set<ts.Node>(),
): boolean {
  for (const origin of originsOf(node)) {
    if (seen.has(origin)) {
      continue;
    }

    seen.add(origin);

    if (!ts.isCallExpression(origin)) {
      continue;
    }

    if (
      ts.isPropertyAccessExpression(origin.expression) &&
      ts.isIdentifier(origin.expression.expression) &&
      origin.expression.expression.text === "JSON" &&
      origin.expression.name.text === "stringify"
    ) {
      return true;
    }

    const replace: ReplaceCall | null = replaceCallOf(origin);

    if (
      replace !== null &&
      backslashEscapePatterns(replace).some(
        (pattern: PatternValue): boolean => {
          return (
            !isSimple(pattern.term) ||
            matchedStringsOf(pattern.term).includes(BACKSLASH)
          );
        },
      )
    ) {
      return true;
    }

    if (
      ts.isPropertyAccessExpression(origin.expression) &&
      STRING_METHODS_KEEPING_ESCAPES.includes(origin.expression.name.text) &&
      escapesEveryBackslash(origin.expression.expression, seen)
    ) {
      return true;
    }
  }

  return false;
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

// A replace in a loop whose result is its next round's text.
function feedsItsOwnText(replace: ReplaceCall): boolean {
  const receiver: ts.Expression = unwrapExpression(replace.receiver);
  let assignment: ts.Node = replace.call.parent;

  while (ts.isParenthesizedExpression(assignment)) {
    assignment = assignment.parent;
  }

  return (
    ts.isIdentifier(receiver) &&
    ts.isBinaryExpression(assignment) &&
    assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(assignment.left) &&
    assignment.left.text === receiver.text &&
    isInLoop(replace.call)
  );
}

// A replace of a string (no pattern) with nothing: CodeQL's removesFirstOccurrence.
function removesFirstOccurrence(node: ts.Node | null, text: string): boolean {
  const replace: ReplaceCall | null = node ? replaceCallOf(node) : null;

  return (
    replace !== null &&
    replace.patterns.length === 0 &&
    replace.replacedStrings.includes(text) &&
    replace.replacements.includes("")
  );
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

function checkFirstOccurrence(replace: ReplaceCall): string | null {
  if (replace.method !== "replace" || maybeGlobal(replace)) {
    return null;
  }

  const replaced: Array<string> = replacedStringsOf(replace);
  const sanitizing: Array<string> = replaced.filter((text: string): boolean => {
    return (
      (text.length === 1 && META_CHARACTERS.includes(text)) ||
      URL_ESCAPES.test(text) ||
      PATH_STEPS.includes(text) ||
      replace.replacements.some((replacement: string): boolean => {
        return URL_ESCAPES.test(replacement);
      })
    );
  });

  if (sanitizing.length === 0 || feedsItsOwnText(replace)) {
    return null;
  }

  const before: ts.Expression = unwrapExpression(replace.receiver);
  const after: ts.CallExpression | null = callOnResultOf(replace.call);
  const unwraps: boolean = DELIMITER_PAIRS.some(
    ([left, right]: [string, string]): boolean => {
      return (
        (removesFirstOccurrence(replace.call, left) &&
          removesFirstOccurrence(after, right)) ||
        (removesFirstOccurrence(replace.call, right) &&
          removesFirstOccurrence(before, left))
      );
    },
  );

  const chained: boolean = [before, after].some(
    (other: ts.Node | null): boolean => {
      return other !== null && replaceCallOf(other) !== null;
    },
  );
  const loneRemoval: boolean =
    !isGlobal(replace) &&
    replace.replacements.includes("") &&
    replaced.some((text: string): boolean => {
      return LONE_REMOVALS.includes(text);
    }) &&
    !chained;

  if (unwraps || loneRemoval) {
    return null;
  }

  return `This replaces only the first occurrence of ${JSON.stringify(sanitizing[0])}.`;
}

/*
 * ---------------------------------------------------------------------------
 * Ranges, as OverlyLargeRangeQuery.qll reads them.
 * ---------------------------------------------------------------------------
 */

function isAlphanumeric(value: number): boolean {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x5a) ||
    (value >= 0x61 && value <= 0x7a)
  );
}

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

// What \d, \w and \s match in the query, which reads them as Java does.
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
  ],
};

function hex(value: number): string {
  return `U+${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

// A range written with an escape at either end, which the query leaves out.
function isWrittenWithEscape(range: ClassRange): boolean {
  return range.text.includes(BACKSLASH);
}

function rangeProblems(characterClass: CharacterClass): Array<string> {
  const problems: Array<string> = [];
  const ranges: Array<ClassRange> = characterClass.ranges;

  ranges.forEach((range: ClassRange, index: number) => {
    if (isWrittenWithEscape(range)) {
      return;
    }

    if (isOverlyWide(range)) {
      problems.push(
        `Suspicious character range ${range.text}: it spans ${range.high - range.low + 1} characters, from ${hex(range.low)} to ${hex(range.high)}, across letters, digits and punctuation.`,
      );
    }

    ranges.forEach((other: ClassRange, otherIndex: number) => {
      const larger: boolean =
        range.high - range.low > other.high - other.low ||
        (range.high - range.low === other.high - other.low &&
          index < otherIndex);

      if (
        otherIndex !== index &&
        larger &&
        range.low <= other.high &&
        other.low <= range.high
      ) {
        problems.push(
          `Suspicious character range ${range.text} that overlaps with ${other.text} in the same character class.`,
        );
      }
    });

    for (const name of characterClass.classEscapes) {
      const runs: Array<[number, number]> | undefined = CLASS_ESCAPE_RUNS[name];

      if (
        runs !== undefined &&
        runs.some(([low, high]: [number, number]): boolean => {
          return range.low <= high && low <= range.high;
        })
      ) {
        problems.push(
          `Suspicious character range ${range.text} that overlaps with \\${name} in the same character class.`,
        );
      }
    }
  });

  return problems;
}

/*
 * ---------------------------------------------------------------------------
 * Templates: the code of EJS and HTML files.
 * ---------------------------------------------------------------------------
 */

export interface TemplateScript {
  // The code, at the same lines as in the template; the rest is spaces.
  code: string;
  // What it is: the template's own code, or an inline script.
  kind: "template code" | "inline script";
}

// Every character but a line break as a space, so lines stay where they are.
function blank(text: string): string {
  let blanked: string = "";

  for (const character of text) {
    blanked += character === "\n" ? "\n" : " ";
  }

  return blanked;
}

const SCRIPT_START: RegExp = /<script\b([^>]*)>/gi;
const SCRIPT_END: RegExp = /<\/script\s*>/i;
const SCRIPT_TYPE: RegExp = /\btype\s*=\s*["']?([^"'\s>]+)/i;
const JAVASCRIPT_TYPES: ReadonlyArray<string> = [
  "text/javascript",
  "application/javascript",
  "module",
];

/*
 * The template's own code as one program - each <% %> as it is, each <%= %>
 * and <%- %> as an expression statement - and the text between as spaces,
 * as EJS itself compiles it. Comments (<%# %>) and "<%%" are not code.
 */
function templateCode(text: string): string {
  let code: string = "";
  let at: number = 0;

  while (at < text.length) {
    const open: number = text.indexOf("<%", at);

    if (open === -1) {
      code += blank(text.slice(at));
      break;
    }

    code += blank(text.slice(at, open));

    if (text.startsWith("<%%", open)) {
      code += blank("<%%");
      at = open + 3;
      continue;
    }

    const close: number = text.indexOf("%>", open + 2);

    if (close === -1) {
      code += blank(text.slice(open));
      break;
    }

    const marker: string = text.charAt(open + 2);
    const innerStart: number = "=-#_".includes(marker) ? open + 3 : open + 2;
    const innerEnd: number =
      close - 1 >= innerStart && "-_".includes(text.charAt(close - 1))
        ? close - 1
        : close;
    const inner: string = text.slice(innerStart, innerEnd);
    const tag: string = text.slice(open, close + 2);

    // The delimiters hold no line break: every line stays where it was.
    if (marker === "#") {
      code += blank(tag);
    } else if (marker === "=" || marker === "-") {
      code += `;(${inner});`;
    } else {
      code += `${inner};`;
    }

    at = close + 2;
  }

  return code;
}

// Each inline script of a template, its EJS tags blanked out.
function inlineScripts(text: string): Array<string> {
  const scripts: Array<string> = [];

  for (const start of text.matchAll(SCRIPT_START)) {
    const type: RegExpMatchArray | null = (start[1] || "").match(SCRIPT_TYPE);

    if (type && !JAVASCRIPT_TYPES.includes((type[1] || "").toLowerCase())) {
      continue;
    }

    const bodyStart: number = start.index! + start[0].length;
    const end: RegExpMatchArray | null = text
      .slice(bodyStart)
      .match(SCRIPT_END);
    const bodyEnd: number =
      end && end.index !== undefined ? bodyStart + end.index : text.length;
    let body: string = text.slice(bodyStart, bodyEnd);

    // EJS inside the script is not its code.
    let tagStart: number = body.indexOf("<%");

    while (tagStart !== -1) {
      const tagEnd: number = body.indexOf("%>", tagStart + 2);
      const stop: number = tagEnd === -1 ? body.length : tagEnd + 2;
      body =
        body.slice(0, tagStart) +
        blank(body.slice(tagStart, stop)) +
        body.slice(stop);
      tagStart = body.indexOf("<%", stop);
    }

    scripts.push(blank(text.slice(0, bodyStart)) + body);
  }

  return scripts;
}

export type TemplateScriptsFunction = (text: string) => Array<TemplateScript>;

// The code of an EJS or HTML template, as code scanning extracts it.
export const templateScripts: TemplateScriptsFunction = (
  text: string,
): Array<TemplateScript> => {
  return [
    { code: templateCode(text), kind: "template code" as const },
    ...inlineScripts(text).map((code: string): TemplateScript => {
      return { code: code, kind: "inline script" };
    }),
  ];
};

/*
 * ---------------------------------------------------------------------------
 * The checks.
 * ---------------------------------------------------------------------------
 */

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".mjs") ||
    fileName.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function scanProgram(
  file: string,
  code: string,
  kind: ts.ScriptKind,
  options: CodeScanningOptions,
  findings: Array<CodeScanningFinding>,
): void {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  /*
   * A copy of the shared escape is reported where the shared one can be
   * imported, and not in the shared one itself.
   */
  const checkOwnEscapes: boolean =
    options.regExpEscapeFile !== undefined &&
    file !== options.regExpEscapeFile &&
    (options.reachesSharedHelpers === undefined ||
      options.reachesSharedHelpers(file));

  /*
   * A finding on `node`, at the line it starts on - for a replace, where its
   * callee and so the chain of calls before it starts, as code scanning
   * reports it.
   */
  const found: (
    node: ts.Node,
    rule: CodeScanningRule,
    message: string,
  ) => void = (
    node: ts.Node,
    rule: CodeScanningRule,
    message: string,
  ): void => {
    findings.push({
      file: file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule: rule,
      message: message,
      code: node
        .getText(source)
        .replace(WHITESPACE_RUN, " ")
        .trim()
        .slice(0, 100),
    });
  };

  visit(source, (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node)) {
      const lastSlash: number = node.text.lastIndexOf("/");
      const patternSource: string = node.text.slice(1, lastSlash);
      const flags: string = node.text.slice(lastSlash + 1);
      const normalized: Array<string> = Array.from(node.text).filter(
        (character: string): boolean => {
          return character.normalize("NFC") !== character;
        },
      );

      if (normalized.length > 0 || node.text.normalize("NFC") !== node.text) {
        found(
          node,
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
                .join(", ")}.`
            : "NFC joins characters of the pattern into one.",
        );
      }

      for (const characterClass of characterClassesOf(patternSource, flags)) {
        for (const problem of rangeProblems(characterClass)) {
          found(node, "js/overly-large-range", problem);
        }
      }

      return;
    }

    const replace: ReplaceCall | null = replaceCallOf(node);

    if (replace !== null) {
      const ownEscape: boolean = replace.patterns.some(
        (pattern: PatternValue): boolean => {
          const term: RegExpTerm = pattern.term;

          return (
            term.kind === "class" &&
            !term.negated &&
            Array.from(REGEXP_SYNTAX_CHARACTERS).every(
              (character: string): boolean => {
                return matchedStringsOf(term).includes(character);
              },
            )
          );
        },
      );

      if (ownEscape && checkOwnEscapes) {
        found(
          node,
          "own regular expression escape",
          "This escapes text for a pattern with a copy of escapeRegExp.",
        );
      }

      if (
        backslashEscapePatterns(replace).length > 0 &&
        !escapesEveryBackslash(replace.call)
      ) {
        found(
          node,
          "js/incomplete-sanitization",
          "This does not escape backslash characters in the input.",
        );
      }

      const firstOccurrence: string | null = checkFirstOccurrence(replace);

      if (firstOccurrence !== null) {
        found(node, "js/incomplete-sanitization", firstOccurrence);
      }

      return;
    }

    let declaredName: ts.Node | undefined = undefined;

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      declaredName = node.name;
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      declaredName = node.name;
    }

    if (
      declaredName !== undefined &&
      ts.isIdentifier(declaredName) &&
      REGEXP_ESCAPE_HELPER_NAME.test(declaredName.text) &&
      checkOwnEscapes
    ) {
      found(
        node,
        "own regular expression escape",
        `${declaredName.text} is a copy of escapeRegExp.`,
      );
    }
  });
}

/*
 * ---------------------------------------------------------------------------
 * Product code: what the product guard reads.
 * ---------------------------------------------------------------------------
 */

/*
 * The packages that build with Common, so can import its helpers: the
 * agents, the mobile app and the scripts build on their own.
 */
export const PACKAGES_WITH_COMMON: ReadonlyArray<string> = [
  "packages/App/",
  "packages/CLI/",
  "packages/Common/",
  "packages/Home/",
  "packages/Nginx/",
  "packages/Probe/",
  "packages/Runner/",
  "packages/TestServer/",
  "ee/",
];

export type ReachesCommonFunction = (file: string) => boolean;

// Whether a product file, by its path from the root, can import Common.
export const reachesCommon: ReachesCommonFunction = (file: string): boolean => {
  return PACKAGES_WITH_COMMON.some((prefix: string): boolean => {
    return file.startsWith(prefix);
  });
};

// The top folders of the repository that hold code.
export const CODE_ROOTS: ReadonlyArray<string> = [
  "packages",
  "ee",
  "Scripts",
  "agents",
  "Examples",
  "HelmChart",
];

const PRODUCT_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs|ejs|html?)$/i;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;
const MINIFIED_FILE: RegExp = /\.min\.js$/;
// Folders of dependencies and builds, and third-party code checked in as is.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Vendor",
]);

export type IsProductCodeFunction = (relativePath: string) => boolean;

/*
 * Whether a file, by its path from the repository's root, is product code:
 * code or a template, not a test (TagStripScan's isTestCode says which
 * files are; a template is read by the same folders), not a build, and not
 * a vendored build checked in as it was published - Common/Server/Static/
 * Vendor (Tailwind, highlight.js) and any minified file. Whether code
 * scanning reads vendored builds is a choice for its configuration, not an
 * edit to the vendored code.
 */
export const isProductCode: IsProductCodeFunction = (
  relativePath: string,
): boolean => {
  const parts: Array<string> = relativePath.split("/");
  const fileName: string = parts[parts.length - 1]!;

  if (
    !PRODUCT_FILE.test(fileName) ||
    DECLARATION_FILE.test(fileName) ||
    MINIFIED_FILE.test(fileName) ||
    parts.slice(0, -1).some((folder: string): boolean => {
      return folder.startsWith(".") || SKIPPED_FOLDERS.has(folder);
    })
  ) {
    return false;
  }

  // A template is test code where a script would be.
  return !isTestCode(
    TEMPLATE_FILE.test(fileName) ? `${relativePath}.ts` : relativePath,
  );
};

export type ListProductFilesFunction = (
  root?: string,
  codeRoots?: ReadonlyArray<string>,
) => Array<string>;

/*
 * Every product code file under `root` (the repository's) in its code
 * folders (CODE_ROOTS, or the ones given), by its path from `root`.
 */
export const listProductFiles: ListProductFilesFunction = (
  root: string = REPOSITORY_DIRECTORY,
  codeRoots: ReadonlyArray<string> = CODE_ROOTS,
): Array<string> => {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name)) {
        continue;
      }

      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const relativePath: string = path
        .relative(root, fullPath)
        .split(path.sep)
        .join("/");

      if (entry.isFile() && isProductCode(relativePath)) {
        files.push(relativePath);
      }
    }
  };

  for (const codeRoot of codeRoots) {
    const directory: string = path.join(root, codeRoot);

    if (fs.existsSync(directory)) {
      walk(directory);
    }
  }

  return files.sort();
};

export type FindCodeScanningProblemsFunction = (
  file: string,
  text: string,
  options?: CodeScanningOptions,
) => Array<CodeScanningFinding>;

/*
 * What a file holds that the two queries report, or that keeps a fix out of
 * the shared helpers. `file` is its path as findings name it, `text` its
 * source; a template (.ejs, .html) is read for its code.
 */
export const findCodeScanningProblems: FindCodeScanningProblemsFunction = (
  file: string,
  text: string,
  options: CodeScanningOptions = {},
): Array<CodeScanningFinding> => {
  const findings: Array<CodeScanningFinding> = [];

  if (TEMPLATE_FILE.test(file)) {
    for (const script of templateScripts(text)) {
      scanProgram(file, script.code, ts.ScriptKind.JS, options, findings);
    }
  } else {
    scanProgram(file, text, scriptKindOf(file), options, findings);
  }

  return findings.sort(
    (left: CodeScanningFinding, right: CodeScanningFinding): number => {
      return left.line - right.line;
    },
  );
};
