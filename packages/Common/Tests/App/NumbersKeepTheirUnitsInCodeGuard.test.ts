// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { ENGLISH_DURATION_WORDS } from "../../Types/NoBreakSpaces";
import { escapeRegExp } from "../../Utils/RegExpEscape";
import { listSourceFiles, toRelativePath } from "../ForeignHiddenRuleGuard";

/*
 * A NUMBER CODE JOINS TO ITS UNIT KEEPS IT ON ITS LINE (#8303).
 *
 * A line may break at any plain space. #8043 set every translated
 * sentence's number with its unit (NumbersKeepTheirUnitsGuard), and #8302
 * English's own; but code that writes the figure and the unit itself -
 * `${value} ms`, `${size} MB`, `${temperature} °C` - joined them with a
 * plain space, so a narrow tile or cell could end a line with "12.5" and
 * start the next with "MB".
 *
 * This reads the shared UI, the shared helpers, the shared types and the
 * Dashboard through the TypeScript AST (a comment is no code) and fails on a
 * template whose figure is followed by a space a line breaks at and a unit's
 * symbol, or by such a space and a unit picked from a list (`${size}
 * ${units[index]}`, the byte formatters' "MiB" and "GiB"), and on a figure
 * joined with + to a string that starts so (`value + " ms"`). Code
 * joins them with a no-break space (`${size}\u00A0MB`) or writes them
 * through a key (formatMilliseconds), where the Translator holds them.
 *
 * A UNIT HELD IN A VARIABLE (#8457). The charts' and tables' formatters
 * hold the unit in a variable or a property - `${formatted} ${unit}`,
 * `${figure} ${reading.unit}` - and so passed the scan while every chart,
 * table and Kubernetes or OpenStack figure joined them with a plain space.
 * The same shape writes words too ("5 minutes" is `${count} ${unit}s`), so
 * a holder is told apart by its name and by what follows it: one named
 * `unit` or `symbol` (`unitSymbol`, `reading.symbol`), right after a figure
 * and a plain space, is a unit's symbol, unless the template goes on to
 * spell a word with it (`${unit}s`, `${unit}${count === 1 ? "" : "s"}`). A
 * word held so is named for what it holds - `word`, `noun`, `unitName` -
 * and keeps its plain space, as any word does.
 *
 * Text that is no page's keeps its plain space - a prompt, a Markdown
 * export, a stored description - each file listed in AS_WRITTEN with why.
 * A file another issue rewords whole is listed in OWNED_ELSEWHERE with
 * that issue. Both lists only shrink: a listed file that no longer joins a
 * figure to a unit with a plain space fails until it is taken off.
 *
 * Intl writes a plain space between a number and its unit too ("5 Min.",
 * "vor 5 Minuten", #8456), and Common/Types/DateLanguage holds it: its
 * formatUnitAmount, getUnitAmountParts, formatDurationUnit,
 * formatDurationText, formatRelativeAmount and formatRelativeDate read
 * Intl's parts and write a no-break space there. So no other code asks
 * Intl for a unit (an options object with `style: "unit"`) or a relative
 * time (Intl.RelativeTimeFormat, by any name): the second half of this
 * file reads every package and ee for one, outside DateLanguage itself and
 * the files listed in INTL_OWNED_ELSEWHERE, a list that only shrinks.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * The source read, relative to the repository (ee/ is not in every
 * checkout). Common/Types is drawn on pages too: a file's size, a web
 * vital, an installation's health (#8457). So are the Admin Dashboard's
 * and the Status Page's own sources, and what the server writes for a page
 * or a person to read: an email, a notification, an API's refusal (#8720).
 */
const SCAN_SCOPES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/Common/Server",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

/*
 * What the server writes that keeps its plain space (#8720): text it logs,
 * stores or sends to a machine, read back or matched as written. A form's
 * or a search's refusal, which a person reads where they typed it, is held.
 */
const SERVER_LOG: string = "a line of the server's own log";
const SQL: string = "a SQL statement the server runs";
const FOR_THE_AI: string =
  "text for OneUptime AI to read: a prompt, a tool's answer, an insight's evidence";
const STORED_RESULT: string =
  "a check's or a criteria's result, stored with it and shown as it was written";

// Files whose text is no page's, each with what it writes.
const AS_WRITTEN: Readonly<Record<string, string>> = {
  "packages/Common/Server/Infrastructure/Postgres/CancelOnTimeoutClient.ts":
    SERVER_LOG,
  "packages/Common/Server/Infrastructure/Postgres/OnlineDdl.ts": SERVER_LOG,
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrationRunner.ts":
    SERVER_LOG,
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrationWait.ts":
    SERVER_LOG,
  "packages/Common/Server/Utils/RateLimit/WrongKeyLimit.ts": SERVER_LOG,
  "packages/Common/Server/Utils/Telemetry/SpanExportQueue.ts": SERVER_LOG,
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsActivityDeduplicator.ts":
    SERVER_LOG,
  "packages/Common/Server/Utils/Aws/AwsDefaultCredentialChain.ts":
    "a credential chain's failure, logged and stored on the connection",
  "packages/Common/Server/Utils/CloudConnection/Kafka/KafkaClient.ts":
    "a Kafka connection's failure, stored as the connection's last error",
  "packages/Common/Server/Utils/LLM/LLMService.ts":
    "an LLM provider's failure, logged and stored on the provider",
  "packages/Common/Server/Utils/AI/Mcp/McpHttpTransport.ts":
    "an external MCP server's failure, stored on the server and read by the AI agent",
  "packages/Common/Server/Types/AnalyticsDatabase/AggregateBy.ts": SQL,
  "packages/Common/Server/Types/Database/QueryHelper.ts": SQL,
  "packages/Common/Server/Utils/Monitor/CountWindowBaseline.ts": SQL,
  "packages/Common/Server/Utils/AI/SRE/ChangeImpact.ts": FOR_THE_AI,
  "packages/Common/Server/Utils/AI/SRE/Insights/Detectors/TraceLatencyRegressionDetector.ts":
    FOR_THE_AI,
  "packages/Common/Server/Utils/AI/TelemetryAi/ExceptionExplanationPrompt.ts":
    FOR_THE_AI,
  "packages/Common/Server/Utils/AI/Toolbox/MetricTools.ts": FOR_THE_AI,
  "packages/Common/Server/Utils/CloudConnection/CloudLiveRead.ts": FOR_THE_AI,
  "packages/Common/Server/Utils/CloudConnection/LiveRead/AwsLiveRead.ts":
    FOR_THE_AI,
  "packages/Common/Server/Utils/DataObservability/AthenaApi.ts": STORED_RESULT,
  "packages/Common/Server/Utils/Monitor/Criteria/SnmpTransceiverCriteria.ts":
    STORED_RESULT,
  "packages/Common/Server/Utils/Monitor/MonitorCriteriaMessageFormatter.ts":
    STORED_RESULT,
  "packages/Common/Server/Utils/Monitor/MonitorCriteriaObservationBuilder.ts":
    STORED_RESULT,
  "packages/Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts":
    "a root cause's response time, stored and read back exactly by RootCauseFacts",
  "packages/Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch.ts":
    "a detection rule's last error, stored on the rule",
  "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewComposer.ts":
    "a production review posted as Markdown on the code host's pull request",
  "packages/Common/Server/Utils/SampleProject/SampleProjectTelemetry.ts":
    "a sample project's logs and spans, stored as telemetry data",
  "packages/Common/Server/Services/TelemetrySourceMapService.ts":
    "the source map upload API's answer to the tool that sent it",
  "packages/Common/Utils/AI/PromptText.ts": "a prompt for OneUptime AI",
  "packages/Common/UI/Utils/AIChatExport/ChatWidgetMarkdown.ts":
    "the AI chat's Markdown export",
  "packages/Common/UI/Components/AI/LlmProviderExchanges.tsx":
    "an LLM provider's exchanges copied as Markdown",
  "packages/Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil.ts":
    "a template's description, stored for an operator to edit",
  "packages/Common/Utils/Suggestions/TracePerformanceFixSuggestion.ts":
    "the API's refusal, in the words the docs quote",
  "packages/Common/Utils/SecurityEvent/TelemetryScan/FlowSignals.ts":
    "a security signal's message, stored by the server's scan",
  "packages/Common/Utils/Slo/SloFeedMarkdown.ts":
    "an SLO feed item the server writes and stores as Markdown",
  "packages/Common/Utils/AuditLog/AuditLogValues.ts":
    "what an audit entry records in place of JSON too large to keep, stored and sent to syslog as written",
  "packages/Common/UI/Utils/AIChatExport/ChatWidgetData.ts":
    "the AI chat's Markdown and PDF exports, in the unit the AI wrote",
  "packages/Common/Types/CloudConnection/CloudAiAgentCost.ts":
    "an estimate's description no page draws: the docs' facts test holds the docs' table to its words",
  "packages/Common/Types/Monitor/NtpMonitor/NtpMonitorUtil.ts":
    "an NTP check's figures, stored in its root cause and read back exactly by RootCauseFacts, which draws them held in the reader's words",
  "packages/Common/Types/Runbook/RunbookWebhook.ts":
    "a runbook webhook's answer to the system that called it",
  "packages/Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack.ts":
    "a pack's criteria description, stored on the monitor for an operator to edit",
  "packages/Common/Types/Monitor/OpenStackAlertTemplates.ts":
    "an alert template's incident title, criteria name and criteria description, stored on the monitor for an operator to edit (the summary and description the picker draws are held)",
  "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName.ts":
    "a criteria's name, stored on the monitor in English and matched against what its filters give (isNameFromFilters) to tell a generated name from a typed one",
};

// Files another issue rewords whole, each with the issue.
const OWNED_ELSEWHERE: Readonly<Record<string, string>> = {
  // The health reasons' units, read in the reader's digits.
  "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephHealth.ts":
    "#7301",
  "packages/App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth.ts":
    "#7301",
  "packages/App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostData.ts":
    "#7301",
  // The request story's durations, in the Dashboard's duration words.
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory.ts":
    "#6889",
  // A span's humanized duration ("12 ms", "1d 2h"), in the reader's units.
  "packages/Common/Types/Date.ts": "#8617",
};

/*
 * The units' symbols, listed here apart from the code (Types/NoBreakSpaces),
 * so a unit the code forgets fails here: a share, a time, a size, a rate, a
 * signal, a frequency, a temperature.
 */
const UNITS: ReadonlyArray<string> = [
  "%",
  "‰",
  "°C",
  "°F",
  "ns",
  "µs",
  "μs",
  "ms",
  "s",
  "sec",
  "secs",
  "m",
  "min",
  "mins",
  "h",
  "hr",
  "hrs",
  "d",
  "w",
  "wk",
  "wks",
  "mo",
  "y",
  "yr",
  "yrs",
  "B",
  "kB",
  "KB",
  "MB",
  "GB",
  "TB",
  "PB",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
  "bps",
  "Kbps",
  "Mbps",
  "Gbps",
  "dB",
  "dBm",
  "Hz",
  "kHz",
  "MHz",
  "GHz",
  "ppm",
  "rpm",
];

const UNIT: string = [...UNITS]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .map((unit: string): string => {
    return escapeRegExp(unit);
  })
  .join("|");

/*
 * A space a line breaks at, then a unit's symbol, and not the start of a
 * longer word ("5 minutes", "min-w-0", "3 sessions").
 */
const PLAIN_SPACE_BEFORE_A_UNIT: RegExp = new RegExp(
  `^[ \\u2000-\\u2006\\u2008-\\u200A\\u205F](?:${UNIT})(?![\\p{L}\\p{N}_-])`,
  "u",
);

// A unit's symbol, not the start of a longer word.
const UNIT_ALONE: RegExp = new RegExp(`(?:${UNIT})(?![\\p{L}\\p{N}_-])`, "u");

const WHITESPACE_RUN: RegExp = /\s+/g;

// A run of spaces a line breaks at, and nothing else.
const ONLY_PLAIN_SPACES: RegExp = /^[ \u2000-\u2006\u2008-\u200A\u205F]+$/;

/*
 * JSX TEXT (#8720). `{figure} dBm` draws the figure, a space and the unit
 * as JSX text, and `{figure} {unit}` and `{figure}{" "}{unit}` a unit held
 * in a variable; a figure written in the text ("up to 10 MB") is one too.
 * A space that starts a new line is no space in JSX (it is left out), so
 * only a space on the figure's own line counts.
 */
const WRITTEN_FIGURE_BEFORE_A_UNIT: RegExp = new RegExp(
  `(?<![\\p{L}\\p{N}_.,])\\p{Nd}+(?:[.,]\\p{Nd}+)*[ ](?:${UNIT})(?![\\p{L}\\p{N}_-])`,
  "u",
);

// A unit picked from a list: `units[index]`, `BYTE_UNITS[unit]`.
const UNIT_FROM_A_LIST: RegExp =
  /^(?:[A-Z_]*UNITS|units)\[[^\]]+\](?:\s*as\s+string|!)?$/;

/*
 * The names a unit's symbol is held under (#8457): `unit`, `symbol`, and a
 * name that ends in Symbol (`unitSymbol`, `UNIT_SYMBOL`).
 */
const UNIT_HOLDER_NAME: RegExp =
  /^(?:unit|symbol|[a-z][A-Za-z0-9]*Symbol|[A-Z][A-Z0-9_]*_SYMBOL)$/;

// What spells a word on from the unit before it: "s", "-based", "_name".
const CONTINUES_A_WORD: RegExp = /^[\p{L}\p{N}_-]/u;

// A figure written in the text, then a space a line breaks at: "more than 0 ".
const ENDS_WITH_A_WRITTEN_FIGURE: RegExp =
  /(?:^|[^\p{L}\p{N}_.,])\p{Nd}+(?:[.,]\p{Nd}+)*[ \u2000-\u2006\u2008-\u200A\u205F]+$/u;

// `expression` without the cast, the `!` or the brackets around it.
const unwrapExpression: (expression: ts.Expression) => ts.Expression = (
  expression: ts.Expression,
): ts.Expression => {
  let inner: ts.Expression = expression;

  while (
    ts.isAsExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isParenthesizedExpression(inner) ||
    ts.isSatisfiesExpression(inner)
  ) {
    inner = inner.expression;
  }

  return inner;
};

/*
 * Whether `expression` holds a unit's symbol by its name: a variable or a
 * property named `unit`, `symbol` or `...Symbol` (`unit`, `data.unit`,
 * `reading.symbol`, `unitSymbol as string`).
 */
const isUnitHolder: (expression: ts.Expression) => boolean = (
  expression: ts.Expression,
): boolean => {
  const inner: ts.Expression = unwrapExpression(expression);

  if (ts.isIdentifier(inner)) {
    return UNIT_HOLDER_NAME.test(inner.text);
  }

  if (ts.isPropertyAccessExpression(inner)) {
    return UNIT_HOLDER_NAME.test(inner.name.text);
  }

  return false;
};

/*
 * Whether `literal`, the text right before a held unit, ends a figure and a
 * plain space: only spaces after a `${figure}` (`${value} ${unit}`), or a
 * figure written in the text (`more than 0 ${unit}`).
 */
const endsWithAFigureAndAPlainSpace: (
  literal: string,
  isAfterAFigure: boolean,
) => boolean = (literal: string, isAfterAFigure: boolean): boolean => {
  return (
    (isAfterAFigure && ONLY_PLAIN_SPACES.test(literal)) ||
    ENDS_WITH_A_WRITTEN_FIGURE.test(literal)
  );
};

/*
 * Whether the template joins a figure to the unit held in `spans[index +
 * 1]` with a plain space: `${figure} ${unit}`, and not `${count} ${unit}s`
 * or `${count} ${unit}${count === 1 ? "" : "s"}`, which spell a word.
 * `spans[-1]` is the template's head: `${unit}` right after "0 ".
 */
const joinsAFigureToAHeldUnit: (
  template: ts.TemplateExpression,
  index: number,
) => boolean = (template: ts.TemplateExpression, index: number): boolean => {
  const spans: ts.NodeArray<ts.TemplateSpan> = template.templateSpans;
  const before: string =
    index < 0
      ? template.head.text
      : (spans[index] as ts.TemplateSpan).literal.text;
  const next: ts.TemplateSpan | undefined = spans[index + 1];

  if (
    !next ||
    !endsWithAFigureAndAPlainSpace(before, index >= 0) ||
    !isUnitHolder(next.expression)
  ) {
    return false;
  }

  if (CONTINUES_A_WORD.test(next.literal.text)) {
    return false;
  }

  // An ending put right after the unit (a plural's "s") spells a word too.
  return !(next.literal.text === "" && spans[index + 2] !== undefined);
};

interface UnitFinding {
  file: string;
  line: number;
  text: string;
}

// Every place `source` joins a figure to a unit with a plain space.
const findPlainSpacesBeforeUnits: (data: {
  file: string;
  source: string;
}) => Array<UnitFinding> = (data: {
  file: string;
  source: string;
}): Array<UnitFinding> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.source,
    ts.ScriptTarget.Latest,
    true,
    data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Array<UnitFinding> = [];

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    findings.push({
      file: data.file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile).replace(WHITESPACE_RUN, " ").slice(0, 120),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isTemplateExpression(node) &&
      (joinsAFigureToAHeldUnit(node, -1) ||
        node.templateSpans.some(
          (span: ts.TemplateSpan, index: number): boolean => {
            const next: ts.TemplateSpan | undefined =
              node.templateSpans[index + 1];

            return (
              PLAIN_SPACE_BEFORE_A_UNIT.test(span.literal.text) ||
              (ONLY_PLAIN_SPACES.test(span.literal.text) &&
                next !== undefined &&
                UNIT_FROM_A_LIST.test(next.expression.getText(sourceFile))) ||
              joinsAFigureToAHeldUnit(node, index)
            );
          },
        ))
    ) {
      report(node);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (ts.isStringLiteral(node.right) ||
        ts.isNoSubstitutionTemplateLiteral(node.right)) &&
      !ts.isStringLiteral(node.left) &&
      PLAIN_SPACE_BEFORE_A_UNIT.test(node.right.text)
    ) {
      report(node);
    }

    // `figure + " " + unit`: a figure, a plain space and a held unit.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      isUnitHolder(node.right) &&
      ts.isBinaryExpression(node.left) &&
      node.left.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (ts.isStringLiteral(node.left.right) ||
        ts.isNoSubstitutionTemplateLiteral(node.left.right)) &&
      ONLY_PLAIN_SPACES.test(node.left.right.text) &&
      !ts.isStringLiteral(node.left.left)
    ) {
      report(node);
    }

    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      for (const child of findJsxFiguresBeforeUnits(node.children)) {
        report(child);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

// A JSX child that is an expression: `{figure}`, `{" "}`, `{unit}`.
const expressionOf: (
  child: ts.JsxChild | undefined,
) => ts.Expression | undefined = (
  child: ts.JsxChild | undefined,
): ts.Expression | undefined => {
  return child && ts.isJsxExpression(child) ? child.expression : undefined;
};

/*
 * The text of a JSX child as JSX draws it: each line trimmed where it meets
 * a line break, the lines left joined by one space. " dBm" starts with a
 * space; a line break and "dBm" does not.
 */
const drawnTextOf: (child: ts.JsxChild | undefined) => string | undefined = (
  child: ts.JsxChild | undefined,
): string | undefined => {
  if (!child || !ts.isJsxText(child)) {
    return undefined;
  }

  const lines: Array<string> = child.text.split("\n");

  if (lines.length === 1) {
    return child.text;
  }

  return lines
    .map((line: string, index: number): string => {
      const start: string = index === 0 ? line : line.trimStart();

      return index === lines.length - 1 ? start : start.trimEnd();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .join(" ");
};

/*
 * The JSX children of an element that draw a figure, a space a line
 * breaks at and a unit: `{figure} dBm`, `{figure} {unit}`, `{figure}{" "}
 * {unit}` and a figure written in the text ("up to 10 MB").
 */
const findJsxFiguresBeforeUnits: (
  children: ts.NodeArray<ts.JsxChild>,
) => Array<ts.JsxChild> = (
  children: ts.NodeArray<ts.JsxChild>,
): Array<ts.JsxChild> => {
  const found: Array<ts.JsxChild> = [];

  children.forEach((child: ts.JsxChild, index: number): void => {
    const next: ts.JsxChild | undefined = children[index + 1];
    const afterNext: ts.JsxChild | undefined = children[index + 2];
    // A held unit the text after it spells a word with: `{count} {unit}s`.
    const spellsAWord: boolean = CONTINUES_A_WORD.test(
      drawnTextOf(children[index + 3]) || "",
    );

    if (ts.isJsxText(child)) {
      if (WRITTEN_FIGURE_BEFORE_A_UNIT.test(drawnTextOf(child) || "")) {
        found.push(child);
      }

      return;
    }

    if (!expressionOf(child)) {
      return;
    }

    // `{figure} dBm`: a space on the figure's line, then a unit's symbol.
    const text: string | undefined = drawnTextOf(next);

    if (text !== undefined && PLAIN_SPACE_BEFORE_A_UNIT.test(text)) {
      found.push(next!);
      return;
    }

    // `{figure} {unit}`: only spaces on the line, then a held unit.
    const held: ts.Expression | undefined = expressionOf(afterNext);

    if (
      text !== undefined &&
      ONLY_PLAIN_SPACES.test(text) &&
      held !== undefined &&
      isUnitHolder(held) &&
      !spellsAWord
    ) {
      found.push(afterNext!);
      return;
    }

    // `{figure}{" "}{unit}` and `{figure}{" "}dBm`.
    const space: ts.Expression | undefined = expressionOf(next);

    if (
      space !== undefined &&
      ts.isStringLiteralLike(space) &&
      ONLY_PLAIN_SPACES.test(space.text) &&
      ((held !== undefined && isUnitHolder(held) && !spellsAWord) ||
        new RegExp(`^${UNIT_ALONE.source}`, "u").test(
          drawnTextOf(afterNext) || "",
        ))
    ) {
      found.push(next!);
    }
  });

  return found;
};

interface ScanResult {
  findings: Array<UnitFinding>;
  filesRead: Record<string, number>;
}

let scanResult: ScanResult | undefined = undefined;

// Every scoped file, read once for all the tests below.
const readAllFindings: () => ScanResult = (): ScanResult => {
  if (scanResult) {
    return scanResult;
  }

  const findings: Array<UnitFinding> = [];
  const filesRead: Record<string, number> = {};

  for (const scope of SCAN_SCOPES) {
    filesRead[scope] = 0;

    for (const filePath of listSourceFiles(path.join(REPOSITORY_ROOT, scope))) {
      const file: string = toRelativePath(REPOSITORY_ROOT, filePath);

      if (file.includes("/Tests/")) {
        continue;
      }

      filesRead[scope] = (filesRead[scope] || 0) + 1;
      findings.push(
        ...findPlainSpacesBeforeUnits({
          file,
          source: fs.readFileSync(filePath, "utf8"),
        }),
      );
    }
  }

  scanResult = { findings, filesRead };

  return scanResult;
};

const isListed: (file: string) => boolean = (file: string): boolean => {
  return AS_WRITTEN[file] !== undefined || OWNED_ELSEWHERE[file] !== undefined;
};

// The line and text of each finding in a made-up source.
const linesOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return findPlainSpacesBeforeUnits({
    file: "packages/App/FeatureSet/Dashboard/src/Made.tsx",
    source,
  }).map((finding: UnitFinding): string => {
    return `${finding.line} ${finding.text}`;
  });
};

describe("a number code joins to its unit keeps it on its line", () => {
  test("no page's code joins a figure to its unit with a plain space", () => {
    const { findings } = readAllFindings();

    expect(
      findings
        .filter((finding: UnitFinding): boolean => {
          return !isListed(finding.file);
        })
        .map((finding: UnitFinding): string => {
          return `${finding.file}:${finding.line} ${finding.text}`;
        }),
    ).toEqual([]);
  });

  test("a listed file still joins one so: the lists only shrink", () => {
    const { findings } = readAllFindings();

    for (const file of [
      ...Object.keys(AS_WRITTEN),
      ...Object.keys(OWNED_ELSEWHERE),
    ]) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        stillJoinsWithAPlainSpace: findings.some(
          (finding: UnitFinding): boolean => {
            return finding.file === file;
          },
        ),
      }).toEqual({ file, exists: true, stillJoinsWithAPlainSpace: true });
    }

    for (const issue of Object.values(OWNED_ELSEWHERE)) {
      expect(issue).toMatch(/^#\d+$/);
    }

    for (const reason of Object.values(AS_WRITTEN)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("the scan reads the shared UI, the shared helpers, the shared types and the Dashboard", () => {
    const { filesRead } = readAllFindings();

    expect(filesRead["packages/Common/UI"]).toBeGreaterThan(500);
    expect(filesRead["packages/Common/Utils"]).toBeGreaterThan(200);
    expect(filesRead["packages/Common/Types"]).toBeGreaterThan(1000);
    // The Admin Dashboard, the Status Page and the server (#8720).
    expect(filesRead["packages/Common/Server"]).toBeGreaterThan(1000);
    expect(
      filesRead["packages/App/FeatureSet/AdminDashboard/src"],
    ).toBeGreaterThan(50);
    expect(filesRead["packages/App/FeatureSet/StatusPage/src"]).toBeGreaterThan(
      50,
    );
    expect(filesRead["packages/App/FeatureSet/Dashboard/src"]).toBeGreaterThan(
      2000,
    );
  });

  test("the figures #8457 named, a unit held in a variable or written in Common/Types, are held now", () => {
    const { findings } = readAllFindings();

    for (const file of [
      // A unit held in a variable or a property.
      "packages/Common/Utils/ValueFormatter.ts",
      "packages/Common/Utils/Dashboard/TableThresholds.ts",
      "packages/Common/Utils/Monitor/MetricValueFormatter.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceQuantity.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackFigures.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableSnapshotCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/WiFi.tsx",
      "packages/App/FeatureSet/Dashboard/src/Utils/ProfileUtil.ts",
      // Common/Types, drawn on a page.
      "packages/Common/Types/File/FileSize.ts",
      "packages/Common/Types/Rum/WebVitals.ts",
      "packages/Common/Types/InstallationHealth/InstallationHealth.ts",
      "packages/Common/Types/DatabaseServer/DatabaseHealth.ts",
      "packages/Common/Types/Telemetry/TelemetryIngestionBudget.ts",
      "packages/Common/Types/PacketCapture/PacketCaptureLimits.ts",
    ]) {
      expect({
        file,
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, found: false });
    }
  });

  test("the figures #8720 named, written as JSX text or in the Admin Dashboard and the server, are held now", () => {
    const { findings } = readAllFindings();

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Pages/IoT/View/Devices.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacity.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySummary.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Health/InstanceHealthLogs.tsx",
      "packages/App/FeatureSet/StatusPage/src/Utils/LiveRefresh.ts",
      "packages/Common/Server/Utils/HostCollector/HostCollectorConfigPolicy.ts",
      "packages/Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistQueryBinder.ts",
      "ee/AdminDashboard/Health/ClickhouseCluster.tsx",
      "ee/AdminDashboard/Health/Overview.tsx",
      "ee/AdminDashboard/Health/PostgresCluster.tsx",
      "ee/AdminDashboard/Health/RedisHealth.tsx",
      "ee/AdminDashboard/Health/TelemetryIngestionUtils.ts",
    ]) {
      if (
        file.startsWith("ee/") &&
        !fs.existsSync(path.join(REPOSITORY_ROOT, file))
      ) {
        continue;
      }

      expect({
        file,
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, found: false });
    }
  });

  test("the files the issue named are held now", () => {
    const { findings } = readAllFindings();

    for (const file of [
      "packages/Common/Utils/Traces/TraceInsight.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ServiceDetail.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils.ts",
      "packages/Common/Utils/SecurityCase/SecurityOverviewMetrics.ts",
    ]) {
      expect({
        file,
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, found: false });
    }
  });
});

describe("negative controls: the scan catches what it is for", () => {
  test("a figure, a plain space and a unit: a duration, a size, a share, a signal, a rate", () => {
    expect(
      linesOf(
        [
          "const a: string = `${Math.round(ms)} ms`;",
          "const b: string = `${(kilobytes / 1024).toFixed(1)} MB`;",
          "const c: string = `${value} %`;",
          "const d: string = `${value.toFixed(2)} dBm (no light)`;",
          "const e: string = `${(value / 1024).toFixed(1)} KB/s`;",
          "const f: string = `${hours} h ${minutes}\\u00A0min`;",
          "const g: string = `${temperature} °C`;",
          'const h: string = size + " GB";',
          "const i: string = `Collected in ${seconds}\\u2009s`;",
          "const j: string = `${value.toFixed(1)} ${units[index]}`;",
          "const k: string = `${rounded} ${BYTE_UNITS[unit] as string}`;",
        ].join("\n"),
      ),
    ).toEqual([
      "1 `${Math.round(ms)} ms`",
      "2 `${(kilobytes / 1024).toFixed(1)} MB`",
      "3 `${value} %`",
      "4 `${value.toFixed(2)} dBm (no light)`",
      "5 `${(value / 1024).toFixed(1)} KB/s`",
      "6 `${hours} h ${minutes}\\u00A0min`",
      "7 `${temperature} °C`",
      '8 size + " GB"',
      "9 `Collected in ${seconds}\\u2009s`",
      "10 `${value.toFixed(1)} ${units[index]}`",
      "11 `${rounded} ${BYTE_UNITS[unit] as string}`",
    ]);
  });

  test("a no-break space, a word, a class name or a plural is no unit apart from its figure", () => {
    expect(
      linesOf(
        [
          "const a: string = `${size}\\u00A0MB`;",
          "const b: string = `${count} minutes`;",
          "const c: string = `${CELL_ROWS} min-w-0`;",
          "const d: string = `${count} sessions`;",
          "const e: string = `${noun}s`;",
          "const f: string = `${count}%`;",
          "const g: string = `${count} hosts`;",
          "const h: string = `${value}${NO_BREAK_SPACE}GB`;",
          "// const i: string = `${value} ms`;",
          'const j: string = "Every " + " min";',
          "const k: string = `${value}\\u00A0${units[index]}`;",
          "const l: string = `${count} ${unit}s`;",
          "const m: string = `systemctl ${verb} ${unitName}`;",
          "const n: string = `${value} ${units}`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a unit held in a variable or a property, after a figure and a plain space (#8457)", () => {
    expect(
      linesOf(
        [
          "const a: string = `${formatted} ${unit}`;",
          "const b: string = `${formatReaderFigure(data.value)} ${data.unit}`;",
          "const c: string = `${reading.value.toFixed(1)} ${reading.unit}`;",
          "const d: string = `${bare} ${unitSymbol}`;",
          "const e: string = `${value} ${reading.symbol}`;",
          "const f: string = `at most ${max} ${unit}.`;",
          "const g: string = `${value} ${unit as string}`;",
          "const h: string = `${value} ${column.unit!}`;",
          'const i: string = value + " " + unit;',
          "const j: string = `${used} / ${total} ${unit}`;",
          "const k: string = `${value} ${RATE_SYMBOL}`;",
          "const l: string = `${value}\\u2009${symbol} (peak)`;",
          "const m: string = `${value} ${(reading.unit)}`;",
          "const n: string = `must be more than 0 ${unit}.`;",
          "const o: string = `${what} is at most 2.5 ${unit}`;",
        ].join("\n"),
      ),
    ).toEqual([
      "1 `${formatted} ${unit}`",
      "2 `${formatReaderFigure(data.value)} ${data.unit}`",
      "3 `${reading.value.toFixed(1)} ${reading.unit}`",
      "4 `${bare} ${unitSymbol}`",
      "5 `${value} ${reading.symbol}`",
      "6 `at most ${max} ${unit}.`",
      "7 `${value} ${unit as string}`",
      "8 `${value} ${column.unit!}`",
      '9 value + " " + unit',
      "10 `${used} / ${total} ${unit}`",
      "11 `${value} ${RATE_SYMBOL}`",
      "12 `${value}\\u2009${symbol} (peak)`",
      "13 `${value} ${(reading.unit)}`",
      "14 `must be more than 0 ${unit}.`",
      "15 `${what} is at most 2.5 ${unit}`",
    ]);
  });

  test("a word held in a variable is no unit's symbol: a plural spelled on, a name for what it holds, no figure before it", () => {
    expect(
      linesOf(
        [
          // The template spells a word with the unit.
          "const a: string = `${count} ${unit}s`;",
          'const b: string = `${count} ${unit}${count === 1 ? "" : "s"}`;',
          "const c: string = `${age.count} ${age.unit}s ago`;",
          "const d: string = `${value} ${unit}-based`;",
          // A word named for what it holds.
          "const e: string = `${magnitude} ${word} ago`;",
          "const f: string = `matched ${matched} ${noun}.`;",
          "const g: string = `${value} ${unitName}`;",
          "const h: string = `${value} ${units}`;",
          "const i: string = `${value} ${unit.name}`;",
          "const j: string = `${value} ${symbols}`;",
          // No figure right before the unit.
          "const k: string = `must be a number of ${unit}.`;",
          "const l: string = `in ${unit}`;",
          "const m: string = `${value}, ${unit}`;",
          "const m2: string = `the p95 ${unit}`;",
          "const m3: string = `Top 10 ${unit}s`;",
          // Held already.
          "const n: string = `${value}\\u00A0${unit}`;",
          "const o: string = `${value}${NO_BREAK_SPACE}${reading.unit}`;",
          'const p: string = value + "\\u00A0" + unit;',
          'const q: string = "Every " + " " + unit;',
          "const r: string = `${value}${unit}`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

/*
 * A UNIT OR A RELATIVE TIME IS ASKED OF INTL IN ONE PLACE (#8456).
 *
 * Intl.NumberFormat's unit style and Intl.RelativeTimeFormat write a plain
 * space between a number and its unit in most languages. DateLanguage asks
 * Intl for them and holds that space; anywhere else the text would come
 * back with the space a line breaks at.
 */

// The helpers that ask Intl for a unit or a relative time, and hold it.
const INTL_HELPERS: ReadonlyArray<string> = [
  "packages/Common/Types/DateLanguage.ts",
];

/*
 * Files another issue rewrites, each with the issue. ValueFormatter's time
 * words go through getUnitAmountParts now (#8457), and none is left.
 */
const INTL_OWNED_ELSEWHERE: Readonly<Record<string, string>> = {};

// Every package, and ee, which is not in every checkout.
const INTL_SCAN_SCOPES: ReadonlyArray<string> = ["packages", "ee"];

// A file that could ask Intl for one: read through the AST only then.
const MAY_ASK_INTL: RegExp = /RelativeTimeFormat|["'`]unit["'`]/;

// A test's own file, which may build one to compare against.
const TEST_FILE: RegExp = /(^|\/)(Tests|E2E)\/|\.(test|spec)\.tsx?$/;

const STYLE: string = "style";

const UNIT_STYLE: string = "unit";

const RELATIVE_TIME_FORMAT: string = "RelativeTimeFormat";

// The name a property is written with: `style` or "style".
const nameOf: (name: ts.PropertyName) => string | undefined = (
  name: ts.PropertyName,
): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }

  return undefined;
};

// Every place `source` asks Intl for a unit or a relative time itself.
const findIntlUnitRequests: (data: {
  file: string;
  source: string;
}) => Array<UnitFinding> = (data: {
  file: string;
  source: string;
}): Array<UnitFinding> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.source,
    ts.ScriptTarget.Latest,
    true,
    data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Array<UnitFinding> = [];

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    findings.push({
      file: data.file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile).replace(WHITESPACE_RUN, " ").slice(0, 120),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // { style: "unit" }: Intl.NumberFormat's, or toLocaleString's, options.
    if (
      ts.isPropertyAssignment(node) &&
      nameOf(node.name) === STYLE &&
      ts.isStringLiteralLike(node.initializer) &&
      node.initializer.text === UNIT_STYLE
    ) {
      report(node);
    }

    // Intl.RelativeTimeFormat, read off Intl however it is typed.
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === RELATIVE_TIME_FORMAT
    ) {
      report(node);
    }

    // new RelativeTimeFormat(...), a constructor read off Intl before.
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === RELATIVE_TIME_FORMAT
    ) {
      report(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

let intlScanResult: ScanResult | undefined = undefined;

// Every file in every package and ee, read once for all the tests below.
const readAllIntlFindings: () => ScanResult = (): ScanResult => {
  if (intlScanResult) {
    return intlScanResult;
  }

  const findings: Array<UnitFinding> = [];
  const filesRead: Record<string, number> = {};

  for (const scope of INTL_SCAN_SCOPES) {
    filesRead[scope] = 0;

    for (const filePath of listSourceFiles(path.join(REPOSITORY_ROOT, scope))) {
      const file: string = toRelativePath(REPOSITORY_ROOT, filePath);

      if (TEST_FILE.test(file)) {
        continue;
      }

      filesRead[scope] = (filesRead[scope] || 0) + 1;

      const source: string = fs.readFileSync(filePath, "utf8");

      if (MAY_ASK_INTL.test(source)) {
        findings.push(...findIntlUnitRequests({ file, source }));
      }
    }
  }

  intlScanResult = { findings, filesRead };

  return intlScanResult;
};

// The line and text of each request in a made-up source.
const intlLinesOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return findIntlUnitRequests({
    file: "packages/App/FeatureSet/Dashboard/src/Made.tsx",
    source,
  }).map((finding: UnitFinding): string => {
    return `${finding.line} ${finding.text}`;
  });
};

describe("a unit or a relative time is asked of Intl only where its number is held", () => {
  test("no code but DateLanguage asks Intl for a unit or a relative time", () => {
    const { findings } = readAllIntlFindings();

    expect(
      findings
        .filter((finding: UnitFinding): boolean => {
          return (
            !INTL_HELPERS.includes(finding.file) &&
            INTL_OWNED_ELSEWHERE[finding.file] === undefined
          );
        })
        .map((finding: UnitFinding): string => {
          return `${finding.file}:${finding.line} ${finding.text}`;
        }),
    ).toEqual([]);
  });

  test("DateLanguage still asks Intl for both, and a listed file still asks: the list only shrinks", () => {
    const { findings } = readAllIntlFindings();
    const askedIn: (file: string) => string = (file: string): string => {
      return findings
        .filter((finding: UnitFinding): boolean => {
          return finding.file === file;
        })
        .map((finding: UnitFinding): string => {
          return finding.text;
        })
        .join("\n");
    };

    for (const helper of INTL_HELPERS) {
      expect(askedIn(helper)).toContain('style: "unit"');
      expect(askedIn(helper)).toContain(RELATIVE_TIME_FORMAT);
    }

    for (const [file, issue] of Object.entries(INTL_OWNED_ELSEWHERE)) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        stillAsks: askedIn(file).length > 0,
      }).toEqual({ file, exists: true, stillAsks: true });
      expect(issue).toMatch(/^#\d+$/);
    }
  });

  test("the scan reads every package", () => {
    const { filesRead } = readAllIntlFindings();

    expect(filesRead["packages"]).toBeGreaterThan(8000);
  });

  test("the callers the issue named, and the others found then, go through DateLanguage now", () => {
    const { findings } = readAllIntlFindings();

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Utils/CompactDuration.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/DataSecurity/ScanDetail.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Home/HomeRelativeTime.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation.ts",
      "packages/App/FeatureSet/Accounts/src/Utils/Form.ts",
      "packages/App/FeatureSet/StatusPage/src/Utils/LiveRefresh.ts",
      "packages/Common/UI/Components/Feed/FeedTime.ts",
      "packages/Common/Utils/Milliseconds.ts",
      // The charts' time words, through getUnitAmountParts (#8457).
      "packages/Common/Utils/ValueFormatter.ts",
    ]) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        asks: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, exists: true, asks: false });
    }
  });
});

describe("negative controls: JSX text (#8720)", () => {
  test("a figure, a space on its line and a unit: written, held in a variable, or after a space of its own", () => {
    expect(
      linesOf(
        [
          "const a = <span>{value} dBm</span>;",
          "const b = <span>{Number(t).toFixed(1)} °C</span>;",
          "const c = <span>{value} {unit}</span>;",
          'const d = <span>{value}{" "}{reading.unit}</span>;',
          'const e = <span>{value}{" "}ms</span>;',
          "const f = <p>Up to 10 MB each</p>;",
          "const g = <>{size} GB free</>;",
          "const h = <span>{used} of {total} GiB</span>;",
        ].join("\n"),
      ),
    ).toEqual([
      "1 dBm",
      "2 °C",
      "3 {unit}",
      '4 {" "}',
      '5 {" "}',
      "6 Up to 10 MB each",
      "7 GB free",
      "8 GiB",
    ]);
  });

  test("a no-break space, a line break, a word, a plural or a figure that is a name's is no unit apart from its figure", () => {
    expect(
      linesOf(
        [
          'const a = <span>{value}{"\\u00A0"}dBm</span>;',
          "const b = <span>{`${value}\\u00A0dBm`}</span>;",
          "const c = <span>{count} hosts</span>;",
          "const d = <span>\n  {value}\n  ms\n</span>;",
          "const e = <span>{value}ms</span>;",
          "const f = <span>{count} {noun}</span>;",
          "const g = <span>{count} {unit}s ago</span>;",
          "const h = <p>Version v2 MB</p>;",
          "const i = <p>Top 10 hosts</p>;",
          "const j = <span>{label}: {name}</span>;",
          "// const k = <span>{value} ms</span>;",
          'const l = <span title="5 ms">{value}</span>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("negative controls: the Intl scan catches what it is for", () => {
  test("a unit's options and a relative time, however they are written", () => {
    expect(
      intlLinesOf(
        [
          'const a: string = new Intl.NumberFormat("de", { style: "unit", unit: "minute" }).format(5);',
          'const b: Intl.NumberFormatOptions = { style: "unit", unit: "byte" };',
          'const c: string = (5).toLocaleString("de", { "style": "unit", unit: "hour" });',
          'const d: string = new Intl.RelativeTimeFormat("de").format(-5, "minute");',
          "const e: unknown = (Intl as unknown as { RelativeTimeFormat: unknown }).RelativeTimeFormat;",
          'const f: unknown = new RelativeTimeFormat(locale, { numeric: "auto" });',
          'const g: Intl.NumberFormatOptions = { style: `unit`, unit: "second" };',
        ].join("\n"),
      ),
    ).toEqual([
      '1 style: "unit"',
      '2 style: "unit"',
      '3 "style": "unit"',
      "4 Intl.RelativeTimeFormat",
      "5 (Intl as unknown as { RelativeTimeFormat: unknown }).RelativeTimeFormat",
      '6 new RelativeTimeFormat(locale, { numeric: "auto" })',
      "7 style: `unit`",
    ]);
  });

  test("a helper's call, another style, a type, a comment or a string is no request", () => {
    expect(
      intlLinesOf(
        [
          'const a: string | null = formatUnitAmount({ value: 5, unit: "minute", locale: "de", unitDisplay: "short" });',
          'const b: string = new Intl.NumberFormat("de", { style: "percent" }).format(0.5);',
          "type C = Intl.RelativeTimeFormatUnit;",
          "let d: typeof Intl.RelativeTimeFormat | undefined = undefined;",
          '// const e: string = new Intl.RelativeTimeFormat("de").format(-5, "minute");',
          "const f: string = 'style: \"unit\"';",
          'const g: { style: string } = { style: "units" };',
          "interface H { RelativeTimeFormat?: unknown }",
          'const i: string | null = formatRelativeAmount({ count: 5, unit: "minute", isFuture: false, locale: "de" });',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a test's own file is left out by its path, a page's is read", () => {
    expect(
      TEST_FILE.test("packages/Common/Tests/Types/DateLanguage.test.ts"),
    ).toBe(true);
    expect(TEST_FILE.test("packages/E2E/Tests/Monitor.spec.ts")).toBe(true);
    expect(TEST_FILE.test("ee/Tests/UI/Backups.test.ts")).toBe(true);
    expect(
      TEST_FILE.test(
        "packages/App/FeatureSet/Dashboard/src/Utils/CompactDuration.ts",
      ),
    ).toBe(false);
    expect(TEST_FILE.test("ee/AdminDashboard/Backups/BackupFormat.ts")).toBe(
      false,
    );
    expect(MAY_ASK_INTL.test('{ style: "unit" }')).toBe(true);
    expect(MAY_ASK_INTL.test("Intl.RelativeTimeFormat")).toBe(true);
    expect(MAY_ASK_INTL.test("const units: number = 5;")).toBe(false);
  });
});

/*
 * A NUMBER CODE JOINS TO A DURATION'S WORD KEEPS IT ON ITS LINE (#8669).
 *
 * English that code writes in words - `${count} minutes ago`, `days + "
 * days"`, `Every ${step} hours` - joined the figure to the word with a
 * plain space, so a narrow cell could end a line with "5" and start the
 * next with "minutes ago". Code holds them with a no-break space
 * (`${count}${NO_BREAK_SPACE}minutes`), or writes moment's English through
 * withDurationWordsHeld (Common/Types/NoBreakSpaces), as OneUptimeDate
 * does. A word that is no duration ("5 hosts") is none of this rule's.
 *
 * Text that is no page's - a monitor template stored when the monitor is
 * made, a query, an English refusal the API sends - keeps its plain space,
 * each file listed in WORDS_AS_WRITTEN with why. A page's English that
 * another issue rewords is listed in WORDS_OWNED_ELSEWHERE with that
 * issue. Both lists only shrink.
 */

// Every page's code, and the shared code a page draws (Common/Types too).
const WORD_SCAN_SCOPES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// Files whose English duration is no page's, each with what it writes.
const WORDS_AS_WRITTEN: Readonly<Record<string, string>> = {
  ...AS_WRITTEN,
  "packages/Common/Types/Monitor/OpenStackAlertTemplates.ts":
    "an OpenStack alert template's names and descriptions, stored with the monitor made from it",
  "packages/Common/Types/Monitor/CloudAlertTemplates.ts":
    "a cloud alert template's names and descriptions, stored with the monitor made from it",
  "packages/Common/Types/ToolImport/ToolImportMonitorBuilder.ts":
    "a monitor built from another tool's import, its descriptions stored with it",
  "packages/Common/Types/Telemetry/InventoryLiveness.ts":
    "an interval in a SQL query",
  "packages/Common/Utils/SecurityCase/SecurityCaseMarkdown.ts":
    "a security case's feed item, written by the server and stored as Markdown",
  "packages/Common/Types/CloudConnection/CloudAiAgentSetupCommands.ts":
    "a line a setup shell command echoes, in double quotes",
  "packages/Common/Types/OnCallDutyPolicy/OnCallPolicyRunRetry.ts":
    "an on-call policy run's status message, stored in its column",
  "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackCapacityView.ts":
    "a cell of the capacity page's CSV export, opened in a spreadsheet",
};

// Files another issue rewords, each with the issue.
const WORDS_OWNED_ELSEWHERE: Readonly<Record<string, string>> = {
  ...OWNED_ELSEWHERE,
  // English sentences built in code with a duration's word (#8695).
  "packages/App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo.tsx":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/PollingIntervalLabels.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/EntityRiskGuide.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Processes.tsx":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Services.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits.tsx":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Logs/Settings/RecordingRules.tsx":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation.ts":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx":
    "#8695",
  "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName.ts":
    "#8695",
  "packages/Common/Types/AI/AIAgentRunLimits.ts": "#8695",
  "packages/Common/Types/AI/CodeTask.ts": "#8695",
  "packages/Common/Types/AI/InvestigationRuleWait.ts": "#8695",
  "packages/Common/Types/Alert/AlertIncidentRuleWait.ts": "#8695",
  "packages/Common/Types/AuditLog/AuditLogSessionEvent.ts": "#8695",
  "packages/Common/Types/DataObservability/DataReconciliation.ts": "#8695",
  "packages/Common/Types/DataSecurity/DataSecurityCheckCatalog.ts": "#8695",
  "packages/Common/Types/NetworkController/NetworkControllerConnectionSettings.ts":
    "#8695",
  "packages/Common/Types/NetworkDevice/DiscoveredDeviceRetention.ts": "#8695",
  "packages/Common/Types/NetworkDevice/DiscoveryImport.ts": "#8695",
  "packages/Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold.ts": "#8695",
  "packages/Common/Types/OnCallDutyPolicy/OnCallSentLine.ts": "#8695",
  "packages/Common/Types/OnCallDutyPolicy/OnCallTestPage.ts": "#8695",
  "packages/Common/Types/OpenStack/OpenStackCheck.ts": "#8695",
  "packages/Common/Types/PacketCapture/PacketCaptureLimits.ts": "#8695",
  "packages/Common/Types/Retention/ResolvedRecordRetention.ts": "#8695",
  "packages/Common/Types/Runbook/RunbookStepTimeout.ts": "#8695",
  "packages/Common/Types/StateTimeline/RowsKeptOnDelete.ts": "#8695",
  "packages/Common/Types/Telemetry/TelemetryUsage.ts": "#8695",
  "packages/Common/Utils/CertificateReissue.ts": "#8695",
  "packages/Common/Utils/CronTab.ts": "#8695",
  "packages/Common/Utils/DeveloperDocs/ResourceProfiles.ts": "#8695",
  "packages/Common/Utils/NetworkDiscovery/UnclaimedScanDiagnosis.ts": "#8695",
  "packages/Common/Utils/OpenStack/OpenStackCheckFindings.ts": "#8695",
  "packages/Common/Utils/OpenStack/OpenStackCollectionSettings.ts": "#8695",
  "packages/Common/Utils/PromQL/PromQLEngine.ts": "#8695",
  "packages/Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser.ts": "#8695",
  "packages/Common/Utils/SessionReplay/SessionReplayBudgetMetricType.ts":
    "#8695",
  "packages/Common/Utils/Telemetry/TelemetryIngestionBudgetMetricType.ts":
    "#8695",
  "packages/Common/Utils/VMware/VMwareCollectionSettings.ts": "#8695",
};

const DURATION_WORD: string = [...ENGLISH_DURATION_WORDS]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .join("|");

// A space a line breaks at, then a duration's word, and not a longer word.
const PLAIN_SPACE_BEFORE_A_DURATION_WORD: RegExp = new RegExp(
  `^[ \u2000-\u2006\u2008-\u200A\u205F](?:${DURATION_WORD})(?![\\p{L}\\p{N}_-])`,
  "u",
);

// Every place `source` joins a figure to a duration's word with a plain space.
const findPlainSpacesBeforeDurationWords: (data: {
  file: string;
  source: string;
}) => Array<UnitFinding> = (data: {
  file: string;
  source: string;
}): Array<UnitFinding> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.source,
    ts.ScriptTarget.Latest,
    true,
    data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Array<UnitFinding> = [];

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    findings.push({
      file: data.file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile).replace(WHITESPACE_RUN, " ").slice(0, 120),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isTemplateExpression(node) &&
      node.templateSpans.some((span: ts.TemplateSpan): boolean => {
        return PLAIN_SPACE_BEFORE_A_DURATION_WORD.test(span.literal.text);
      })
    ) {
      report(node);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (ts.isStringLiteral(node.right) ||
        ts.isNoSubstitutionTemplateLiteral(node.right)) &&
      !ts.isStringLiteral(node.left) &&
      PLAIN_SPACE_BEFORE_A_DURATION_WORD.test(node.right.text)
    ) {
      report(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

let wordScanResult: ScanResult | undefined = undefined;

const readAllWordFindings: () => ScanResult = (): ScanResult => {
  if (wordScanResult) {
    return wordScanResult;
  }

  const findings: Array<UnitFinding> = [];
  const filesRead: Record<string, number> = {};

  for (const scope of WORD_SCAN_SCOPES) {
    filesRead[scope] = 0;

    for (const filePath of listSourceFiles(path.join(REPOSITORY_ROOT, scope))) {
      const file: string = toRelativePath(REPOSITORY_ROOT, filePath);

      if (TEST_FILE.test(file)) {
        continue;
      }

      filesRead[scope] = (filesRead[scope] || 0) + 1;
      findings.push(
        ...findPlainSpacesBeforeDurationWords({
          file,
          source: fs.readFileSync(filePath, "utf8"),
        }),
      );
    }
  }

  wordScanResult = { findings, filesRead };

  return wordScanResult;
};

const wordLinesOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return findPlainSpacesBeforeDurationWords({
    file: "packages/App/FeatureSet/Dashboard/src/Made.tsx",
    source,
  }).map((finding: UnitFinding): string => {
    return `${finding.line} ${finding.text}`;
  });
};

describe("a number code joins to a duration's word keeps it on its line", () => {
  test("no page's code joins a figure to a duration's word with a plain space", () => {
    const { findings } = readAllWordFindings();

    expect(
      findings
        .filter((finding: UnitFinding): boolean => {
          return (
            WORDS_AS_WRITTEN[finding.file] === undefined &&
            WORDS_OWNED_ELSEWHERE[finding.file] === undefined
          );
        })
        .map((finding: UnitFinding): string => {
          return `${finding.file}:${finding.line} ${finding.text}`;
        }),
    ).toEqual([]);
  });

  test("a file listed for its words still joins one so: the lists only shrink", () => {
    const { findings } = readAllWordFindings();
    const own: ReadonlyArray<string> = [
      ...Object.keys(WORDS_AS_WRITTEN).filter((file: string): boolean => {
        return AS_WRITTEN[file] === undefined;
      }),
      ...Object.keys(WORDS_OWNED_ELSEWHERE).filter((file: string): boolean => {
        return OWNED_ELSEWHERE[file] === undefined;
      }),
    ];

    for (const file of own) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        stillJoins: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, exists: true, stillJoins: true });
    }

    for (const issue of Object.values(WORDS_OWNED_ELSEWHERE)) {
      expect(issue).toMatch(/^#\d+$/);
    }

    for (const reason of Object.values(WORDS_AS_WRITTEN)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("the word scan reads the pages, the shared code and Common/Types", () => {
    const { filesRead } = readAllWordFindings();

    expect(filesRead["packages/Common/Types"]).toBeGreaterThan(500);
    expect(filesRead["packages/App/FeatureSet/Dashboard/src"]).toBeGreaterThan(
      2000,
    );
  });

  test("the English the issue named is held now", () => {
    const { findings } = readAllWordFindings();

    for (const file of [
      "packages/Common/Types/Date.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/EventDuration.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime.ts",
      "packages/Common/UI/Components/Feed/FeedTime.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Home/HomeRelativeTime.ts",
      "packages/App/FeatureSet/StatusPage/src/Utils/LiveRefresh.ts",
      "ee/AdminDashboard/Backups/BackupFormat.ts",
      "ee/Dashboard/AuditLogExport/AuditLogExportForm.ts",
    ]) {
      expect({
        file,
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, found: false });
    }
  });
});

describe("negative controls: the word scan catches what it is for", () => {
  test("a figure, a plain space and a duration's word, however it is joined", () => {
    expect(
      wordLinesOf(
        [
          "const a: string = `${count} minutes ago`;",
          'const b: string = days + " days";',
          "const c: string = `Every ${step} hours at ${time}`;",
          "const d: string = `${count} secs`;",
          "const e: string = `in ${value} day`;",
          "const f: string = `${n}\\u2009weeks`;",
        ].join("\n"),
      ),
    ).toEqual([
      "1 `${count} minutes ago`",
      '2 days + " days"',
      "3 `Every ${step} hours at ${time}`",
      "4 `${count} secs`",
      "5 `in ${value} day`",
      "6 `${n}\\u2009weeks`",
    ]);
  });

  test("a held space, another word, a longer word or a unit in a variable is none of this rule's", () => {
    expect(
      wordLinesOf(
        [
          "const a: string = `${count}${NO_BREAK_SPACE}minutes ago`;",
          "const b: string = `${count} hosts`;",
          "const c: string = `${count} daysOff`;",
          "const d: string = `${count} ${unit}s ago`;",
          "const e: string = `${count}\\u00A0hours`;",
          "// const f: string = `${count} minutes`;",
          'const g: string = "Every " + "5 minutes";',
          "const h: string = `${count} minute-long`;",
          "const i: string = `${count} months_ago`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
