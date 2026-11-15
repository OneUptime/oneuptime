import PromQLError from "./PromQLError";

/*
 * Splits a PromQL query into tokens (promql/parser/lex.go).
 *
 * A hand-written scanner: PromQL's strings carry Go's escapes, its durations
 * are a number glued to a unit (`5m`), and `#` starts a comment, none of which
 * a regular expression tokenizer gets right on its own.
 */

export enum PromQLTokenType {
  Identifier = "Identifier",
  // An identifier with a colon in it, which only a metric name may have.
  MetricIdentifier = "MetricIdentifier",
  Number = "Number",
  Duration = "Duration",
  String = "String",
  LeftParen = "(",
  RightParen = ")",
  LeftBrace = "{",
  RightBrace = "}",
  LeftBracket = "[",
  RightBracket = "]",
  Comma = ",",
  Colon = ":",
  At = "@",
  Add = "+",
  Sub = "-",
  Mul = "*",
  Div = "/",
  Mod = "%",
  Pow = "^",
  Eql = "==",
  Neq = "!=",
  Gtr = ">",
  Lss = "<",
  Gte = ">=",
  Lte = "<=",
  Assign = "=",
  RegexMatch = "=~",
  RegexNoMatch = "!~",
  EOF = "EOF",
}

export interface PromQLToken {
  type: PromQLTokenType;
  // The token's text; a string's text is its value, escapes resolved.
  text: string;
  start: number;
  end: number;
}

const isDigit: (character: string) => boolean = (
  character: string,
): boolean => {
  return character >= "0" && character <= "9";
};

const isAlpha: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "_"
  );
};

const isAlphaNumeric: (character: string) => boolean = (
  character: string,
): boolean => {
  return isAlpha(character) || isDigit(character);
};

const isHexDigit: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    isDigit(character) ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
};

const isWhiteSpace: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
};

const DURATION_UNITS: ReadonlyArray<string> = [
  "ms",
  "y",
  "w",
  "d",
  "h",
  "m",
  "s",
];

const SIMPLE_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

const TWO_CHARACTER_OPERATORS: Record<string, PromQLTokenType> = {
  "==": PromQLTokenType.Eql,
  "!=": PromQLTokenType.Neq,
  ">=": PromQLTokenType.Gte,
  "<=": PromQLTokenType.Lte,
  "=~": PromQLTokenType.RegexMatch,
  "!~": PromQLTokenType.RegexNoMatch,
};

const ONE_CHARACTER_TOKENS: Record<string, PromQLTokenType> = {
  "(": PromQLTokenType.LeftParen,
  ")": PromQLTokenType.RightParen,
  "{": PromQLTokenType.LeftBrace,
  "}": PromQLTokenType.RightBrace,
  "[": PromQLTokenType.LeftBracket,
  "]": PromQLTokenType.RightBracket,
  ",": PromQLTokenType.Comma,
  ":": PromQLTokenType.Colon,
  "@": PromQLTokenType.At,
  "+": PromQLTokenType.Add,
  "-": PromQLTokenType.Sub,
  "*": PromQLTokenType.Mul,
  "/": PromQLTokenType.Div,
  "%": PromQLTokenType.Mod,
  "^": PromQLTokenType.Pow,
  ">": PromQLTokenType.Gtr,
  "<": PromQLTokenType.Lss,
  "=": PromQLTokenType.Assign,
};

class PromQLLexer {
  private readonly input: string;
  private position: number = 0;
  private readonly tokens: Array<PromQLToken> = [];

  public constructor(input: string) {
    this.input = input;
  }

  public tokenize(): Array<PromQLToken> {
    while (this.position < this.input.length) {
      const character: string = this.input[this.position]!;

      if (isWhiteSpace(character)) {
        this.position++;
        continue;
      }

      // A comment runs to the end of its line.
      if (character === "#") {
        while (
          this.position < this.input.length &&
          this.input[this.position] !== "\n"
        ) {
          this.position++;
        }
        continue;
      }

      if (isDigit(character) || (character === "." && isDigit(this.peek(1)))) {
        this.scanNumberOrDuration();
        continue;
      }

      if (isAlpha(character) || character === ":") {
        /*
         * A colon is part of a metric name (`job:rate5m`) except where it
         * separates a subquery's range from its step, which always follows
         * a duration and is caught by the bracket rule below.
         */
        if (character === ":" && this.isInsideSubqueryBrackets()) {
          this.push(PromQLTokenType.Colon, ":", this.position, ++this.position);
          continue;
        }

        this.scanIdentifier();
        continue;
      }

      if (character === '"' || character === "'") {
        this.scanQuotedString(character);
        continue;
      }

      if (character === "`") {
        this.scanRawString();
        continue;
      }

      const pair: string = this.input.slice(this.position, this.position + 2);
      const pairType: PromQLTokenType | undefined =
        TWO_CHARACTER_OPERATORS[pair];

      if (pairType) {
        this.push(pairType, pair, this.position, this.position + 2);
        this.position += 2;
        continue;
      }

      const singleType: PromQLTokenType | undefined =
        ONE_CHARACTER_TOKENS[character];

      if (singleType) {
        this.push(singleType, character, this.position, this.position + 1);
        this.position++;
        continue;
      }

      throw new PromQLError(
        `Unexpected character "${character}" at position ${this.position + 1}.`,
        undefined,
        { start: this.position, end: this.position + 1 },
      );
    }

    this.push(PromQLTokenType.EOF, "", this.input.length, this.input.length);

    return this.tokens;
  }

  private peek(offset: number): string {
    return this.input[this.position + offset] || "";
  }

  private push(
    type: PromQLTokenType,
    text: string,
    start: number,
    end: number,
  ): void {
    this.tokens.push({ type, text, start, end });
  }

  /*
   * True while the scanner sits between `[` and `]` right after a duration:
   * `[5m:1m]`. Brackets never nest in PromQL, so the last bracket token
   * decides.
   */
  private isInsideSubqueryBrackets(): boolean {
    for (let index: number = this.tokens.length - 1; index >= 0; index--) {
      const token: PromQLToken = this.tokens[index]!;

      if (token.type === PromQLTokenType.RightBracket) {
        return false;
      }

      if (token.type === PromQLTokenType.LeftBracket) {
        const previous: PromQLToken | undefined =
          this.tokens[this.tokens.length - 1];

        return (
          previous !== undefined &&
          (previous.type === PromQLTokenType.Duration ||
            previous.type === PromQLTokenType.Number)
        );
      }
    }

    return false;
  }

  private scanIdentifier(): void {
    const start: number = this.position;

    while (
      this.position < this.input.length &&
      (isAlphaNumeric(this.input[this.position]!) ||
        this.input[this.position] === ":")
    ) {
      this.position++;
    }

    const text: string = this.input.slice(start, this.position);

    this.push(
      text.includes(":")
        ? PromQLTokenType.MetricIdentifier
        : PromQLTokenType.Identifier,
      text,
      start,
      this.position,
    );
  }

  private scanNumberOrDuration(): void {
    const start: number = this.position;

    // Hexadecimal: 0x1F.
    if (
      this.input[this.position] === "0" &&
      (this.peek(1) === "x" || this.peek(1) === "X") &&
      isHexDigit(this.peek(2))
    ) {
      this.position += 2;

      while (
        this.position < this.input.length &&
        isHexDigit(this.input[this.position]!)
      ) {
        this.position++;
      }

      this.finishNumber(start);
      return;
    }

    while (
      this.position < this.input.length &&
      isDigit(this.input[this.position]!)
    ) {
      this.position++;
    }

    // A duration: digits glued to a unit, possibly several (`1h30m`).
    if (this.startsDurationUnit()) {
      this.scanDurationRest(start);
      return;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (
        this.position < this.input.length &&
        isDigit(this.input[this.position]!)
      ) {
        this.position++;
      }
    }

    if (
      this.input[this.position] === "e" ||
      this.input[this.position] === "E"
    ) {
      const afterExponent: string = this.peek(1);
      const signed: boolean = afterExponent === "+" || afterExponent === "-";

      if (isDigit(signed ? this.peek(2) : afterExponent)) {
        this.position += signed ? 2 : 1;

        while (
          this.position < this.input.length &&
          isDigit(this.input[this.position]!)
        ) {
          this.position++;
        }
      }
    }

    this.finishNumber(start);
  }

  private finishNumber(start: number): void {
    // `1x` is neither a number nor a duration.
    if (
      this.position < this.input.length &&
      isAlpha(this.input[this.position]!)
    ) {
      throw new PromQLError(
        `"${this.input.slice(start, this.position + 1)}" is not a number or a duration. Write a number such as 1.5, or a duration such as 5m.`,
        undefined,
        { start, end: this.position + 1 },
      );
    }

    this.push(
      PromQLTokenType.Number,
      this.input.slice(start, this.position),
      start,
      this.position,
    );
  }

  private startsDurationUnit(): boolean {
    for (const unit of DURATION_UNITS) {
      if (this.input.startsWith(unit, this.position)) {
        const after: string = this.input[this.position + unit.length] || "";

        // `5m` but not `5min`: a unit ends where the letters end.
        if (!isAlphaNumeric(after) || isDigit(after)) {
          return true;
        }
      }
    }

    return false;
  }

  private scanDurationRest(start: number): void {
    while (this.position < this.input.length) {
      let matchedUnit: string | undefined = undefined;

      for (const unit of DURATION_UNITS) {
        if (this.input.startsWith(unit, this.position)) {
          const after: string = this.input[this.position + unit.length] || "";

          if (!isAlphaNumeric(after) || isDigit(after)) {
            matchedUnit = unit;
            break;
          }
        }
      }

      if (!matchedUnit) {
        break;
      }

      this.position += matchedUnit.length;

      if (!isDigit(this.input[this.position] || "")) {
        break;
      }

      while (
        this.position < this.input.length &&
        isDigit(this.input[this.position]!)
      ) {
        this.position++;
      }
    }

    const text: string = this.input.slice(start, this.position);

    if (
      this.position < this.input.length &&
      isAlpha(this.input[this.position]!)
    ) {
      throw new PromQLError(
        `"${text}${this.input[this.position]}" is not a duration. Write a duration such as 30s, 5m, 1h or 1h30m.`,
        undefined,
        { start, end: this.position + 1 },
      );
    }

    this.push(PromQLTokenType.Duration, text, start, this.position);
  }

  private scanQuotedString(quote: string): void {
    const start: number = this.position;
    this.position++;
    let value: string = "";

    while (this.position < this.input.length) {
      const character: string = this.input[this.position]!;

      if (character === quote) {
        this.position++;
        this.push(PromQLTokenType.String, value, start, this.position);
        return;
      }

      if (character === "\n") {
        break;
      }

      if (character === "\\") {
        value += this.scanEscape(start);
        continue;
      }

      value += character;
      this.position++;
    }

    throw new PromQLError(
      `The string that starts at position ${start + 1} is not closed. End it with ${quote}.`,
      undefined,
      { start, end: this.input.length },
    );
  }

  private scanEscape(stringStart: number): string {
    const escapeStart: number = this.position;
    const next: string = this.peek(1);
    const simple: string | undefined = SIMPLE_ESCAPES[next];

    if (simple !== undefined) {
      this.position += 2;
      return simple;
    }

    const readHex: (length: number) => string = (length: number): string => {
      const digits: string = this.input.slice(
        this.position + 2,
        this.position + 2 + length,
      );

      if (digits.length !== length || !Array.from(digits).every(isHexDigit)) {
        throw new PromQLError(
          `The escape at position ${escapeStart + 1} is not complete: \\${next} takes ${length} hexadecimal digits.`,
          undefined,
          { start: stringStart, end: escapeStart + 2 + length },
        );
      }

      this.position += 2 + length;
      return String.fromCodePoint(parseInt(digits, 16));
    };

    if (next === "x") {
      return readHex(2);
    }

    if (next === "u") {
      return readHex(4);
    }

    if (next === "U") {
      return readHex(8);
    }

    // Three octal digits: \101 is "A".
    if (next >= "0" && next <= "7") {
      const digits: string = this.input.slice(
        this.position + 1,
        this.position + 4,
      );

      if (
        digits.length === 3 &&
        Array.from(digits).every((digit: string): boolean => {
          return digit >= "0" && digit <= "7";
        })
      ) {
        this.position += 4;
        return String.fromCharCode(parseInt(digits, 8));
      }
    }

    throw new PromQLError(
      `Unknown escape "\\${next}" at position ${escapeStart + 1}. Write a backslash as \\\\.`,
      undefined,
      { start: stringStart, end: escapeStart + 2 },
    );
  }

  private scanRawString(): void {
    const start: number = this.position;
    const end: number = this.input.indexOf("`", start + 1);

    if (end === -1) {
      throw new PromQLError(
        `The string that starts at position ${start + 1} is not closed. End it with \`.`,
        undefined,
        { start, end: this.input.length },
      );
    }

    this.position = end + 1;
    this.push(
      PromQLTokenType.String,
      this.input.slice(start + 1, end),
      start,
      this.position,
    );
  }
}

export const tokenizePromQL: (input: string) => Array<PromQLToken> = (
  input: string,
): Array<PromQLToken> => {
  return new PromQLLexer(input).tokenize();
};
