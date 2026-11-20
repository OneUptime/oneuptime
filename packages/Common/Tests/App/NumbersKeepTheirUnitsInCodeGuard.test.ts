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
  // TypeORM's slow-query line, written to stdout (#10108).
  "packages/Common/Server/Infrastructure/Postgres/PostgresQueryLogger.ts":
    SERVER_LOG,
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrationRunner.ts":
    SERVER_LOG,
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrationWait.ts":
    SERVER_LOG,
  "packages/Common/Server/Utils/RateLimit/WrongKeyLimit.ts": SERVER_LOG,
  "packages/Common/Server/Utils/Alert/AlertOnCallRulesOnOwnerChange.ts":
    SERVER_LOG,
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
  "packages/Common/UI/Utils/TableColumnsToCsv.ts":
    "a table's CSV export, a cell a spreadsheet reads as written",
  "packages/Common/Utils/Host/HostLogSessionFile.ts":
    "a log session's lines downloaded as the text `logcat -v threadtime` prints, OneUptime's own lines in it written as Logcat's dividers: a log file, read as written",
  "packages/Common/Server/Services/AIBillingService.ts":
    "a failed charge's line in the server's log (the owners' recharge email holds its amounts)",
  "packages/Common/Server/Services/NotificationService.ts":
    "a failed charge's line in the server's log (the owners' recharge email holds its amounts)",
  "packages/Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator.ts":
    SERVER_LOG,
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
  // The request story's durations, in the Dashboard's duration words.
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory.ts":
    "#6889",
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
  // A rate of operations, a transceiver's voltage and bias current (#8823).
  "ops",
  "IOPS",
  "V",
  "mV",
  "mA",
  // An amount of money (#8826).
  "USD",
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

  test("the figures #8803 and #8823 named, a disk's latency and the units the scan did not know, are held now", () => {
    const { findings } = readAllFindings();

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostData.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/TransceiverViewModel.ts",
      "packages/Common/Utils/NetworkDevice/TransceiverHealthUtil.ts",
    ]) {
      expect({
        file,
        listed: isListed(file),
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, listed: false, found: false });
    }
  });

  test("the amounts and durations #8826 named are held now", () => {
    const { findings } = readAllFindings();

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/ProjectBalance/AutoRechargeCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/UsageHistory.tsx",
      "packages/Common/UI/Components/Table/TableRow.tsx",
      "packages/Common/Utils/Project/ProjectBalance.ts",
      "packages/Common/Server/Services/ProjectService.ts",
      "packages/Common/Server/Utils/OperatorSlackNotice.ts",
      "packages/Common/Types/Date.ts",
    ]) {
      expect({
        file,
        listed: isListed(file),
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, listed: false, found: false });
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
          "const l: string = `${formatReaderFigure(value)} ops/s`;",
          "const m: string = `${value.toFixed(2)} V`;",
          "const n: string = `${value.toFixed(2)} mA`;",
          "const o: string = `${count} IOPS`;",
          "const p: string = `${amount} USD`;",
          'const q: string = (cents / 100) + " USD";',
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
      "12 `${formatReaderFigure(value)} ops/s`",
      "13 `${value.toFixed(2)} V`",
      "14 `${value.toFixed(2)} mA`",
      "15 `${count} IOPS`",
      "16 `${amount} USD`",
      '17 (cents / 100) + " USD"',
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
          "const o: string = `${value.toFixed(2)}\\u00A0V`;",
          "const p: string = `${count} Volumes`;",
          "const q: string = `${count} operations`;",
          "const r: string = `${amount}\\u00A0USD`;",
          "const s: string = `${count} USDC tokens`;",
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

/*
 * Files whose English duration is no page's, each with what it writes: an
 * English refusal the API sends, a message stored with its record. And a
 * translation key a page looks up by its English, which keeps its plain
 * spaces: every wording of it holds the number (NoBreakSpaces' duration
 * words, #8695), and the page holds the English it draws.
 */
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
  "packages/Common/Types/SecurityBlocklist/SecurityBlock.ts":
    "a block's length, written by the server into its case's timeline and stored as Markdown",
  "packages/Common/Types/CloudConnection/CloudAiAgentSetupCommands.ts":
    "a line a setup shell command echoes, in double quotes",
  "packages/Common/Types/OnCallDutyPolicy/OnCallPolicyRunRetry.ts":
    "an on-call policy run's status message, stored in its column",
  "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackCapacityView.ts":
    "a cell of the capacity page's CSV export, opened in a spreadsheet",
  "packages/Common/Utils/NetworkDiscovery/UnclaimedScanDiagnosis.ts":
    "a discovery scan's status message, written by the worker and stored with the scan",
  "packages/Common/Utils/OpenStack/OpenStackCheckFindings.ts":
    "an OpenStack check's finding, written by the server into the alert it opens",
  "packages/Common/Utils/OpenStack/OpenStackCollectionSettings.ts":
    "the API's refusal of an OpenStack collection interval",
  "packages/Common/Utils/VMware/VMwareCollectionSettings.ts":
    "the API's refusal of a vCenter collection interval",
  "packages/Common/Utils/PromQL/PromQLEngine.ts":
    "a PromQL error the Prometheus API returns to Grafana and other clients",
  "packages/Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser.ts":
    "a correlation's timespan, written by the server into the step title it stores",
  "packages/Common/Utils/SessionReplay/SessionReplayBudgetMetricType.ts":
    "a budget metric's description, stored with the series the server writes",
  "packages/Common/Utils/Telemetry/TelemetryIngestionBudgetMetricType.ts":
    "a budget metric's description, stored with the series the server writes",
  "packages/Common/Types/AI/CodeTask.ts":
    "a code task's refusal, returned by the API and the AI's tools",
  "packages/Common/Types/AI/InvestigationRuleWait.ts":
    "the API's refusal of an investigation rule's wait: the Dashboard only asks whether there is one",
  "packages/Common/Types/Alert/AlertIncidentRuleWait.ts":
    "the API's refusal of an alert-to-incident rule's wait",
  "packages/Common/Types/AuditLog/AuditLogSessionEvent.ts":
    "a session's end cause, stored with its audit log entry",
  "packages/Common/Types/DataObservability/DataReconciliation.ts":
    "a reconciliation's status message, written by the server and stored",
  "packages/Common/Types/DataSecurity/DataSecurityCheckCatalog.ts":
    "a data security check's finding, written by the server and stored",
  "packages/Common/Types/NetworkController/NetworkControllerConnectionSettings.ts":
    "the API's refusal of a network controller's read interval",
  "packages/Common/Types/NetworkDevice/DiscoveredDeviceRetention.ts":
    "the API's refusal of how long a discovered device is kept",
  "packages/Common/Types/NetworkDevice/DiscoveryImport.ts":
    "the API's refusal of a discovery import's polling interval",
  "packages/Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold.ts":
    "why OneUptime AI handed a run to people, stored with the run's log",
  "packages/Common/Types/OnCallDutyPolicy/OnCallSentLine.ts":
    "a call's outcome, stored as its status message",
  "packages/Common/Types/OnCallDutyPolicy/OnCallTestPage.ts":
    "a test page's status message, stored with its run and read back by its English",
  "packages/Common/Types/OpenStack/OpenStackCheck.ts":
    "the API's refusal of an OpenStack check's interval",
  "packages/Common/Types/Retention/ResolvedRecordRetention.ts":
    "the API's refusal of how long a resolved record is kept",
  "packages/Common/Types/Telemetry/TelemetryUsage.ts":
    "the API's refusal of a usage range",
  "packages/Common/Types/StateTimeline/RowsKeptOnDelete.ts":
    "what a delete keeps, written word for word into a workflow run's stored log and the step's help",
  "packages/Common/Types/PacketCapture/PacketCaptureLimits.ts":
    "a capture's durations as the probe logs them at start and the Packet Capture docs quote them, word for word",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil.ts":
    "a reminder's refusal, a translation key ShiftRemindersCard looks up whole and draws held",
  "packages/Common/Utils/Monitor/ProbeFailureCauses.ts":
    "a timeout as the probe writes it into a stored cause, read back by its English",
  "packages/Common/Utils/SecurityEvent/TelemetryScan/AuditLogSignals.ts":
    "a security signal's message, stored by the server's scan",
  "packages/Common/Utils/SecurityEvent/TelemetryScan/RumSignals.ts":
    "a security signal's message, stored by the server's scan",
  "packages/Common/Utils/VideoCall/TranscriptText.ts":
    "a transcript's length, written into its feed item and the AI's prompt",
  "packages/Common/Types/Monitor/MessageQueueAlertTemplates.ts":
    "a message queue alert template's descriptions, stored with the monitor made from it",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkExport.ts":
    "an SNMP walk's export file, in snmpwalk's own terms",
};

// Files another issue rewords, each with the issue.
const WORDS_OWNED_ELSEWHERE: Readonly<Record<string, string>> = {
  ...OWNED_ELSEWHERE,
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

// A lone space a line breaks at: what a template writes between two values.
const LONE_BREAKING_SPACE: RegExp = /^[ \u2000-\u2006\u2008-\u200A\u205F]$/;

const DURATION_WORD_SET: ReadonlySet<string> = new Set<string>(
  ENGLISH_DURATION_WORDS,
);

/*
 * An expression that writes a duration's word whichever way it goes:
 * `count === 1 ? "minute" : "minutes"` (#8695).
 */
const isDurationWordChoice: (expression: ts.Expression) => boolean = (
  expression: ts.Expression,
): boolean => {
  if (ts.isParenthesizedExpression(expression)) {
    return isDurationWordChoice(expression.expression);
  }

  if (ts.isConditionalExpression(expression)) {
    return (
      isDurationWordChoice(expression.whenTrue) &&
      isDurationWordChoice(expression.whenFalse)
    );
  }

  return (
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)) &&
    DURATION_WORD_SET.has(expression.text)
  );
};

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
      node.templateSpans.some(
        (span: ts.TemplateSpan, index: number): boolean => {
          const next: ts.TemplateSpan | undefined =
            node.templateSpans[index + 1];

          return (
            PLAIN_SPACE_BEFORE_A_DURATION_WORD.test(span.literal.text) ||
            // `${count} ${count === 1 ? "minute" : "minutes"}`
            (next !== undefined &&
              LONE_BREAKING_SPACE.test(span.literal.text) &&
              isDurationWordChoice(next.expression))
          );
        },
      )
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

describe("English sentences built in code with a duration's word (#8695)", () => {
  // The page text #8695 named, each file now holding its figures.
  const HELD_NOW: ReadonlyArray<string> = [
    "packages/Common/Utils/CertificateReissue.ts",
    "packages/Common/Utils/Slo/SloProjection.ts",
    "packages/Common/Utils/CronTab.ts",
    "packages/Common/Utils/DeveloperDocs/ResourceProfiles.ts",
    "packages/Common/Types/AI/AIAgentRunLimits.ts",
    "packages/Common/Types/Runbook/RunbookStepTimeout.ts",
    "packages/App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo.tsx",
    "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/PollingIntervalLabels.ts",
    "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide.ts",
    "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/EntityRiskGuide.ts",
    "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide.ts",
    "packages/App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation.ts",
    "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Processes.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Services.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Logs/Settings/RecordingRules.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown.ts",
    "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation.ts",
    "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx",
  ];

  test("each page's sentence #8695 named holds its figures now", () => {
    const { findings } = readAllWordFindings();

    for (const file of HELD_NOW) {
      expect({
        file,
        listed:
          WORDS_AS_WRITTEN[file] !== undefined ||
          WORDS_OWNED_ELSEWHERE[file] !== undefined,
        found: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, listed: false, found: false });
    }
  });

  test("no file is left for #8695: each is held, or listed with why it is no page's", () => {
    expect(
      Object.entries(WORDS_OWNED_ELSEWHERE).filter(
        ([, issue]: [string, string]): boolean => {
          return issue === "#8695";
        },
      ),
    ).toEqual([]);
    expect(
      Object.keys(WORDS_OWNED_ELSEWHERE).filter((file: string): boolean => {
        return OWNED_ELSEWHERE[file] === undefined;
      }),
    ).toEqual([]);
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

  test("a figure, a plain space and a word chosen between a duration's two (#8695)", () => {
    expect(
      wordLinesOf(
        [
          'const a: string = `${hours} ${hours === 1 ? "hour" : "hours"}`;',
          "const b: string = `in ${days} ${",
          '  days === 1 ? "day" : "days"',
          "} from now`;",
          'const c: string = `${n} ${(n === 1 ? "second" : "seconds")}`;',
          'const d: string = `${n} ${n === 1 ? "minute" : n === 2 ? "min" : "minutes"}`;',
        ].join("\n"),
      ),
    ).toEqual([
      '1 `${hours} ${hours === 1 ? "hour" : "hours"}`',
      '2 `in ${days} ${ days === 1 ? "day" : "days" } from now`',
      '5 `${n} ${(n === 1 ? "second" : "seconds")}`',
      '6 `${n} ${n === 1 ? "minute" : n === 2 ? "min" : "minutes"}`',
    ]);
  });

  test("negative control: a chosen word that is no duration's, held, or after more words", () => {
    expect(
      wordLinesOf(
        [
          'const a: string = `${n} ${n === 1 ? "speaker" : "speakers"}`;',
          'const b: string = `${n}${NO_BREAK_SPACE}${n === 1 ? "hour" : "hours"}`;',
          'const c: string = `${n} of ${n === 1 ? "hour" : "hours"}`;',
          'const d: string = `${n} ${n === 1 ? "hour" : label}`;',
          "const e: string = `${n} ${word}`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

/*
 * A HELPER HANDED A DURATION'S WORD HOLDS IT TO ITS FIGURE (#8823).
 *
 * The word scan reads a template that writes a duration's word itself
 * (`${count} minutes`). A helper that takes the word as a parameter -
 * `plural(count, "minute", "minutes")`, `pluralize(count, "day")` - writes
 * `${count} ${word}` with a plain space, and the word scan saw neither the
 * helper, which names no duration, nor the call, which writes no template.
 *
 * So this reads every helper that writes a figure, a plain space and one of
 * its own parameters (`${count} ${count === 1 ? one : other}`, `count + " "
 * + word`), and every call that hands one a duration's word: in the file
 * that defines it, or a file that imports it by name. A call is held when
 * withDurationWordsHeld wraps it (`withDurationWordsHeld(pluralize(30,
 * "day"))`); a helper that holds its own space is no helper of this kind.
 *
 * A call whose text is no page's keeps its plain space, each file listed in
 * PLURAL_CALLS_AS_WRITTEN with why. The list only shrinks.
 */
const PLURAL_CALLS_AS_WRITTEN: Readonly<Record<string, string>> = {
  "packages/Common/Types/AI/AIAgentRunLimits.ts":
    "a run's limit, written for OneUptime AI to read and into the API's refusal of a call past it",
  "packages/Common/Utils/SecurityCase/SecurityCaseTargets.ts":
    "a case's response target in the server's messages: a feed item stored as Markdown, and the SMS, push and channel posts that quote it",
  "packages/Common/Utils/Slo/SloFeedMarkdown.ts":
    "an SLO feed item the server writes and stores as Markdown",
  "packages/Common/Utils/Slo/SloReleaseCheck.ts":
    "the release check's reason: the API's answer, which a pipeline or a rollout tool writes into its log",
};

// A source that may write a figure, a plain space and a word: read through the AST only then.
const MAY_WRITE_A_WORD_AFTER_A_FIGURE: RegExp = /\} \$\{|\+ " " \+/;

// A source that may hand a helper a duration's word.
const MAY_HAND_A_DURATION_WORD: RegExp = new RegExp(
  `["'\`](?:${DURATION_WORD})["'\`]`,
);

const WITH_DURATION_WORDS_HELD: string = "withDurationWordsHeld";

// The names of a function's parameters: `(count, one, other)`.
const parameterNamesOf: (
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
) => ReadonlySet<string> = (
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): ReadonlySet<string> => {
  const names: Set<string> = new Set<string>();

  for (const parameter of parameters) {
    if (ts.isIdentifier(parameter.name)) {
      names.add(parameter.name.text);
    }
  }

  return names;
};

/*
 * Whether `expression` writes one of `parameters` as the word it draws: the
 * parameter itself, either side of a choice (`count === 1 ? one : other` -
 * not the count the choice reads), or a word spelled on from it
 * (`${singular}s`).
 */
const writesAParameter: (
  expression: ts.Expression,
  parameters: ReadonlySet<string>,
) => boolean = (
  expression: ts.Expression,
  parameters: ReadonlySet<string>,
): boolean => {
  const inner: ts.Expression = unwrapExpression(expression);

  if (ts.isIdentifier(inner)) {
    return parameters.has(inner.text);
  }

  if (ts.isConditionalExpression(inner)) {
    return (
      writesAParameter(inner.whenTrue, parameters) ||
      writesAParameter(inner.whenFalse, parameters)
    );
  }

  if (ts.isTemplateExpression(inner)) {
    return inner.templateSpans.some((span: ts.TemplateSpan): boolean => {
      return writesAParameter(span.expression, parameters);
    });
  }

  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return (
      writesAParameter(inner.left, parameters) ||
      writesAParameter(inner.right, parameters)
    );
  }

  return false;
};

// Whether a withDurationWordsHeld(...) call wraps `node`, in the statement it is part of.
const isHeldByAWrapper: (node: ts.Node) => boolean = (
  node: ts.Node,
): boolean => {
  let parent: ts.Node | undefined = node.parent;

  while (parent && !ts.isStatement(parent) && !ts.isFunctionLike(parent)) {
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === WITH_DURATION_WORDS_HELD
    ) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
};

/*
 * Whether `body` writes a figure, a plain space and one of the function's
 * parameters: `${count} ${word}`, `${formatCount(count)} ${count === 1 ?
 * one : other}`, `count + " " + word`.
 */
const writesAFigureAndAParameter: (
  body: ts.Node,
  parameters: ReadonlySet<string>,
) => boolean = (body: ts.Node, parameters: ReadonlySet<string>): boolean => {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // A helper that holds its own result: `withDurationWordsHeld(`${count} ${word}`)`.
    if (found || isHeldByAWrapper(node)) {
      return;
    }

    if (
      ts.isTemplateExpression(node) &&
      node.templateSpans.some(
        (span: ts.TemplateSpan, index: number): boolean => {
          const next: ts.TemplateSpan | undefined =
            node.templateSpans[index + 1];

          return (
            next !== undefined &&
            LONE_BREAKING_SPACE.test(span.literal.text) &&
            writesAParameter(next.expression, parameters)
          );
        },
      )
    ) {
      found = true;
      return;
    }

    // `count + " " + word`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      writesAParameter(node.right, parameters) &&
      ts.isBinaryExpression(node.left) &&
      node.left.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      ts.isStringLiteralLike(node.left.right) &&
      LONE_BREAKING_SPACE.test(node.left.right.text)
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(body);

  return found;
};

const parseSource: (data: {
  file: string;
  source: string;
}) => ts.SourceFile = (data: {
  file: string;
  source: string;
}): ts.SourceFile => {
  return ts.createSourceFile(
    data.file,
    data.source,
    ts.ScriptTarget.Latest,
    true,
    data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
};

/*
 * The helpers `source` defines that write a figure, a plain space and a
 * word handed to them: a function, a const holding one, or a method.
 */
const findPluralHelpers: (data: {
  file: string;
  source: string;
}) => ReadonlySet<string> = (data: {
  file: string;
  source: string;
}): ReadonlySet<string> => {
  const helpers: Set<string> = new Set<string>();

  if (!MAY_WRITE_A_WORD_AFTER_A_FIGURE.test(data.source)) {
    return helpers;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let name: string | undefined = undefined;
    let fn: ts.SignatureDeclaration | undefined = undefined;

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      name = node.name.text;
      fn = node;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text;
      fn = node.initializer;
    }

    if (
      name !== undefined &&
      fn !== undefined &&
      (fn as ts.FunctionLikeDeclaration).body !== undefined &&
      writesAFigureAndAParameter(
        (fn as ts.FunctionLikeDeclaration).body as ts.Node,
        parameterNamesOf(fn.parameters),
      )
    ) {
      helpers.add(name);
    }

    ts.forEachChild(node, visit);
  };

  visit(parseSource(data));

  return helpers;
};

// The repository file an import names: "./Words", "Common/Utils/Words".
const resolveImport: (file: string, specifier: string) => string | undefined = (
  file: string,
  specifier: string,
): string | undefined => {
  let base: string | undefined = undefined;

  if (specifier.startsWith(".")) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier),
    );
  } else if (specifier.startsWith("Common/")) {
    base = `packages/${specifier}`;
  }

  if (base === undefined) {
    return undefined;
  }

  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find(
    (candidate: string): boolean => {
      return fs.existsSync(path.join(REPOSITORY_ROOT, candidate));
    },
  );
};

/*
 * Every call in `source` that hands a plural helper a duration's word, and
 * that withDurationWordsHeld does not wrap. `helpersOf` names the helpers
 * a file defines.
 */
const findPluralHelperCalls: (data: {
  file: string;
  source: string;
  helpersOf: (file: string) => ReadonlySet<string>;
}) => Array<UnitFinding> = (data: {
  file: string;
  source: string;
  helpersOf: (file: string) => ReadonlySet<string>;
}): Array<UnitFinding> => {
  if (!MAY_HAND_A_DURATION_WORD.test(data.source)) {
    return [];
  }

  const sourceFile: ts.SourceFile = parseSource(data);
  const findings: Array<UnitFinding> = [];
  // The names a call here reaches a helper by: its own, and those it imports.
  const callable: Set<string> = new Set<string>(data.helpersOf(data.file));
  // A module imported whole, by the name it is read through: `Words.plural`.
  const modules: Map<string, ReadonlySet<string>> = new Map<
    string,
    ReadonlySet<string>
  >();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }

    const imported: string | undefined = resolveImport(
      data.file,
      statement.moduleSpecifier.text,
    );

    if (imported === undefined) {
      continue;
    }

    const helpers: ReadonlySet<string> = data.helpersOf(imported);

    if (helpers.size === 0) {
      continue;
    }

    const clause: ts.ImportClause = statement.importClause;

    if (clause.name) {
      modules.set(clause.name.text, helpers);
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      modules.set(clause.namedBindings.name.text, helpers);
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (helpers.has((element.propertyName || element.name).text)) {
          callable.add(element.name.text);
        }
      }
    }
  }

  const reachesAHelper: (callee: ts.Expression) => boolean = (
    callee: ts.Expression,
  ): boolean => {
    if (ts.isIdentifier(callee)) {
      return callable.has(callee.text);
    }

    if (ts.isPropertyAccessExpression(callee)) {
      // `this.plural`, `Words.plural`: a method here, or one of a module read whole.
      if (
        ts.isIdentifier(callee.expression) &&
        modules.get(callee.expression.text)?.has(callee.name.text)
      ) {
        return true;
      }

      return data.helpersOf(data.file).has(callee.name.text);
    }

    return false;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      reachesAHelper(node.expression) &&
      node.arguments.some((argument: ts.Expression): boolean => {
        return isDurationWordChoice(argument);
      }) &&
      !isHeldByAWrapper(node)
    ) {
      findings.push({
        file: data.file,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        text: node
          .getText(sourceFile)
          .replace(WHITESPACE_RUN, " ")
          .slice(0, 120),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

interface PluralScanResult extends ScanResult {
  helpers: Record<string, ReadonlyArray<string>>;
}

let pluralScanResult: PluralScanResult | undefined = undefined;

// Every page's file read twice: for the helpers, then for the calls.
const readAllPluralHelperCalls: () => PluralScanResult =
  (): PluralScanResult => {
    if (pluralScanResult) {
      return pluralScanResult;
    }

    const sources: Map<string, string> = new Map<string, string>();
    const filesRead: Record<string, number> = {};

    for (const scope of WORD_SCAN_SCOPES) {
      filesRead[scope] = 0;

      for (const filePath of listSourceFiles(
        path.join(REPOSITORY_ROOT, scope),
      )) {
        const file: string = toRelativePath(REPOSITORY_ROOT, filePath);

        if (TEST_FILE.test(file)) {
          continue;
        }

        filesRead[scope] = (filesRead[scope] || 0) + 1;
        sources.set(file, fs.readFileSync(filePath, "utf8"));
      }
    }

    const helpers: Map<string, ReadonlySet<string>> = new Map<
      string,
      ReadonlySet<string>
    >();

    for (const [file, source] of sources) {
      const found: ReadonlySet<string> = findPluralHelpers({ file, source });

      if (found.size > 0) {
        helpers.set(file, found);
      }
    }

    const helpersOf: (file: string) => ReadonlySet<string> = (
      file: string,
    ): ReadonlySet<string> => {
      return helpers.get(file) || new Set<string>();
    };

    const findings: Array<UnitFinding> = [];

    for (const [file, source] of sources) {
      findings.push(...findPluralHelperCalls({ file, source, helpersOf }));
    }

    pluralScanResult = {
      findings,
      filesRead,
      helpers: Object.fromEntries(
        [...helpers.entries()].map(
          ([file, names]: [string, ReadonlySet<string>]): [
            string,
            ReadonlyArray<string>,
          ] => {
            return [file, [...names].sort()];
          },
        ),
      ),
    };

    return pluralScanResult;
  };

// The line and text of each call in a made-up source, its helpers its own.
const pluralLinesOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const file: string = "packages/App/FeatureSet/Dashboard/src/Made.tsx";
  const helpers: ReadonlySet<string> = findPluralHelpers({ file, source });

  return findPluralHelperCalls({
    file,
    source,
    helpersOf: (): ReadonlySet<string> => {
      return helpers;
    },
  }).map((finding: UnitFinding): string => {
    return `${finding.line} ${finding.text}`;
  });
};

describe("a helper handed a duration's word holds it to its figure (#8823)", () => {
  test("no page's call hands a plural helper a duration's word to write with a plain space", () => {
    const { findings } = readAllPluralHelperCalls();

    expect(
      findings
        .filter((finding: UnitFinding): boolean => {
          return PLURAL_CALLS_AS_WRITTEN[finding.file] === undefined;
        })
        .map((finding: UnitFinding): string => {
          return `${finding.file}:${finding.line} ${finding.text}`;
        }),
    ).toEqual([]);
  });

  test("a listed file still hands one a duration's word: the list only shrinks, each with why", () => {
    const { findings } = readAllPluralHelperCalls();

    for (const [file, reason] of Object.entries(PLURAL_CALLS_AS_WRITTEN)) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        stillHands: findings.some((finding: UnitFinding): boolean => {
          return finding.file === file;
        }),
      }).toEqual({ file, exists: true, stillHands: true });
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("the helpers the issue named are found, and the page's call to one is held", () => {
    const { findings, helpers } = readAllPluralHelperCalls();

    expect(helpers["packages/Common/Types/AI/AIAgentRunLimits.ts"]).toContain(
      "plural",
    );
    expect(helpers["packages/Common/Utils/Slo/SloOverviewText.ts"]).toContain(
      "pluralize",
    );
    expect(
      findings.filter((finding: UnitFinding): boolean => {
        return finding.file === "packages/Common/Utils/Slo/SloOverviewText.ts";
      }),
    ).toEqual([]);
  });

  test("the scan reads the pages, the shared code and Common/Types", () => {
    const { filesRead } = readAllPluralHelperCalls();

    expect(filesRead["packages/Common/Types"]).toBeGreaterThan(500);
    expect(filesRead["packages/App/FeatureSet/Dashboard/src"]).toBeGreaterThan(
      2000,
    );
  });
});

describe("negative controls: the plural helper scan catches what it is for", () => {
  test("a helper handed a duration's word, however it is written and called", () => {
    expect(
      pluralLinesOf(
        [
          "function plural(count: number, one: string, other: string): string {",
          "  return `${formatCount(count)} ${count === 1 ? one : other}`;",
          "}",
          "const pluralize = (count: number, singular: string): string => {",
          "  return `${count} ${count === 1 ? singular : `${singular}s`}`;",
          "};",
          "const joined = (count: number, word: string): string => {",
          '  return count + " " + word;',
          "};",
          "class Words {",
          "  public static count(n: number, word: string): string {",
          "    return `${n} ${word}`;",
          "  }",
          "  public read(): string {",
          '    return Words.count(5, "days") + this.count(2, "hours");',
          "  }",
          "}",
          'const a: string = plural(5, "minute", "minutes");',
          'const b: string = `Every ${pluralize(30, "day")}`;',
          'const c: string = joined(2, "weeks");',
          'const d: string = plural(n, "second", n === 2 ? "seconds" : "secs");',
        ].join("\n"),
      ),
    ).toEqual([
      '15 Words.count(5, "days")',
      '15 this.count(2, "hours")',
      '18 plural(5, "minute", "minutes")',
      '19 pluralize(30, "day")',
      '20 joined(2, "weeks")',
      '21 plural(n, "second", n === 2 ? "seconds" : "secs")',
    ]);
  });

  test("a held call, another word, a held helper or no helper at all is none of this rule's", () => {
    expect(
      pluralLinesOf(
        [
          "const pluralize = (count: number, singular: string): string => {",
          "  return `${count} ${count === 1 ? singular : `${singular}s`}`;",
          "};",
          "const held = (count: number, word: string): string => {",
          "  return `${count}\\u00A0${word}`;",
          "};",
          "const holds = (count: number, word: string): string => {",
          "  return withDurationWordsHeld(`${count} ${word}`);",
          "};",
          "const label = (name: string, word: string): string => {",
          "  return `${name}: ${word}`;",
          "};",
          'const a: string = withDurationWordsHeld(pluralize(30, "day"));',
          'const b: string = pluralize(3, "monitor");',
          'const c: string = held(5, "minutes");',
          'const c2: string = holds(5, "minutes");',
          'const d: string = moment().add(5, "days").toString();',
          'const e: string = label("Window", "days");',
          '// const f: string = pluralize(30, "day");',
          'const g: string = `Every ${withDurationWordsHeld(pluralize(n, "hour"))}`;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("an import is followed to the file it names", () => {
    expect(
      resolveImport(
        "packages/Common/Utils/Slo/SloOverviewTextInLanguage.ts",
        "./SloOverviewText",
      ),
    ).toBe("packages/Common/Utils/Slo/SloOverviewText.ts");
    expect(
      resolveImport(
        "packages/App/FeatureSet/Dashboard/src/Made.tsx",
        "Common/Types/AI/AIAgentRunLimits",
      ),
    ).toBe("packages/Common/Types/AI/AIAgentRunLimits.ts");
    expect(
      resolveImport("packages/Common/Utils/Made.ts", "react"),
    ).toBeUndefined();
  });
});
