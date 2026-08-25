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
