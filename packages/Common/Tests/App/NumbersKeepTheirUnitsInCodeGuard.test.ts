// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
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
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * The source read, relative to the repository (ee/ is not in every
 * checkout). Common/Types is drawn on pages too: a file's size, a web
 * vital, an installation's health (#8457).
 */
const SCAN_SCOPES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/App/FeatureSet/Dashboard/src",
  "ee/Dashboard",
];

// Files whose text is no page's, each with what it writes.
const AS_WRITTEN: Readonly<Record<string, string>> = {
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

const WHITESPACE_RUN: RegExp = /\s+/g;

// A run of spaces a line breaks at, and nothing else.
const ONLY_PLAIN_SPACES: RegExp = /^[ \u2000-\u2006\u2008-\u200A\u205F]+$/;

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
  /(?:^|[^\p{L}\p{N}_.,])\p{Nd}+(?:[.,]\p{Nd}+)*[  -  -  ]+$/u;

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
    index < 0 ? template.head.text : (spans[index] as ts.TemplateSpan).literal.text;
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

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
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
      "packages/Common/Types/Monitor/NtpMonitor/NtpMonitorUtil.ts",
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
