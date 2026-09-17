import {
  hasEachBlock,
  maskTemplateExpressions,
} from "../Workflow/TemplateSyntax";
import yaml from "js-yaml";

/*
 * Is this text parseable as YAML?
 *
 * The JSON twin of this module lives in Types/Workflow/TemplateSyntax.ts
 * (checkJSONSyntax) and this deliberately mirrors its contract, because the
 * two are used side by side by Forms/Validation.ts and a caller should not
 * have to remember which one skips what.
 *
 * Deliberately permissive, for the same reason checkJSONSyntax is: a false
 * positive blocks Save on a document that actually works. Anything this
 * module cannot decide about is reported valid and flagged as skipped.
 */

export interface YamlSyntaxCheckResult {
  /**
   * False only when the document is definitely malformed. A value this module
   * cannot decide about (a handlebars loop, a non-string, an empty box) is
   * reported valid.
   */
  isValid: boolean;
  /**
   * The parser's own reason ("bad indentation of a mapping entry"), with no
   * framing around it and no source snippet - callers phrase the sentence,
   * since a form error and an editor status bar word it differently. Null
   * when valid.
   */
  errorMessage: string | null;
  /** True when the check was skipped rather than passed. */
  wasSkipped: boolean;
  /** 1-based line of the failure, when the parser reported one. */
  line: number | null;
  /** 1-based column of the failure, when the parser reported one. */
  column: number | null;
}

/*
 * js-yaml throws a YAMLException carrying `reason` (the message without the
 * source snippet) and `mark` (0-based line/column). Neither is on the public
 * type, and both are absent on a non-YAMLException, so read them defensively.
 */
interface YamlExceptionShape {
  reason?: string | undefined;
  mark?: { line?: number | undefined; column?: number | undefined } | undefined;
}

type ReadMarkFunction = (error: unknown) => {
  line: number | null;
  column: number | null;
};

const readMark: ReadMarkFunction = (
  error: unknown,
): { line: number | null; column: number | null } => {
  const mark: YamlExceptionShape["mark"] = (error as YamlExceptionShape | null)
    ?.mark;

  if (!mark) {
    return { line: null, column: null };
  }

  return {
    line: typeof mark.line === "number" ? mark.line + 1 : null,
    column: typeof mark.column === "number" ? mark.column + 1 : null,
  };
};

type ReadReasonFunction = (error: unknown) => string;

const readReason: ReadReasonFunction = (error: unknown): string => {
  const reason: string | undefined = (error as YamlExceptionShape | null)
    ?.reason;

  if (reason) {
    return reason;
  }

  /*
   * Fall back to the first line of the message: js-yaml appends a multi-line
   * source excerpt to `message`, which is far too much for a form error.
   */
  if (error instanceof Error && error.message) {
    return error.message.split("\n")[0] || "Invalid YAML.";
  }

  return "Invalid YAML.";
};

/*
 * A tab used as indentation, which YAML forbids outright.
 *
 * This has to be found by hand because js-yaml does not report it: it parses
 * `detection:\n\tselection: 1` without complaint and yields
 * `{detection: null, selection: 1}` — the tab silently makes `selection` a
 * SIBLING of `detection` rather than its child. The document looks nested on
 * screen and is flat in the parse, which is the worst shape a syntax error can
 * take, and the reason this module reports it as invalid rather than trusting
 * the parser's verdict.
 *
 * Tabs are only illegal in INDENTATION. They are ordinary characters inside a
 * scalar, and a scan that ignores that blocks Save on documents that work —
 * the exact failure this module's permissiveness exists to prevent. Verified
 * against js-yaml, all of these parse and must not be flagged:
 *
 *   a: |            a: "one          a: {           data:
 *     \tcontent       \ttwo"           \tb: 1 }       app.yaml: |
 *                                                       outer:
 *                                                     \tinner: 1
 *
 * So three contexts are tracked and skipped — block scalars (`|`, `>`),
 * multi-line quoted scalars, and flow collections (`{}`, `[]`, where tabs are
 * legal separation whitespace) — and within what remains a tab is reported
 * only when the line goes on to open a block node (`key:` or `- `). Anything
 * this cannot place confidently is left alone, valid, per the module contract.
 */
interface TabIndentationFinding {
  line: number;
  column: number;
}

type QuoteCharacter = '"' | "'" | null;

interface LineScanState {
  flowDepth: number;
  openQuote: QuoteCharacter;
}

/*
 * True when the quote at `index` opens a scalar rather than sitting inside
 * one. Without this, the apostrophe in `a: it's fine` reads as an unterminated
 * quote and silences the check for the rest of the document.
 */
type IsScalarOpeningQuoteFunction = (line: string, index: number) => boolean;

const isScalarOpeningQuote: IsScalarOpeningQuoteFunction = (
  line: string,
  index: number,
): boolean => {
  const before: string = line.slice(0, index).trimEnd();

  if (before === "") {
    return true;
  }

  return ["-", ":", ",", "[", "{"].includes(before[before.length - 1] || "");
};

/*
 * Walk one line's characters, updating flow depth and quote state and
 * returning the line with any trailing comment removed.
 */
type ScanLineFunction = (line: string, state: LineScanState) => string;

const scanLine: ScanLineFunction = (
  line: string,
  state: LineScanState,
): string => {
  let index: number = 0;

  while (index < line.length) {
    const character: string = line[index] || "";

    if (state.openQuote === '"') {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') {
        state.openQuote = null;
      }
      index++;
      continue;
    }

    if (state.openQuote === "'") {
      // '' is an escaped quote inside a single-quoted scalar, not a close.
      if (character === "'" && line[index + 1] === "'") {
        index += 2;
        continue;
      }
      if (character === "'") {
        state.openQuote = null;
      }
      index++;
      continue;
    }

    const previous: string = line[index - 1] || "";

    if (
      character === "#" &&
      (index === 0 || previous === " " || previous === "\t")
    ) {
      return line.slice(0, index);
    }

    if (
      (character === '"' || character === "'") &&
      isScalarOpeningQuote(line, index)
    ) {
      state.openQuote = character as QuoteCharacter;
      index++;
      continue;
    }

    if (character === "{" || character === "[") {
      state.flowDepth++;
    }

    if (character === "}" || character === "]") {
      state.flowDepth = Math.max(0, state.flowDepth - 1);
    }

    index++;
  }

  return line;
};

// `key:` or `- ` — the shapes whose indentation decides the document's tree.
const BLOCK_NODE_START: RegExp = /^(?:-(?:\s|$)|[^\s#].*?:(?:\s|$))/;

// A trailing `|`, `>`, with optional chomping and explicit-indent indicators.
const BLOCK_SCALAR_HEADER: RegExp = /(?:^|\s)[|>][+-]?[0-9]*[+-]?\s*$/;

type FindTabIndentationFunction = (
  text: string,
) => TabIndentationFinding | null;

const findTabIndentation: FindTabIndentationFunction = (
  text: string,
): TabIndentationFinding | null => {
  const lines: Array<string> = text.split("\n");
  const state: LineScanState = { flowDepth: 0, openQuote: null };

  let blockScalarIndent: number | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    // Tolerate CRLF: the \r is not indentation and must not shift a column.
    const line: string = (lines[index] || "").replace(/\r$/, "");
    const indentation: string = line.match(/^[ \t]*/)?.[0] || "";
    const isBlank: boolean = line.trim() === "";

    if (blockScalarIndent !== null) {
      // Blank lines and anything indented past the header stay inside it.
      if (isBlank || indentation.length > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = null;
    }

    if (isBlank) {
      continue;
    }

    const wasInsideQuote: boolean = state.openQuote !== null;
    const insideFlow: boolean = state.flowDepth > 0;
    const code: string = scanLine(line, state);

    /*
     * Only judge lines that begin a block node in block context. A
     * continuation of a quoted scalar, or a line inside `{}`/`[]`, may hold a
     * leading tab legally.
     */
    if (
      !wasInsideQuote &&
      !insideFlow &&
      indentation.includes("\t") &&
      BLOCK_NODE_START.test(line.slice(indentation.length))
    ) {
      return {
        line: index + 1,
        column: indentation.indexOf("\t") + 1,
      };
    }

    if (
      state.openQuote === null &&
      state.flowDepth === 0 &&
      BLOCK_SCALAR_HEADER.test(code)
    ) {
      blockScalarIndent = indentation.length;
    }
  }

  return null;
};

export type CheckYamlSyntaxFunction = (value: unknown) => YamlSyntaxCheckResult;

/**
 * Parse `value` as YAML and report whether it is well formed.
 */
export const checkYamlSyntax: CheckYamlSyntaxFunction = (
  value: unknown,
): YamlSyntaxCheckResult => {
  const skipped: YamlSyntaxCheckResult = {
    isValid: true,
    errorMessage: null,
    wasSkipped: true,
    line: null,
    column: null,
  };

  // Not a string: nothing was typed into an editor, so there is no text to parse.
  if (typeof value !== "string") {
    return skipped;
  }

  // Empty is the job of the required-field check, not this one.
  if (value.trim() === "") {
    return skipped;
  }

  /*
   * A handlebars loop emits its body once per array element, so the document's
   * indentation depends on data that only exists at run time.
   */
  if (hasEachBlock(value)) {
    return skipped;
  }

  const masked: string = maskTemplateExpressions(value);

  /*
   * Before the parse, not after: js-yaml ACCEPTS tab indentation and returns a
   * silently restructured document, so there is no exception to catch.
   */
  const tab: TabIndentationFinding | null = findTabIndentation(masked);

  if (tab) {
    return {
      isValid: false,
      errorMessage: "a tab character cannot be used for indentation",
      wasSkipped: false,
      line: tab.line,
      column: tab.column,
    };
  }

  try {
    /*
     * loadAll, not load: a YAML stream may hold several `---` separated
     * documents and load() rejects the second one. The parsed values are
     * discarded - only the syntax is being judged here.
     */
    yaml.loadAll(masked);

    return {
      isValid: true,
      errorMessage: null,
      wasSkipped: false,
      line: null,
      column: null,
    };
  } catch (err: unknown) {
    const { line, column } = readMark(err);

    return {
      isValid: false,
      errorMessage: readReason(err),
      wasSkipped: false,
      line,
      column,
    };
  }
};

export type DescribeYamlSyntaxErrorFunction = (
  result: YamlSyntaxCheckResult,
) => string;

/**
 * "bad indentation of a mapping entry (line 4, column 3)" - the one-line
 * sentence both the form error and the editor status bar are built from.
 */
export const describeYamlSyntaxError: DescribeYamlSyntaxErrorFunction = (
  result: YamlSyntaxCheckResult,
): string => {
  const reason: string = result.errorMessage || "Invalid YAML.";

  if (result.line === null) {
    return reason;
  }

  if (result.column === null) {
    return `${reason} (line ${result.line})`;
  }

  return `${reason} (line ${result.line}, column ${result.column})`;
};
