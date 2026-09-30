import {
  getTemplateExpressionRegex,
  hasEachBlock,
} from "../Workflow/TemplateSyntax";
import JSON5 from "json5";

/*
 * Where is this JSON document broken, and how do I fix it?
 *
 * JSON.parse answers "is it valid" but not "where": V8 names a position in
 * some messages and none in others ("Unexpected token '}', ... is not valid
 * JSON"), Firefox and Safari phrase everything differently again, and none of
 * them says what a person would - "trailing comma", "property names need
 * double quotes". The code editor's status bar and gutter need a line and a
 * column, so this module scans the text itself.
 *
 * The verdict must agree with the form's own check (checkJSONSyntax in
 * Types/Workflow/TemplateSyntax.ts): the status bar saying "Valid JSON" while
 * Save is blocked, or the reverse, is worse than saying nothing. So it takes
 * the same inputs the same way - {{...}} placeholders masked, loops and empty
 * boxes not judged, JSON5 rules where the field reads JSON5 - and
 * Tests/Types/Code/JsonSyntax.test.ts holds the two to the same answers.
 */

export interface JsonSyntaxError {
  /** A sentence fragment: "Expected ',' or '}' after a property value". */
  message: string;
  /** 0-based offset of the character the problem was found at. */
  offset: number;
}

export interface JsonSyntaxCheckResult {
  /**
   * False only when the document is definitely malformed. A value this module
   * cannot decide about (a handlebars loop, a non-string, an empty box) is
   * reported valid.
   */
  isValid: boolean;
  /** The reason, with no position in it. Null when valid. */
  errorMessage: string | null;
  /** True when the check was skipped rather than passed. */
  wasSkipped: boolean;
  /** 1-based line of the failure. */
  line: number | null;
  /** 1-based column of the failure. */
  column: number | null;
}

export interface JsonSyntaxCheckOptions {
  /** Judge by JSON5's rules, for fields whose value is read with JSON5. */
  allowJSON5?: boolean | undefined;
}

enum Expect {
  Value,
  ValueOrArrayEnd,
  KeyOrObjectEnd,
  Key,
  Colon,
  CommaOrEnd,
}

type Container = "object" | "array";

const WORD_PATTERN: RegExp = /^[A-Za-z_$][A-Za-z0-9_$]*/;

const HEX_PATTERN: RegExp = /^[0-9a-fA-F]{4}$/;

type IsDigitFunction = (character: string | undefined) => boolean;

const isDigit: IsDigitFunction = (character: string | undefined): boolean => {
  return character !== undefined && character >= "0" && character <= "9";
};

type IsJsonWhitespaceFunction = (character: string | undefined) => boolean;

// JSON's whitespace is exactly these four. A pasted NBSP or BOM is not.
const isJsonWhitespace: IsJsonWhitespaceFunction = (
  character: string | undefined,
): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
};

type DescribeCharacterFunction = (character: string) => string;

/*
 * Invisible characters are named by code point: "Unexpected ' '" is useless
 * when the character is a no-break space pasted from a web page.
 */
const describeCharacter: DescribeCharacterFunction = (
  character: string,
): string => {
  const code: number = character.codePointAt(0) || 0;

  if (
    code < 0x20 ||
    code === 0x7f ||
    code === 0xa0 ||
    code === 0xfeff ||
    (code >= 0x2000 && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029
  ) {
    return `invisible character U+${code
      .toString(16)
      .toUpperCase()
      .padStart(4, "0")}`;
  }

  return `'${character}'`;
};

type ExplainUnexpectedFunction = (
  text: string,
  offset: number,
  wanted: string,
) => JsonSyntaxError;

/*
 * The one place that turns "not what we wanted here" into a sentence, with
 * the mistakes people actually make called out by name.
 */
const explainUnexpected: ExplainUnexpectedFunction = (
  text: string,
  offset: number,
  wanted: string,
): JsonSyntaxError => {
  const codePoint: number | undefined = text.codePointAt(offset);

  if (codePoint === undefined) {
    return {
      message: `Unexpected end of JSON: expected ${wanted}`,
      offset: text.length,
    };
  }

  // Whole code point, so an emoji is not reported as half a surrogate pair.
  const character: string = String.fromCodePoint(codePoint);

  if (
    character === "/" &&
    (text[offset + 1] === "/" || text[offset + 1] === "*")
  ) {
    return { message: "Comments are not allowed in JSON", offset };
  }

  if (character === "'") {
    return {
      message: "Strings must use double quotes, not single quotes",
      offset,
    };
  }

  const word: RegExpExecArray | null = WORD_PATTERN.exec(text.slice(offset));

  if (word) {
    const value: string = word[0];

    if (
      ["True", "False", "TRUE", "FALSE", "NULL", "Null", "None"].includes(value)
    ) {
      return {
        message: `Unexpected '${value}': JSON's literals are lowercase true, false and null`,
        offset,
      };
    }

    if (["undefined", "NaN", "Infinity"].includes(value)) {
      return {
        message: `'${value}' is not a JSON value`,
        offset,
      };
    }

    return {
      message: `Unexpected '${value}': expected ${wanted}`,
      offset,
    };
  }

  if ((character === "+" || character === ".") && isDigit(text[offset + 1])) {
    return {
      message: "A number must start with a digit or '-'",
      offset,
    };
  }

  return {
    message: `Unexpected ${describeCharacter(character)}: expected ${wanted}`,
    offset,
  };
};

type ScanResult = { end: number } | { error: JsonSyntaxError };

type ScanStringFunction = (text: string, start: number) => ScanResult;

const scanString: ScanStringFunction = (
  text: string,
  start: number,
): ScanResult => {
  let index: number = start + 1;

  while (index < text.length) {
    const character: string = text[index] as string;

    if (character === '"') {
      return { end: index + 1 };
    }

    if (character === "\\") {
      const escaped: string | undefined = text[index + 1];

      if (escaped === undefined) {
        break;
      }

      if ('"\\/bfnrt'.includes(escaped)) {
        index += 2;
        continue;
      }

      if (escaped === "u") {
        if (!HEX_PATTERN.test(text.slice(index + 2, index + 6))) {
          return {
            error: {
              message: "A \\u escape needs exactly four hex digits",
              offset: index,
            },
          };
        }

        index += 6;
        continue;
      }

      return {
        error: {
          message: `'\\${escaped}' is not a valid escape in a JSON string`,
          offset: index,
        },
      };
    }

    if (character === "\n" || character === "\r") {
      return {
        error: {
          message:
            "A string cannot span lines: close it, or write the line break as \\n",
          offset: index,
        },
      };
    }

    if (character === "\t") {
      return {
        error: {
          message: "A tab inside a string must be written as \\t",
          offset: index,
        },
      };
    }

    if (character < " ") {
      return {
        error: {
          message: `Control character U+${character
            .charCodeAt(0)
            .toString(16)
            .toUpperCase()
            .padStart(4, "0")} must be escaped inside a string`,
          offset: index,
        },
      };
    }

    index++;
  }

  return {
    error: { message: "This string is never closed", offset: start },
  };
};

type ScanNumberFunction = (text: string, start: number) => ScanResult;

const scanNumber: ScanNumberFunction = (
  text: string,
  start: number,
): ScanResult => {
  let index: number = start;

  if (text[index] === "-") {
    index++;
  }

  if (!isDigit(text[index])) {
    return {
      error: { message: "Expected a digit after '-'", offset: index },
    };
  }

  if (text[index] === "0") {
    index++;

    if (isDigit(text[index])) {
      return {
        error: {
          message: "A number cannot have a leading zero",
          offset: start,
        },
      };
    }
  } else {
    while (isDigit(text[index])) {
      index++;
    }
  }

  if (text[index] === ".") {
    index++;

    if (!isDigit(text[index])) {
      return {
        error: {
          message: "Expected a digit after the decimal point",
          offset: index,
        },
      };
    }

    while (isDigit(text[index])) {
      index++;
    }
  }

  if (text[index] === "e" || text[index] === "E") {
    index++;

    if (text[index] === "+" || text[index] === "-") {
      index++;
    }

    if (!isDigit(text[index])) {
      return {
        error: {
          message: "Expected a digit in the exponent",
          offset: index,
        },
      };
    }

    while (isDigit(text[index])) {
      index++;
    }
  }

  return { end: index };
};

type ScanValueFunction = (text: string, start: number) => ScanResult | null;

/*
 * A scalar at `start`, or null when the character there opens a container
 * (or cannot start a value at all - the caller words that).
 */
const scanScalar: ScanValueFunction = (
  text: string,
  start: number,
): ScanResult | null => {
  const character: string | undefined = text[start];

  if (character === '"') {
    return scanString(text, start);
  }

  if (character === "-" || isDigit(character)) {
    return scanNumber(text, start);
  }

  for (const literal of ["true", "false", "null"]) {
    if (text.startsWith(literal, start)) {
      return { end: start + literal.length };
    }
  }

  return null;
};

export type FindJsonSyntaxErrorFunction = (
  text: string,
) => JsonSyntaxError | null;

/**
 * The first syntax error in `text` read as strict JSON, or null when
 * JSON.parse would accept it. Iterative, so nesting depth cannot overflow
 * the stack.
 */
export const findJsonSyntaxError: FindJsonSyntaxErrorFunction = (
  text: string,
): JsonSyntaxError | null => {
  const stack: Array<Container> = [];
  let expect: Expect = Expect.Value;
  let index: number = 0;
  // The last comma, so a trailing one is blamed where it actually is.
  let commaOffset: number = -1;

  for (;;) {
    while (isJsonWhitespace(text[index])) {
      index++;
    }

    const character: string | undefined = text[index];

    if (expect === Expect.ValueOrArrayEnd && character === "]") {
      stack.pop();
      index++;
      expect = Expect.CommaOrEnd;
      continue;
    }

    if (expect === Expect.KeyOrObjectEnd && character === "}") {
      stack.pop();
      index++;
      expect = Expect.CommaOrEnd;
      continue;
    }

    if (expect === Expect.Value || expect === Expect.ValueOrArrayEnd) {
      if (character === "]" && commaOffset !== -1 && expect === Expect.Value) {
        return {
          message: "Trailing comma: remove the ',' before ']'",
          offset: commaOffset,
        };
      }

      if (character === "{") {
        stack.push("object");
        index++;
        expect = Expect.KeyOrObjectEnd;
        continue;
      }

      if (character === "[") {
        stack.push("array");
        index++;
        expect = Expect.ValueOrArrayEnd;
        continue;
      }

      const scalar: ScanResult | null = scanScalar(text, index);

      if (!scalar) {
        return explainUnexpected(text, index, "a value");
      }

      if ("error" in scalar) {
        return scalar.error;
      }

      index = scalar.end;
      expect = Expect.CommaOrEnd;
      continue;
    }

    if (expect === Expect.Key || expect === Expect.KeyOrObjectEnd) {
      if (character === "}" && expect === Expect.Key) {
        return {
          message: "Trailing comma: remove the ',' before '}'",
          offset: commaOffset,
        };
      }

      if (character !== '"') {
        if (character !== undefined && WORD_PATTERN.test(character)) {
          return {
            message: "Property names must be wrapped in double quotes",
            offset: index,
          };
        }

        return explainUnexpected(
          text,
          index,
          "a property name in double quotes",
        );
      }

      const key: ScanResult = scanString(text, index);

      if ("error" in key) {
        return key.error;
      }

      index = key.end;
      expect = Expect.Colon;
      continue;
    }

    if (expect === Expect.Colon) {
      if (character !== ":") {
        return explainUnexpected(text, index, "':' after the property name");
      }

      index++;
      expect = Expect.Value;
      commaOffset = -1;
      continue;
    }

    // Expect.CommaOrEnd: a value just finished.
    const container: Container | undefined = stack[stack.length - 1];

    if (!container) {
      if (character === undefined) {
        return null;
      }

      return {
        message: `Unexpected ${describeCharacter(
          String.fromCodePoint(text.codePointAt(index) as number),
        )} after the end of the JSON value`,
        offset: index,
      };
    }

    const closer: string = container === "object" ? "}" : "]";

    if (character === ",") {
      commaOffset = index;
      index++;
      expect = container === "object" ? Expect.Key : Expect.Value;
      continue;
    }

    if (character === closer) {
      stack.pop();
      index++;
      commaOffset = -1;
      continue;
    }

    if (character === undefined) {
      return {
        message: `Unexpected end of JSON: a closing '${closer}' is missing`,
        offset: text.length,
      };
    }

    return explainUnexpected(
      text,
      index,
      container === "object"
        ? "',' or '}' after a property value"
        : "',' or ']' after an array item",
    );
  }
};

export type OffsetToLineColumnFunction = (
  text: string,
  offset: number,
) => { line: number; column: number };

/** 1-based line and column of a 0-based offset. */
export const offsetToLineColumn: OffsetToLineColumnFunction = (
  text: string,
  offset: number,
): { line: number; column: number } => {
  const clamped: number = Math.max(0, Math.min(offset, text.length));
  let line: number = 1;
  let lineStart: number = 0;

  for (let index: number = 0; index < clamped; index++) {
    if (text[index] === "\n") {
      line++;
      lineStart = index + 1;
    }
  }

  return { line, column: clamped - lineStart + 1 };
};

export type LineColumnToOffsetFunction = (
  text: string,
  line: number,
  column: number,
) => number;

/** The 0-based offset of a 1-based line and column. */
export const lineColumnToOffset: LineColumnToOffsetFunction = (
  text: string,
  line: number,
  column: number,
): number => {
  let offset: number = 0;

  for (let current: number = 1; current < line; current++) {
    const next: number = text.indexOf("\n", offset);

    if (next === -1) {
      return text.length;
    }

    offset = next + 1;
  }

  return Math.min(offset + Math.max(0, column - 1), text.length);
};

interface MaskedTemplates {
  text: string;
  /** Maps an offset in the masked text back to the text as written. */
  toOriginal: (offset: number) => number;
}

type MaskTemplatesFunction = (text: string) => MaskedTemplates;

/*
 * Exactly the masking checkJSONSyntax does - every {{...}} becomes "1" - so
 * the verdict is the form's verdict. (Masking each character instead, to keep
 * offsets still, was not the same: `"\u{{x}}"` got the four hex digits its
 * escape needs, and the status bar called valid what Save refused.) The
 * error's offset is then carried back to the text the person sees; one inside
 * an expression lands on its opening brace.
 */
const maskTemplates: MaskTemplatesFunction = (
  text: string,
): MaskedTemplates => {
  const spans: Array<{ maskedAt: number; originalAt: number; length: number }> =
    [];
  let removed: number = 0;

  const masked: string = text.replace(
    getTemplateExpressionRegex(),
    (match: string, _expression: string, offset: number): string => {
      spans.push({
        maskedAt: offset - removed,
        originalAt: offset,
        length: match.length,
      });
      removed += match.length - 1;
      return "1";
    },
  );

  return {
    text: masked,
    toOriginal: (offset: number): number => {
      let shift: number = 0;

      for (const span of spans) {
        if (offset < span.maskedAt) {
          break;
        }

        if (offset === span.maskedAt) {
          return span.originalAt;
        }

        shift = span.originalAt + span.length - (span.maskedAt + 1);
      }

      return offset + shift;
    },
  };
};

type ReadJson5ErrorFunction = (error: unknown) => {
  message: string;
  line: number | null;
  column: number | null;
};

// "JSON5: invalid character 'x' at 3:7" -> "Invalid character 'x'", 3, 7.
const readJson5Error: ReadJson5ErrorFunction = (
  error: unknown,
): { message: string; line: number | null; column: number | null } => {
  const shaped: { lineNumber?: unknown; columnNumber?: unknown } =
    (error as { lineNumber?: unknown; columnNumber?: unknown } | null) || {};
  const raw: string =
    error instanceof Error && error.message ? error.message : "Invalid JSON5";
  const reason: string = raw
    .replace(/^JSON5:\s*/, "")
    .replace(/\s+at\s+\d+:\d+$/, "");

  return {
    message: reason.charAt(0).toUpperCase() + reason.slice(1),
    line: typeof shaped.lineNumber === "number" ? shaped.lineNumber : null,
    column:
      typeof shaped.columnNumber === "number" ? shaped.columnNumber : null,
  };
};

export type CheckJsonSyntaxFunction = (
  value: unknown,
  options?: JsonSyntaxCheckOptions | undefined,
) => JsonSyntaxCheckResult;

/**
 * Is `value` a JSON document once its {{...}} placeholders are accounted for,
 * and if not, where does it go wrong?
 */
export const checkJsonSyntax: CheckJsonSyntaxFunction = (
  value: unknown,
  options?: JsonSyntaxCheckOptions | undefined,
): JsonSyntaxCheckResult => {
  const skipped: JsonSyntaxCheckResult = {
    isValid: true,
    errorMessage: null,
    wasSkipped: true,
    line: null,
    column: null,
  };

  if (typeof value !== "string" || value.trim() === "") {
    return skipped;
  }

  // A loop repeats its body a run-time number of times: its shape is unknowable.
  if (hasEachBlock(value)) {
    return skipped;
  }

  const masked: MaskedTemplates = maskTemplates(value);

  if (options?.allowJSON5) {
    try {
      JSON5.parse(masked.text);
    } catch (err: unknown) {
      const { message, line, column } = readJson5Error(err);

      if (line === null || column === null) {
        return {
          isValid: false,
          errorMessage: message,
          wasSkipped: false,
          line,
          column,
        };
      }

      const position: { line: number; column: number } = offsetToLineColumn(
        value,
        masked.toOriginal(lineColumnToOffset(masked.text, line, column)),
      );

      return {
        isValid: false,
        errorMessage: message,
        wasSkipped: false,
        line: position.line,
        column: position.column,
      };
    }

    return {
      isValid: true,
      errorMessage: null,
      wasSkipped: false,
      line: null,
      column: null,
    };
  }

  const error: JsonSyntaxError | null = findJsonSyntaxError(masked.text);

  if (!error) {
    return {
      isValid: true,
      errorMessage: null,
      wasSkipped: false,
      line: null,
      column: null,
    };
  }

  const { line, column } = offsetToLineColumn(
    value,
    masked.toOriginal(error.offset),
  );

  return {
    isValid: false,
    errorMessage: error.message,
    wasSkipped: false,
    line,
    column,
  };
};

export type DescribeJsonSyntaxErrorFunction = (
  result: JsonSyntaxCheckResult,
) => string;

/**
 * "Trailing comma: remove the ',' before '}' (line 4, column 12)" - one line,
 * for a status bar or a form error.
 */
export const describeJsonSyntaxError: DescribeJsonSyntaxErrorFunction = (
  result: JsonSyntaxCheckResult,
): string => {
  const reason: string = result.errorMessage || "Invalid JSON";

  if (result.line === null) {
    return reason;
  }

  if (result.column === null) {
    return `${reason} (line ${result.line})`;
  }

  return `${reason} (line ${result.line}, column ${result.column})`;
};

export type FormatJsonFunction = (
  text: string,
  indent: string,
) => string | null;

/**
 * Pretty-print a strict JSON document, or null when it is not one.
 *
 * Only the whitespace between tokens changes. It deliberately does not go
 * through JSON.parse and JSON.stringify, which would silently rewrite the
 * document: an ID of 12345678901234567890 comes back as
 * 12345678901234567000, `1.0` becomes `1`, `é` is unescaped, and of two
 * duplicate keys only the last survives. "Format" must never change what the
 * document says.
 */
export const formatJson: FormatJsonFunction = (
  text: string,
  indent: string,
): string | null => {
  if (text.trim() === "" || findJsonSyntaxError(text) !== null) {
    return null;
  }

  let output: string = "";
  let depth: number = 0;
  let index: number = 0;

  type NextSignificantFunction = (from: number) => string | undefined;

  const nextSignificant: NextSignificantFunction = (
    from: number,
  ): string | undefined => {
    let cursor: number = from;

    while (isJsonWhitespace(text[cursor])) {
      cursor++;
    }

    return text[cursor];
  };

  type NewLineFunction = () => string;

  const newLine: NewLineFunction = (): string => {
    return "\n" + indent.repeat(depth);
  };

  while (index < text.length) {
    const character: string = text[index] as string;

    if (isJsonWhitespace(character)) {
      index++;
      continue;
    }

    if (character === "{" || character === "[") {
      const closer: string = character === "{" ? "}" : "]";

      // An empty container stays on one line.
      if (nextSignificant(index + 1) === closer) {
        output += character + closer;
        index = text.indexOf(closer, index + 1) + 1;
        continue;
      }

      depth++;
      output += character + newLine();
      index++;
      continue;
    }

    if (character === "}" || character === "]") {
      depth--;
      output += newLine() + character;
      index++;
      continue;
    }

    if (character === ",") {
      output += "," + newLine();
      index++;
      continue;
    }

    if (character === ":") {
      output += ": ";
      index++;
      continue;
    }

    // A scalar: copied exactly as written.
    const scalar: ScanResult | null = scanScalar(text, index);

    if (!scalar || "error" in scalar) {
      return null;
    }

    output += text.slice(index, scalar.end);
    index = scalar.end;
  }

  return output;
};
