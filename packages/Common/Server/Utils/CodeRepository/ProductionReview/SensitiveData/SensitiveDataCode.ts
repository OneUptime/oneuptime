import {
  isAsciiLetterCode,
  isDigitCode,
  isWhiteSpaceCode,
} from "../../../../../Utils/RegExpCharacterClasses";

/*
 * CODE, READ AS FAR AS THE SENSITIVE DATA RULES NEED IT.
 *
 * The telemetry rules read what a log call, a span's attribute, a metric's
 * label or a prompt is handed: the names it is handed, the keys they go in
 * under, and the strings they are written into. This is a tokenizer for
 * that, the same for every language a service is written in - names and
 * their member chains (`user.email`, `$user->email`, `Rails::logger`),
 * strings with what they interpolate (`${email}`, f"{email}", "#{email}",
 * "\(email)"), brackets, and the punctuation keys and values are written
 * with - and nothing more: it parses no grammar, so it cannot be wrong
 * about one.
 *
 * It reads text a pull request's author wrote: one pass, character by
 * character, never a pattern, and held to MAX_TOKENS tokens.
 *
 * Pure: no IO.
 */

export enum CodeTokenKind {
  // A name and its member chain, its parts joined by ".": user.email.
  Name = "Name",
  String = "String",
  Number = "Number",
  Punct = "Punct",
}

export interface CodeToken {
  kind: CodeTokenKind;
  /*
   * A name's chain ("user.email", "$" and "@" left off), a string's text
   * without its quotes, a number, or the punctuation ("(", "=>", "...").
   */
  text: string;
  // Which of the lines it starts on, and where on it.
  line: number;
  column: number;
  /*
   * A string's interpolated expressions, each as tokens: `${email}`,
   * f"{email}", "#{email}". Empty for a string that interpolates nothing.
   */
  parts: Array<Array<CodeToken>>;
}

// How a language writes what a string interpolates.
export interface CodeLanguage {
  // Line comments: "//" and "#".
  slashComments: boolean;
  hashComments: boolean;
  // `...${expr}...`: JavaScript and TypeScript.
  templateLiterals: boolean;
  // "${expr}" and "$name" in a double-quoted string: Kotlin, Groovy, Dart, PHP, Scala.
  dollarInStrings: boolean;
  // "#{expr}": Ruby, Elixir, CoffeeScript.
  hashBraceInStrings: boolean;
  // f"{expr}" (Python) and $"{expr}" (C#): braces after a prefix.
  prefixedBraceStrings: boolean;
  // "\(expr)": Swift.
  backslashParenInStrings: boolean;
  // "{name}" in any string: Rust's format arguments.
  bareBraceInStrings: boolean;
  // A variable's "$": PHP, Perl.
  dollarNames: boolean;
}

const BASE: CodeLanguage = {
  slashComments: true,
  hashComments: false,
  templateLiterals: false,
  dollarInStrings: false,
  hashBraceInStrings: false,
  prefixedBraceStrings: false,
  backslashParenInStrings: false,
  bareBraceInStrings: false,
  dollarNames: false,
};

// How each extension's language writes strings and comments.
export function getCodeLanguage(extension: string): CodeLanguage {
  switch (extension) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "vue":
    case "svelte":
      return { ...BASE, templateLiterals: true };
    case "py":
      return {
        ...BASE,
        slashComments: false,
        hashComments: true,
        prefixedBraceStrings: true,
      };
    case "rb":
    case "ex":
    case "exs":
      return {
        ...BASE,
        slashComments: false,
        hashComments: true,
        hashBraceInStrings: true,
      };
    case "php":
      return {
        ...BASE,
        hashComments: true,
        dollarInStrings: true,
        dollarNames: true,
      };
    case "pl":
    case "pm":
      return {
        ...BASE,
        slashComments: false,
        hashComments: true,
        dollarInStrings: true,
        dollarNames: true,
      };
    case "kt":
    case "kts":
    case "groovy":
    case "dart":
    case "scala":
      return { ...BASE, dollarInStrings: true };
    case "cs":
      return { ...BASE, prefixedBraceStrings: true };
    case "swift":
      return { ...BASE, backslashParenInStrings: true };
    case "rs":
      return { ...BASE, bareBraceInStrings: true };
    case "jl":
      return { ...BASE, slashComments: false, hashComments: true };
    default:
      return BASE;
  }
}

// The most tokens one read takes: a call's arguments are never a book.
export const MAX_TOKENS: number = 4000;

// The longest name chain, string or number one token holds.
const MAX_TOKEN_LENGTH: number = 400;

// What makes a string interpolate braces: Python's f-strings, C#'s $"...".
const STRING_PREFIXES: ReadonlyArray<string> = [
  "rf",
  "fr",
  "Rf",
  "fR",
  "RF",
  "FR",
  "f",
  "F",
  "$@",
  "@$",
  "$",
];

// Punctuation of two or three characters, the longest first.
const LONG_PUNCTUATION: ReadonlyArray<string> = [
  "...",
  "===",
  "!==",
  "**",
  "=>",
  "->",
  "::",
  "?.",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
];

function isNameStart(code: number): boolean {
  return isAsciiLetterCode(code) || code === 0x5f;
}

function isNamePart(code: number): boolean {
  return isNameStart(code) || isDigitCode(code);
}

export interface TokenizeResult {
  tokens: Array<CodeToken>;
  // Where reading stopped: the line, and the column on it.
  endLine: number;
  endColumn: number;
}

/*
 * A reader of lines, from a line and a column on, as far as `shouldStop`
 * says or the lines and the tokens end. A string or a comment that spans
 * lines is read across them.
 */
class Tokenizer {
  private readonly lines: ReadonlyArray<string>;
  private readonly language: CodeLanguage;
  private line: number;
  private column: number;
  private readonly lastLine: number;
  private count: number = 0;

  public constructor(data: {
    lines: ReadonlyArray<string>;
    language: CodeLanguage;
    line: number;
    column: number;
    lastLine: number;
  }) {
    this.lines = data.lines;
    this.language = data.language;
    this.line = data.line;
    this.column = data.column;
    this.lastLine = Math.min(data.lastLine, data.lines.length - 1);
  }

  public position(): { line: number; column: number } {
    return { line: this.line, column: this.column };
  }

  private peek(offset: number = 0): string {
    const text: string = this.lines[this.line] || "";

    return text.charAt(this.column + offset);
  }

  private codeAt(offset: number = 0): number {
    const text: string = this.lines[this.line] || "";

    return text.charCodeAt(this.column + offset);
  }

  private atLineEnd(): boolean {
    return this.column >= (this.lines[this.line] || "").length;
  }

  // On to the next line: false when there is none to read.
  private nextLine(): boolean {
    if (this.line >= this.lastLine) {
      this.column = (this.lines[this.line] || "").length;
      return false;
    }

    this.line++;
    this.column = 0;
    return true;
  }

  public isDone(): boolean {
    return (
      this.count >= MAX_TOKENS ||
      (this.line >= this.lastLine && this.atLineEnd())
    );
  }

  /*
   * The next token, or null at the end. A token is never longer than
   * MAX_TOKEN_LENGTH: a longer one is cut there and read on.
   */
  public next(): CodeToken | null {
    for (;;) {
      if (this.count >= MAX_TOKENS) {
        return null;
      }

      if (this.atLineEnd()) {
        if (!this.nextLine()) {
          return null;
        }

        continue;
      }

      const code: number = this.codeAt();

      if (isWhiteSpaceCode(code)) {
        this.column++;
        continue;
      }

      const character: string = this.peek();
      const following: string = this.peek(1);

      // Comments: to the end of the line, or the end of a block.
      if (
        (this.language.slashComments && character === "/" && following === "/") ||
        (this.language.hashComments &&
          character === "#" &&
          !(this.language.hashBraceInStrings && following === "{"))
      ) {
        this.column = (this.lines[this.line] || "").length;
        continue;
      }

      if (this.language.slashComments && character === "/" && following === "*") {
        this.column += 2;
        this.skipBlockComment();
        continue;
      }

      this.count++;

      const line: number = this.line;
      const column: number = this.column;

      // A string, with the prefix that makes it interpolate.
      const prefix: string | null = this.readStringPrefix();

      if (prefix !== null) {
        this.column += prefix.length;
        return this.readString(line, column, prefix);
      }

      if (this.isQuote(character)) {
        return this.readString(line, column, "");
      }

      if (
        isNameStart(code) ||
        ((character === "$" || character === "@") &&
          isNameStart(this.codeAt(1)))
      ) {
        return this.readName(line, column);
      }

      if (isDigitCode(code)) {
        let end: number = this.column;
        const text: string = this.lines[this.line] || "";

        while (
          end < text.length &&
          end - this.column < MAX_TOKEN_LENGTH &&
          (isNamePart(text.charCodeAt(end)) || text.charAt(end) === ".")
        ) {
          end++;
        }

        const number: string = text.slice(this.column, end);
        this.column = end;

        return { kind: CodeTokenKind.Number, text: number, line, column, parts: [] };
      }

      for (const punctuation of LONG_PUNCTUATION) {
        if ((this.lines[this.line] || "").startsWith(punctuation, this.column)) {
          this.column += punctuation.length;

          return {
            kind: CodeTokenKind.Punct,
            text: punctuation,
            line,
            column,
            parts: [],
          };
        }
      }

      this.column++;

      return {
        kind: CodeTokenKind.Punct,
        text: character,
        line,
        column,
        parts: [],
      };
    }
  }

  private skipBlockComment(): void {
    for (;;) {
      const text: string = this.lines[this.line] || "";
      const end: number = text.indexOf("*/", this.column);

      if (end >= 0) {
        this.column = end + 2;
        return;
      }

      if (!this.nextLine()) {
        return;
      }
    }
  }

  private isQuote(character: string): boolean {
    return (
      character === '"' ||
      character === "'" ||
      (character === "`" && this.language.templateLiterals)
    );
  }

  /*
   * The prefix of a string that interpolates - f, rf, fr (Python), $ or
   * $@ (C#) - when one starts here; null otherwise.
   */
  private readStringPrefix(): string | null {
    if (!this.language.prefixedBraceStrings) {
      return null;
    }

    // A name that only ends in an f is no prefix: `elif"`.
    if (this.column > 0 && isNamePart(this.codeAt(-1))) {
      return null;
    }

    for (const prefix of STRING_PREFIXES) {
      if (
        (this.lines[this.line] || "").startsWith(prefix, this.column) &&
        this.isQuote(this.peek(prefix.length))
      ) {
        return prefix;
      }
    }

    return null;
  }

  private readName(line: number, column: number): CodeToken {
    const text: string = this.lines[this.line] || "";
    let index: number = this.column;
    const parts: Array<string> = [];
    let current: string = "";

    for (;;) {
      // A "$" (PHP, Perl) or an "@" (Ruby's instance variables) before a part.
      if (
        (text.charAt(index) === "$" || text.charAt(index) === "@") &&
        isNameStart(text.charCodeAt(index + 1))
      ) {
        index++;
      }

      while (
        index < text.length &&
        isNamePart(text.charCodeAt(index)) &&
        current.length < MAX_TOKEN_LENGTH
      ) {
        current += text.charAt(index);
        index++;
      }

      parts.push(current);
      current = "";

      // The chain goes on through ".", "?.", "->" and "::" to another name.
      let separator: number = 0;

      if (text.charAt(index) === ".") {
        separator = 1;
      } else if (
        text.startsWith("?.", index) ||
        text.startsWith("->", index) ||
        text.startsWith("::", index)
      ) {
        separator = 2;
      }

      const afterSeparator: number = index + separator;

      if (
        separator === 0 ||
        parts.length >= 12 ||
        !(
          isNameStart(text.charCodeAt(afterSeparator)) ||
          ((text.charAt(afterSeparator) === "$" ||
            text.charAt(afterSeparator) === "@") &&
            isNameStart(text.charCodeAt(afterSeparator + 1)))
        )
      ) {
        break;
      }

      index = afterSeparator;
    }

    this.column = index;

    return {
      kind: CodeTokenKind.Name,
      text: parts.join("."),
      line,
      column,
      parts: [],
    };
  }

  /*
   * A string from its opening quote on: its text, and what it
   * interpolates, each read as code of its own. Python's and Kotlin's
   * triple quotes, and a template literal, may span lines.
   */
  private readString(line: number, column: number, prefix: string): CodeToken {
    const quote: string = this.peek();
    const isTriple: boolean =
      quote !== "`" && this.peek(1) === quote && this.peek(2) === quote;
    const closing: string = isTriple ? quote.repeat(3) : quote;
    const spansLines: boolean = isTriple || quote === "`";
    const interpolates: boolean = this.interpolates(quote, prefix);

    this.column += closing.length;

    let text: string = "";
    const parts: Array<Array<CodeToken>> = [];

    for (;;) {
      if (this.atLineEnd()) {
        if (!spansLines || !this.nextLine()) {
          break;
        }

        text += "\n";
        continue;
      }

      if ((this.lines[this.line] || "").startsWith(closing, this.column)) {
        this.column += closing.length;
        break;
      }

      const character: string = this.peek();

      if (character === "\\") {
        // Swift's "\(expr)".
        if (
          interpolates &&
          this.language.backslashParenInStrings &&
          this.peek(1) === "("
        ) {
          this.column += 2;
          parts.push(this.readInterpolation(")"));
          continue;
        }

        this.column += 2;
        continue;
      }

      if (interpolates) {
        const opening: string | null = this.readInterpolationOpening();

        if (opening !== null) {
          if (opening === "$name") {
            parts.push([this.readName(this.line, this.column)]);
          } else {
            this.column += opening.length;
            parts.push(this.readInterpolation("}"));
          }

          continue;
        }
      }

      if (text.length < MAX_TOKEN_LENGTH) {
        text += character;
      }

      this.column++;
    }

    return { kind: CodeTokenKind.String, text, line, column, parts };
  }

  private interpolates(quote: string, prefix: string): boolean {
    if (quote === "`") {
      return this.language.templateLiterals;
    }

    if (prefix) {
      return true;
    }

    if (quote !== '"') {
      return this.language.bareBraceInStrings;
    }

    return (
      this.language.dollarInStrings ||
      this.language.hashBraceInStrings ||
      this.language.backslashParenInStrings ||
      this.language.bareBraceInStrings
    );
  }

  /*
   * What opens an interpolation here, in the language's way - "${", "#{",
   * "{" - or "$name" for PHP's and Kotlin's bare variable; null for none.
   */
  private readInterpolationOpening(): string | null {
    const character: string = this.peek();
    const following: string = this.peek(1);

    if (character === "$" && following === "{") {
      return "${";
    }

    if (
      character === "$" &&
      this.language.dollarInStrings &&
      isNameStart(this.codeAt(1))
    ) {
      return "$name";
    }

    if (this.language.hashBraceInStrings && character === "#" && following === "{") {
      return "#{";
    }

    if (
      (this.language.prefixedBraceStrings || this.language.bareBraceInStrings) &&
      character === "{"
    ) {
      // "{{" is a brace, written twice.
      if (following === "{") {
        this.column++;
        return null;
      }

      return "{";
    }

    if (this.language.dollarInStrings && character === "{" && following === "$") {
      // PHP's "{$user->email}".
      return "{";
    }

    return null;
  }

  // The code an interpolation holds, to the bracket that closes it.
  private readInterpolation(closing: string): Array<CodeToken> {
    const opening: string = closing === ")" ? "(" : "{";
    const tokens: Array<CodeToken> = [];
    let depth: number = 0;

    for (;;) {
      if (this.atLineEnd()) {
        break;
      }

      const character: string = this.peek();

      if (character === closing && depth === 0) {
        this.column++;
        break;
      }

      const token: CodeToken | null = this.next();

      if (!token) {
        break;
      }

      if (token.kind === CodeTokenKind.Punct && token.text === opening) {
        depth++;
      } else if (token.kind === CodeTokenKind.Punct && token.text === closing) {
        depth--;
      }

      tokens.push(token);
    }

    return tokens;
  }
}

/*
 * The tokens of `lines` from a line and a column on, up to `lastLine`:
 * all of them, or - with `untilClosed` - only as far as the bracket that
 * is open there closes (the "(" just before the column, a call's).
 */
export function tokenize(data: {
  lines: ReadonlyArray<string>;
  language: CodeLanguage;
  line: number;
  column: number;
  lastLine: number;
  untilClosed?: boolean | undefined;
}): TokenizeResult {
  const tokenizer: Tokenizer = new Tokenizer(data);
  const tokens: Array<CodeToken> = [];
  let depth: number = 0;

  for (;;) {
    const token: CodeToken | null = tokenizer.next();

    if (!token) {
      break;
    }

    if (data.untilClosed && token.kind === CodeTokenKind.Punct) {
      if (token.text === "(" || token.text === "[" || token.text === "{") {
        depth++;
      } else if (
        token.text === ")" ||
        token.text === "]" ||
        token.text === "}"
      ) {
        if (depth === 0) {
          break;
        }

        depth--;
      }
    }

    tokens.push(token);
  }

  const end: { line: number; column: number } = tokenizer.position();

  return { tokens, endLine: end.line, endColumn: end.column };
}

// The last part of a name's chain: "email" of "user.email".
export function lastPartOf(chain: string): string {
  const dot: number = chain.lastIndexOf(".");

  return dot >= 0 ? chain.slice(dot + 1) : chain;
}

// The parts of a name's chain before its last: "user" of "user.email".
export function receiverOf(chain: string): string {
  const dot: number = chain.lastIndexOf(".");

  return dot >= 0 ? chain.slice(0, dot) : "";
}
