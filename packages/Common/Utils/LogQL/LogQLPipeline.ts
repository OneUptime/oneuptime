import {
  LogQLComparison,
  LogQLLabelFilterExpression,
  LogQLLineFilterOperator,
  LogQLLogSelector,
  LogQLParserKind,
  LogQLStage,
  LogQLTemplatePart,
  LogQLUnwrap,
  LogQLUnwrapConversion,
  LogQLValueKind,
} from "./LogQLAst";
import { toLogQLLabelName } from "./LogQLLabels";
import { parseLogQLBytes, parseLogQLDuration } from "./LogQLValues";
import { PromQLLabelMatcher } from "../PromQL/PromQLAst";
import PromQLError, { PromQLErrorType } from "../PromQL/PromQLError";
import {
  PromQLLabels,
  PromQLLabelsTest,
  compilePromQLMatchers,
  promQLLabelValue,
} from "../PromQL/PromQLLabels";
import { CompiledPromQLRegex, compilePromQLRegex } from "../PromQL/PromQLRegex";
import { copyOwnValues, writeOwnValue } from "../LookupTable";

/*
 * A LogQL pipeline run over one log at a time (issue #7700), stage by
 * stage, as Loki runs it (pkg/logql/log): line filters keep or drop the
 * line, | json and | logfmt add the fields they find as labels, label
 * filters keep or drop by them, line_format rewrites the line, drop and keep
 * trim the labels. What a stage cannot read is said on the log itself, as
 * Loki says it, in __error__ and __error_details__ (JSONParserErr,
 * LogfmtParserErr, LabelFilterErr, SampleExtractionErr), for a later
 * `| __error__=""` to leave out.
 */

export const LOGQL_ERROR_LABEL: string = "__error__";
export const LOGQL_ERROR_DETAILS_LABEL: string = "__error_details__";

export interface LogQLPipelineResult {
  line: string;
  labels: PromQLLabels;
}

type CompiledStage = (entry: LogQLPipelineResult) => boolean;

// An ANSI escape sequence (ESC, "[", parameters, a letter): a terminal's colours.
const ANSI_ESCAPES: RegExp = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`,
  "g",
);

const setError: (
  labels: PromQLLabels,
  error: string,
  details: string,
) => void = (labels: PromQLLabels, error: string, details: string): void => {
  // The first error a log meets is the one it keeps, as in Loki.
  if (promQLLabelValue(labels, LOGQL_ERROR_LABEL)) {
    return;
  }

  labels[LOGQL_ERROR_LABEL] = error;
  labels[LOGQL_ERROR_DETAILS_LABEL] = details;
};

/*
 * A label a parser found, under its LogQL name: `_extracted` after it when
 * the log already has that label, as Loki keeps the stream's own.
 */
const addExtracted: (
  labels: PromQLLabels,
  original: PromQLLabels,
  name: string,
  value: string,
) => void = (
  labels: PromQLLabels,
  original: PromQLLabels,
  name: string,
  value: string,
): void => {
  const label: string = toLogQLLabelName(name);

  if (!label) {
    return;
  }

  const target: string = Object.prototype.hasOwnProperty.call(original, label)
    ? `${label}_extracted`
    : label;

  writeOwnValue(labels, target, value);
};

/*
 * A JSON line's fields: nested objects joined with `_`, arrays left out, a
 * value as its text.
 */
const flattenJson: (
  value: unknown,
  prefix: string,
  into: Array<[string, string]>,
) => void = (
  value: unknown,
  prefix: string,
  into: Array<[string, string]>,
): void => {
  if (value === null || value === undefined || Array.isArray(value)) {
    return;
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      flattenJson(
        (value as Record<string, unknown>)[key],
        prefix ? `${prefix}_${key}` : key,
        into,
      );
    }
    return;
  }

  if (prefix) {
    into.push([prefix, String(value)]);
  }
};

/*
 * A logfmt line's pairs, read as go-logfmt reads them: key=value,
 * key="quoted value" with escapes, and a bare key, whose value is empty.
 * Throws for a line that is not logfmt: an unclosed quote, a key that
 * starts with "=".
 */
export const parseLogfmt: (line: string) => Array<[string, string]> = (
  line: string,
): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  let position: number = 0;

  const isSpace: (character: string | undefined) => boolean = (
    character: string | undefined,
  ): boolean => {
    return (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    );
  };

  while (position < line.length) {
    while (isSpace(line[position])) {
      position++;
    }

    if (position >= line.length) {
      break;
    }

    if (line[position] === "=") {
      throw new Error(`unexpected '=' at position ${position + 1}`);
    }

    const keyStart: number = position;

    while (
      position < line.length &&
      !isSpace(line[position]) &&
      line[position] !== "=" &&
      line[position] !== '"'
    ) {
      position++;
    }

    const key: string = line.slice(keyStart, position);

    if (line[position] === '"') {
      throw new Error(`unexpected '"' at position ${position + 1}`);
    }

    if (line[position] !== "=") {
      pairs.push([key, ""]);
      continue;
    }

    position++;

    if (line[position] === '"') {
      position++;
      let value: string = "";
      let closed: boolean = false;

      while (position < line.length) {
        const character: string = line[position]!;

        if (character === "\\" && position + 1 < line.length) {
          const next: string = line[position + 1]!;
          value +=
            next === "n"
              ? "\n"
              : next === "t"
                ? "\t"
                : next === "r"
                  ? "\r"
                  : next;
          position += 2;
          continue;
        }

        if (character === '"') {
          closed = true;
          position++;
          break;
        }

        value += character;
        position++;
      }

      if (!closed) {
        throw new Error("unterminated quoted value");
      }

      pairs.push([key, value]);
      continue;
    }

    const valueStart: number = position;

    while (position < line.length && !isSpace(line[position])) {
      position++;
    }

    pairs.push([key, line.slice(valueStart, position)]);
  }

  return pairs;
};

const compileLineFilter: (stage: {
  operator: LogQLLineFilterOperator;
  values: Array<string>;
}) => CompiledStage = (stage: {
  operator: LogQLLineFilterOperator;
  values: Array<string>;
}): CompiledStage => {
  const matches: Array<(line: string) => boolean> = stage.values.map(
    (value: string): ((line: string) => boolean) => {
      if (
        stage.operator === LogQLLineFilterOperator.Matches ||
        stage.operator === LogQLLineFilterOperator.NotMatches
      ) {
        // A line filter's pattern matches anywhere in the line.
        const compiled: CompiledPromQLRegex = compilePromQLRegex(
          `.*(?:${value}).*`,
        );
        return (line: string): boolean => {
          return compiled.test(line);
        };
      }

      return (line: string): boolean => {
        return line.includes(value);
      };
    },
  );
  const keepsMatches: boolean =
    stage.operator === LogQLLineFilterOperator.Contains ||
    stage.operator === LogQLLineFilterOperator.Matches;

  return (entry: LogQLPipelineResult): boolean => {
    const matched: boolean = matches.some(
      (match: (line: string) => boolean): boolean => {
        return match(entry.line);
      },
    );

    return keepsMatches ? matched : !matched;
  };
};

// A label's value as the number a comparison reads, or why it is none.
const readNumber: (
  value: string,
  kind: LogQLValueKind,
) => { value: number } | { error: string } = (
  value: string,
  kind: LogQLValueKind,
): { value: number } | { error: string } => {
  if (kind === LogQLValueKind.Duration) {
    const seconds: number | undefined = parseLogQLDuration(value);
    return seconds === undefined
      ? { error: `time: invalid duration "${value}"` }
      : { value: seconds };
  }

  if (kind === LogQLValueKind.Bytes) {
    const bytes: number | undefined = parseLogQLBytes(value);
    return bytes === undefined
      ? { error: `strconv.ParseFloat: parsing "${value}": invalid syntax` }
      : { value: bytes };
  }

  const number: number = Number(value);

  return value.trim() === "" || Number.isNaN(number)
    ? { error: `strconv.ParseFloat: parsing "${value}": invalid syntax` }
    : { value: number };
};

const compare: (
  left: number,
  comparison: LogQLComparison,
  right: number,
) => boolean = (
  left: number,
  comparison: LogQLComparison,
  right: number,
): boolean => {
  switch (comparison) {
    case LogQLComparison.Equal:
      return left === right;
    case LogQLComparison.NotEqual:
      return left !== right;
    case LogQLComparison.Greater:
      return left > right;
    case LogQLComparison.GreaterOrEqual:
      return left >= right;
    case LogQLComparison.Less:
      return left < right;
    case LogQLComparison.LessOrEqual:
      return left <= right;
  }
};

const compileLabelFilter: (
  expression: LogQLLabelFilterExpression,
) => CompiledStage = (
  expression: LogQLLabelFilterExpression,
): CompiledStage => {
  switch (expression.kind) {
    case "And": {
      const left: CompiledStage = compileLabelFilter(expression.left);
      const right: CompiledStage = compileLabelFilter(expression.right);
      return (entry: LogQLPipelineResult): boolean => {
        return left(entry) && right(entry);
      };
    }
    case "Or": {
      const left: CompiledStage = compileLabelFilter(expression.left);
      const right: CompiledStage = compileLabelFilter(expression.right);
      return (entry: LogQLPipelineResult): boolean => {
        return left(entry) || right(entry);
      };
    }
    case "Match": {
      const test: PromQLLabelsTest = compilePromQLMatchers([
        expression.matcher as PromQLLabelMatcher,
      ]);
      return (entry: LogQLPipelineResult): boolean => {
        return test(entry.labels);
      };
    }
    case "Compare": {
      return (entry: LogQLPipelineResult): boolean => {
        const read: { value: number } | { error: string } = readNumber(
          promQLLabelValue(entry.labels, expression.label),
          expression.valueKind,
        );

        // A value it cannot read keeps the line, with the error on it.
        if ("error" in read) {
          setError(entry.labels, "LabelFilterErr", read.error);
          return true;
        }

        return compare(read.value, expression.comparison, expression.value);
      };
    }
  }
};

const fillTemplate: (
  parts: Array<LogQLTemplatePart>,
  entry: LogQLPipelineResult,
) => string = (
  parts: Array<LogQLTemplatePart>,
  entry: LogQLPipelineResult,
): string => {
  return parts
    .map((part: LogQLTemplatePart): string => {
      if ("text" in part) {
        return part.text;
      }

      return part.label === "__line__"
        ? entry.line
        : promQLLabelValue(entry.labels, part.label);
    })
    .join("");
};

const compileStage: (stage: LogQLStage) => CompiledStage = (
  stage: LogQLStage,
): CompiledStage => {
  switch (stage.kind) {
    case "LineFilter":
      return compileLineFilter(stage);
    case "Parser":
      return (entry: LogQLPipelineResult): boolean => {
        const original: PromQLLabels = copyOwnValues(entry.labels);

        if (stage.parser === LogQLParserKind.Json) {
          let parsed: unknown;

          try {
            parsed = JSON.parse(entry.line);
          } catch (error: unknown) {
            setError(
              entry.labels,
              "JSONParserErr",
              error instanceof Error ? error.message : String(error),
            );
            return true;
          }

          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            setError(
              entry.labels,
              "JSONParserErr",
              "the line is not a JSON object",
            );
            return true;
          }

          const fields: Array<[string, string]> = [];
          flattenJson(parsed, "", fields);

          for (const [name, value] of fields) {
            addExtracted(entry.labels, original, name, value);
          }

          return true;
        }

        let pairs: Array<[string, string]>;

        try {
          pairs = parseLogfmt(entry.line);
        } catch (error: unknown) {
          setError(
            entry.labels,
            "LogfmtParserErr",
            `logfmt syntax error: ${error instanceof Error ? error.message : String(error)}`,
          );
          return true;
        }

        for (const [name, value] of pairs) {
          addExtracted(entry.labels, original, name, value);
        }

        return true;
      };
    case "LabelFilter":
      return compileLabelFilter(stage.expression);
    case "LineFormat":
      return (entry: LogQLPipelineResult): boolean => {
        entry.line = fillTemplate(stage.parts, entry);
        return true;
      };
    case "Drop":
      return (entry: LogQLPipelineResult): boolean => {
        for (const label of stage.labels) {
          delete entry.labels[label];
        }
        return true;
      };
    case "Keep":
      return (entry: LogQLPipelineResult): boolean => {
        for (const label of Object.keys(entry.labels)) {
          if (!stage.labels.includes(label)) {
            delete entry.labels[label];
          }
        }
        return true;
      };
    case "Decolorize":
      return (entry: LogQLPipelineResult): boolean => {
        entry.line = entry.line.replace(ANSI_ESCAPES, "");
        return true;
      };
  }
};

/*
 * A selector's matchers and pipeline, compiled once for every log a query
 * reads: run returns the log as the pipeline leaves it, or null when it is
 * left out.
 */
export class LogQLPipeline {
  private readonly matches: PromQLLabelsTest;
  private readonly stages: Array<CompiledStage>;

  public constructor(selector: LogQLLogSelector) {
    this.matches = compilePromQLMatchers(selector.matchers);
    this.stages = selector.stages.map(compileStage);
  }

  public run(data: {
    line: string;
    labels: PromQLLabels;
  }): LogQLPipelineResult | null {
    if (!this.matches(data.labels)) {
      return null;
    }

    const entry: LogQLPipelineResult = {
      line: data.line,
      labels: copyOwnValues(data.labels),
    };

    for (const stage of this.stages) {
      if (!stage(entry)) {
        return null;
      }
    }

    return entry;
  }
}

/*
 * An unwrapped label's value, as a sample: its label taken off the log's
 * labels (each value would be a series of its own), then the filters after
 * the unwrap. A value it cannot read is said in __error__, as Loki says it
 * (SampleExtractionErr); null when a filter leaves the log out.
 */
export class LogQLUnwrapper {
  private readonly unwrap: LogQLUnwrap;
  private readonly filters: Array<CompiledStage>;

  public constructor(unwrap: LogQLUnwrap) {
    this.unwrap = unwrap;
    this.filters = unwrap.stages.map(compileStage);
  }

  public sample(
    entry: LogQLPipelineResult,
  ): { value: number; labels: PromQLLabels } | null {
    const raw: string = promQLLabelValue(entry.labels, this.unwrap.label);
    let value: number | undefined;

    if (this.unwrap.conversion === LogQLUnwrapConversion.Duration) {
      value = parseLogQLDuration(raw);
    } else if (this.unwrap.conversion === LogQLUnwrapConversion.Bytes) {
      value = parseLogQLBytes(raw);
    } else {
      const number: number = Number(raw);
      value = raw.trim() === "" || Number.isNaN(number) ? undefined : number;
    }

    const labels: PromQLLabels = copyOwnValues(entry.labels);
    delete labels[this.unwrap.label];

    if (value === undefined) {
      setError(
        labels,
        "SampleExtractionErr",
        `strconv.ParseFloat: parsing "${raw}": invalid syntax`,
      );
    }

    const filtered: LogQLPipelineResult = { line: entry.line, labels };

    for (const filter of this.filters) {
      if (!filter(filtered)) {
        return null;
      }
    }

    return { value: value ?? 0, labels: filtered.labels };
  }
}

/*
 * A metric query reads no log with an error left on it, as Loki refuses
 * one: say which, and how to leave such logs out.
 */
export const assertNoPipelineError: (labels: PromQLLabels) => void = (
  labels: PromQLLabels,
): void => {
  const error: string = promQLLabelValue(labels, LOGQL_ERROR_LABEL);

  if (!error) {
    return;
  }

  const series: string = `{${Object.keys(labels)
    .sort()
    .map((name: string): string => {
      return `${name}=${JSON.stringify(labels[name])}`;
    })
    .join(", ")}}`;

  throw new PromQLError(
    `pipeline error: '${error}' for series: '${series}'. Use a label filter to intentionally skip this error. (e.g | __error__!="${error}"). To skip all potential errors you can match empty errors.(e.g __error__="") The label filter can also be specified after unwrap. (e.g | unwrap latency | __error__="" )`,
    PromQLErrorType.BadData,
  );
};
