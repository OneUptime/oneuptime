import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "./ForeignHiddenRuleGuard";

/*
 * Where a date and time field could show or ask for seconds
 * (MinutePickersGuard, issue #7593).
 *
 * A customer scheduling on-call shifts found the pickers down to the second:
 * Add User Override's Starts read "13/11/2026 11:15:52" and a layer's
 * Rotation starts at "11/11/2026 08:00:17", with a seconds column in the
 * browser's picker. Nobody schedules a shift to the second. The shared Input
 * drew a datetime-local value with its seconds, and a value with seconds
 * makes the browser show and ask for them.
 *
 * So a date and time field people fill in shows and keeps hours and minutes
 * (OneUptimeDate.toDateTimeLocalMinuteString), and a field that needs the
 * seconds - a telemetry time range, compared with event timestamps - says so
 * by opting in (Input's showSecondsForDateTime), with its reason in
 * SECONDS_OPT_IN_FILES. This finds, through the TypeScript AST (so a comment
 * that names one is not a finding):
 *
 *   - every opt-in to seconds: showSecondsForDateTime given anything but
 *     false, as a JSX attribute or as a property of an object of props;
 *   - every browser datetime-local input of its own (<input
 *     type="datetime-local">), which the shared Input does not draw, so it
 *     has to keep to the minute by itself (RAW_DATE_TIME_INPUT_FILES says
 *     how) - and one with a step, which can ask for seconds;
 *   - every call to OneUptimeDate.toDateTimeLocalString, the value to the
 *     second, which only the shared Input may use, behind the opt-in.
 */

export enum DateTimeFieldSiteKind {
  SecondsOptIn = "showSecondsForDateTime",
  RawDateTimeInput = "<input type=datetime-local>",
  RawDateTimeInputStep = "<input type=datetime-local step>",
  SecondsValue = "toDateTimeLocalString",
}

export interface DateTimeFieldSite {
  kind: DateTimeFieldSiteKind;
  // 1-based.
  line: number;
  // The node as written.
  text: string;
}

export interface DateTimeFieldFinding extends DateTimeFieldSite {
  // Relative to the repository root, with forward slashes.
  file: string;
}

// The shared Input: the one field that draws a value to the second, when asked.
export const SHARED_INPUT_FILE: string =
  "packages/Common/UI/Components/Input/Input.tsx";

/*
 * Every field that shows seconds, and why. A time people schedule or record
 * something at is picked to the minute; only a time compared with event
 * timestamps to the second keeps them.
 */
export const SECONDS_OPT_IN_FILES: Record<string, string> = {
  "packages/Common/UI/Components/Date/CustomTimeRangeModal.tsx":
    "the custom range of a telemetry time range picker (logs, traces, metrics, dashboards): it is read against telemetry's own timestamps, and a range around one error or one span is seconds wide",
  "packages/Common/UI/Components/Date/StartAndEndDate.tsx":
    "From and To of a telemetry time range (the infrastructure overviews, Kubernetes, public dashboards): read against the timestamps of logs, traces and metrics, which a narrowed range can be seconds wide around",
};

/*
 * Every browser datetime-local input the shared Input does not draw, and how
 * it keeps to the minute - with the text in its file that does it, which the
 * guard checks is still there.
 */
export interface RawDateTimeInputFile {
  how: string;
  // Text the file holds that keeps its value to the minute.
  keepsToTheMinuteWith: string;
}

export const RAW_DATE_TIME_INPUT_FILES: Record<string, RawDateTimeInputFile> = {
  "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer.tsx":
    {
      how: "a note's Posted at: its value is EventNotesUtil.toDateTimeInputValue, the wall clock to the minute",
      keepsToTheMinuteWith: "toDateTimeInputValue(",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnostics.tsx":
    {
      how: "a historical import's Start and End: its value is localDateInput, an ISO string cut at the minute",
      keepsToTheMinuteWith: ".slice(0, 16)",
    },
};

// `x`, `(x)`, `x!` and `x as T` are all `x`.
function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// A value written as `false`: an opt-in turned off is not one.
function isWrittenFalse(expression: ts.Expression | undefined): boolean {
  return Boolean(
    expression && unwrap(expression).kind === ts.SyntaxKind.FalseKeyword,
  );
}

// The string a JSX attribute is given, when it is written as one.
function attributeText(attribute: ts.JsxAttribute): string | null {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return null;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expression: ts.Expression = unwrap(initializer.expression);

    if (ts.isStringLiteralLike(expression)) {
      return expression.text;
    }
  }

  return null;
}

function attributeName(attribute: ts.JsxAttribute): string {
  return attribute.name.getText();
}

function findAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | null {
  for (const property of attributes.properties) {
    if (ts.isJsxAttribute(property) && attributeName(property) === name) {
      return property;
    }
  }

  return null;
}

/*
 * Every date and time field site in one module's source: opt-ins to seconds,
 * browser datetime-local inputs of its own, and values to the second.
 */
export function findDateTimeFieldSites(
  fileName: string,
  source: string,
): Array<DateTimeFieldSite> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const sites: Array<DateTimeFieldSite> = [];

  const record: (kind: DateTimeFieldSiteKind, node: ts.Node) => void = (
    kind: DateTimeFieldSiteKind,
    node: ts.Node,
  ): void => {
    sites.push({
      kind: kind,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      attributeName(node) === DateTimeFieldSiteKind.SecondsOptIn
    ) {
      const initializer: ts.JsxAttributeValue | undefined = node.initializer;
      const writtenFalse: boolean = Boolean(
        initializer &&
          ts.isJsxExpression(initializer) &&
          isWrittenFalse(initializer.expression),
      );

      if (!writtenFalse) {
        record(DateTimeFieldSiteKind.SecondsOptIn, node);
      }
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === DateTimeFieldSiteKind.SecondsOptIn &&
      !isWrittenFalse(node.initializer)
    ) {
      record(DateTimeFieldSiteKind.SecondsOptIn, node);
    } else if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === DateTimeFieldSiteKind.SecondsOptIn
    ) {
      record(DateTimeFieldSiteKind.SecondsOptIn, node);
    } else if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "input"
    ) {
      const type: ts.JsxAttribute | null = findAttribute(
        node.attributes,
        "type",
      );

      if (type && attributeText(type) === "datetime-local") {
        record(DateTimeFieldSiteKind.RawDateTimeInput, node);

        const step: ts.JsxAttribute | null = findAttribute(
          node.attributes,
          "step",
        );

        if (step) {
          record(DateTimeFieldSiteKind.RawDateTimeInputStep, step);
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(unwrap(node.expression)) &&
      (unwrap(node.expression) as ts.PropertyAccessExpression).name.text ===
        DateTimeFieldSiteKind.SecondsValue
    ) {
      record(DateTimeFieldSiteKind.SecondsValue, node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return sites;
}

// Every browser module the guard reads (ForeignHiddenRuleGuard's roots).
export function listDateTimeFieldScanFiles(
  repositoryRoot: string,
): Array<string> {
  return listScanRoots(repositoryRoot).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );
}

export function scanDateTimeFields(
  repositoryRoot: string,
  files: Array<string>,
): Array<DateTimeFieldFinding> {
  return files.flatMap((file: string): Array<DateTimeFieldFinding> => {
    const relative: string = toRelativePath(repositoryRoot, file);

    return findDateTimeFieldSites(file, fs.readFileSync(file, "utf8")).map(
      (site: DateTimeFieldSite): DateTimeFieldFinding => {
        return { ...site, file: relative };
      },
    );
  });
}

/*
 * What breaks the rule: an opt-in to seconds, or a raw input stepping by
 * less than a minute, in a file with no reason listed; a raw datetime-local
 * input in a file that does not say how it keeps to the minute; a value to
 * the second anywhere but the shared Input.
 */
export function disallowedDateTimeFields(
  findings: Array<DateTimeFieldFinding>,
): Array<DateTimeFieldFinding> {
  const listed: (table: Record<string, unknown>, file: string) => boolean = (
    table: Record<string, unknown>,
    file: string,
  ): boolean => {
    return Object.prototype.hasOwnProperty.call(table, file);
  };

  return findings.filter((finding: DateTimeFieldFinding): boolean => {
    switch (finding.kind) {
      case DateTimeFieldSiteKind.SecondsOptIn:
      case DateTimeFieldSiteKind.RawDateTimeInputStep:
        return !listed(SECONDS_OPT_IN_FILES, finding.file);
      case DateTimeFieldSiteKind.RawDateTimeInput:
        return !listed(RAW_DATE_TIME_INPUT_FILES, finding.file);
      case DateTimeFieldSiteKind.SecondsValue:
        return finding.file !== SHARED_INPUT_FILE;
      default:
        return true;
    }
  });
}

export function formatDateTimeFieldFindings(
  findings: Array<DateTimeFieldFinding>,
): string {
  if (findings.length === 0) {
    return "";
  }

  return [
    `${findings.length} date and time field(s) that could show or ask for seconds:`,
    ...findings.map((finding: DateTimeFieldFinding): string => {
      return `  ${finding.file}:${finding.line}  [${finding.kind}]  ${finding.text}`;
    }),
    "",
    "A date and time people schedule or record something at is shown and kept",
    "in hours and minutes (#7593): draw it with the shared Input",
    "(type InputType.DATETIME_LOCAL), which shows",
    "OneUptimeDate.toDateTimeLocalMinuteString, and leave showSecondsForDateTime",
    "out. A field that is compared with event timestamps to the second - a",
    "telemetry time range - may opt in: add its file and the reason to",
    "SECONDS_OPT_IN_FILES in packages/Common/Tests/MinutePickers.ts. A browser",
    "<input type=datetime-local> of its own needs its entry in",
    "RAW_DATE_TIME_INPUT_FILES, saying how its value keeps to the minute.",
  ].join("\n");
}

// packages/Common/Tests -> the repository root.
export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);
