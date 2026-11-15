// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * A DURATION IN MILLISECONDS IS WRITTEN IN THE READER'S LANGUAGE.
 *
 * Every monitor type's summary built its Response Time as
 * `responseTimeInMs + " ms"` (issue #7224): English glued to a Latin
 * figure. On an Arabic or Persian page the browser lays that out from the
 * right, so it read "ms 411", and in Persian its digits stayed Latin beside
 * the card's Persian date. A duration is now formatMilliseconds
 * (Common/Utils/Milliseconds, which the Dashboard's Utils/Milliseconds
 * re-exports), the "{{value}} ms" key that every language words with its
 * own unit and order, with the figure as the reader's language writes a
 * number. The monitor overview - its hero's Latest result
 * (Common/Utils/Monitor/MonitorOverviewPresentationUtil) and its Probes
 * card - wrote "Up · 182 ms" by hand too (issue #7416), and is held to the
 * same rule.
 *
 * Outside the summaries the Dashboard went on writing its durations by
 * hand (issue #7418): a trace's p95 `${ms.toFixed(1)} ms`, a database's and
 * a queue's latency, a cloud metric, a code review's p99, a ping's round
 * trip, a breadcrumb's offset `${sign}${Math.round(absMs)} ms`, an LLM
 * call's `{call.durationMs} ms` - Latin digits, an English decimal point
 * and the Latin unit on the wrong side of the figure in Persian and Arabic,
 * "1.5 ms" in German. Every Dashboard file is held to the rule now.
 *
 * The same formatters wrote their other units by hand (issue #8348): a
 * second `${(ms / 1000).toFixed(2)} s`, a microsecond `${ms * 1000} µs`, a
 * nanosecond `${n}ns`, a minute `${(ms / 60000).toFixed(1)} min` - so a
 * Persian row read "1.25 s" in Latin digits under "۴۲ میلی‌ثانیه". Each is
 * formatMilliseconds with its unit now ({ unit: "s" }), and held to the
 * same rule as "ms".
 *
 * This reads every frontend's source through the TypeScript AST (comments
 * are no code), and fails on:
 *
 *   - anywhere: a figure joined to "ms" with + ("x + ' ms'"), the way the
 *     summaries wrote it;
 *   - in every Dashboard file (DASHBOARD_SCOPES), and the shared monitor
 *     helpers that write the monitor overview's hero: a duration's unit
 *     written after a template's figure (`${x} ms`, `${x}µs`, `${x}ns`,
 *     `${x} s`, `${x} min`), or after a JSX figure (`{x} ms`), or a lone
 *     duration's key ("{{value}} ms") looked up by hand instead of through
 *     formatMilliseconds. A whole sentence that holds a duration ("{{host}}
 *     resolved to {{addresses}} in {{time}} ms") words its own unit in each
 *     language, and is left to it. Seconds and minutes are caught with
 *     the space before them only: `${name}s` is English's plural, and
 *     `${className} min-w-0` a CSS class.
 *
 * What is no duration a reader reads is left alone: a CSS time
 * (`opacity ${EMPHASIS_TRANSITION_MS}ms ease`, an animationDuration, a CSS
 * custom property's value). A file another issue owns is listed in
 * OWNED_ELSEWHERE with that issue, and the list only shrinks: a listed
 * file that no longer writes a unit by hand fails until it is taken off.
 * A helper whose hand-written unit is only its English reading - every
 * other language worded by Intl - is listed in ENGLISH_READINGS with why,
 * held to the same: a listed file that no longer writes one fails.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const DASHBOARD_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);

/*
 * The Dashboard's source, relative to the repository: its own, and the
 * Enterprise pages it draws (ee/Dashboard).
 */
const DASHBOARD_SCOPES: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "ee/Dashboard",
];

/*
 * The Dashboard files another issue owns, each with the issue: they write
 * a duration's unit by hand inside a sentence or a reading that issue
 * rewords whole.
 */
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
  // The session replay rail's facts, in the reader's language.
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals.ts":
    "#6516",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayClockAlignment.ts":
    "#6516",
};

/*
 * The Dashboard files whose hand-written unit is the English reading of a
 * helper that words every other language itself, each with why: only an
 * English reader reads it.
 */
const ENGLISH_READINGS: Readonly<Record<string, string>> = {
  /*
   * The infrastructure graph's status line read "Active · seen 12 min ago"
   * in English for every reader (#8418); it is a sentence of the locale
   * now, its time formatLastSeenInLanguage's.
   */
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/TopologyActivity.ts":
    "formatLastSeen is the English reading of formatLastSeenInLanguage, which words every other language with Intl.RelativeTimeFormat; no page draws it itself.",
};

/*
 * A CSS property whose value is a time: "200ms" there is CSS, never a
 * duration a reader reads.
 */
const CSS_TIME_PROPERTIES: ReadonlyArray<string> = [
  "animation",
  "animationDelay",
  "animationDuration",
  "transition",
  "transitionDelay",
  "transitionDuration",
];

/*
 * "ms" as CSS writes it in a stylesheet or a property's value: right after
 * the figure, then a bracket, a semicolon or a timing function
 * ("200ms ease", "var(--x, 120ms) linear;").
 */
const CSS_TIME_IN_TEXT: RegExp =
  /^ms(?:\)|;|\s+(?:ease|linear|step-start|step-end|steps\(|cubic-bezier\())/;

// The places a monitor's check is summarized, relative to the Dashboard's src.
const MONITOR_SUMMARY_SCOPE: ReadonlyArray<string> = [
  "Components/Monitor/SummaryView",
  "Components/EventView/EventEvaluationDetails.tsx",
  "Components/NetworkDevice/TracerouteHopsTable.tsx",
  // The monitor overview's cards: the Probes card, the Response time card.
  "Components/Monitor/Overview",
];

/*
 * The shared monitor helpers that write a monitor page's words with the
 * reader's Translator - the overview's hero and facts among them
 * (MonitorOverviewPresentationUtil). They live outside every frontend's
 * source, so they are read on their own, as monitor summaries, relative to
 * the repository.
 */
const SHARED_MONITOR_SUMMARY_SCOPE: ReadonlyArray<string> = [
  "packages/Common/Utils/Monitor",
];

// The one helper that writes a lone duration, relative to the repository.
const MILLISECONDS_HELPER: string = "packages/Common/Utils/Milliseconds.ts";

// "ms" right after a figure: " ms", "ms", never "msg" or "msec".
const MILLISECONDS_AFTER_FIGURE: RegExp = /^\s?ms(?![A-Za-z])/;

/*
 * A duration's unit right after a template's figure: "ms", "µs" and "ns"
 * joined or after a space ("12µs", "850 ns"), seconds and minutes after a
 * space only (" s", " min") - never "msg", a plural's "s" (`${name}s`) or a
 * CSS class (`${base} min-w-0`).
 */
const DURATION_UNIT_AFTER_FIGURE: RegExp =
  /^\s?ms(?![A-Za-z])|^\s?(?:µs|μs|ns)(?![A-Za-z])|^\s(?:s|min)(?![A-Za-z-])/;

// JSX text right after a figure: "{x} ms", the line it ends breaking after it.
const JSX_DURATION_UNIT_AFTER_FIGURE: RegExp =
  /^[^\S\n]?ms(?![A-Za-z])|^[^\S\n]?(?:µs|μs|ns)(?![A-Za-z])|^[^\S\n](?:s|min)(?![A-Za-z-])/;

// A lone duration's key: "{{value}} ms", "{{latency}} ms".
const LONE_DURATION_KEY: RegExp = /^\{\{\s*[\w.]+\s*\}\}\s?ms$/;

const WHITESPACE_RUN: RegExp = /\s+/g;

interface MillisecondsFinding {
  file: string;
  line: number;
  text: string;
  rule:
    | "joined with +"
    | "written after a template's figure"
    | "written after a JSX figure"
    | "lone key";
}

/*
 * Whether `file` (relative to the repository) is the Dashboard's: held to
 * every rule, as the monitor summaries are.
 */
const isDashboardFile: (relativeFile: string) => boolean = (
  relativeFile: string,
): boolean => {
  return DASHBOARD_SCOPES.some((scope: string): boolean => {
    return relativeFile.startsWith(`${scope}/`);
  });
};

// Whether `file` (relative to the repository) is a monitor summary.
const isMonitorSummaryFile: (relativeFile: string) => boolean = (
  relativeFile: string,
): boolean => {
  const dashboard: string = toRelativePath(REPOSITORY_ROOT, DASHBOARD_SOURCE);

  return [
    ...MONITOR_SUMMARY_SCOPE.map((scope: string): string => {
      return `${dashboard}/${scope}`;
    }),
    ...SHARED_MONITOR_SUMMARY_SCOPE,
  ].some((scoped: string): boolean => {
    return relativeFile === scoped || relativeFile.startsWith(`${scoped}/`);
  });
};

/*
 * Whether a template is a CSS property's value: an animationDuration, a
 * transition, or a CSS custom property ("--replay-cursor-ms").
 */
/*
 * Whether a template is the English a duration helper writes for an English
 * reader: the `english` of formatDurationInUnit's options (`{ english:
 * `${x} µs` }`). Every other reader reads the helper's own words, and the
 * helper holds the English figure to its unit.
 */
const isEnglishOfADurationHelper: (node: ts.TemplateExpression) => boolean = (
  node: ts.TemplateExpression,
): boolean => {
  const parent: ts.Node = node.parent;

  return (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) &&
    parent.name.text === "english"
  );
};

const isCssPropertyValue: (node: ts.TemplateExpression) => boolean = (
  node: ts.TemplateExpression,
): boolean => {
  const parent: ts.Node = node.parent;

  if (!ts.isPropertyAssignment(parent) || parent.initializer !== node) {
    return false;
  }

  const name: string | undefined =
    ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)
      ? parent.name.text
      : undefined;

  return (
    name !== undefined &&
    (CSS_TIME_PROPERTIES.includes(name) || name.startsWith("--"))
  );
};

/*
 * Whether a template's value is a no-break space (`${NO_BREAK_SPACE}`,
 * `${"\u00A0"}`): the unit after it is a unit after a figure all the same,
 * held to its line but still English.
 */
const NO_BREAK_SPACE_NAME: RegExp = /^(?:NARROW_)?NO_BREAK_SPACE$/;

const A_NO_BREAK_SPACE: RegExp = /^[\u00A0\u202F]$/;

const isNoBreakSpace: (expression: ts.Expression) => boolean = (
  expression: ts.Expression,
): boolean => {
  if (ts.isIdentifier(expression)) {
    return NO_BREAK_SPACE_NAME.test(expression.text);
  }

  return (
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)) &&
    A_NO_BREAK_SPACE.test(expression.text)
  );
};

// Whether JSX text comes right after a value drawn in braces: "{x} ms".
const followsJsxFigure: (node: ts.JsxText) => boolean = (
  node: ts.JsxText,
): boolean => {
  const parent: ts.Node = node.parent;

  if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) {
    return false;
  }

  const siblings: ReadonlyArray<ts.JsxChild> = parent.children;
  const index: number = siblings.indexOf(node);
  const previous: ts.JsxChild | undefined =
    index > 0 ? siblings[index - 1] : undefined;

  return previous !== undefined && ts.isJsxExpression(previous);
};

// The durations a source writes by hand, by the rules above.
const findHandWrittenMilliseconds: (data: {
  file: string;
  source: string;
  isHeldToEveryRule: boolean;
}) => Array<MillisecondsFinding> = (data: {
  file: string;
  source: string;
  isHeldToEveryRule: boolean;
}): Array<MillisecondsFinding> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.source,
    ts.ScriptTarget.Latest,
    true,
    data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Array<MillisecondsFinding> = [];

  const report: (node: ts.Node, rule: MillisecondsFinding["rule"]) => void = (
    node: ts.Node,
    rule: MillisecondsFinding["rule"],
  ): void => {
    findings.push({
      file: data.file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile).replace(WHITESPACE_RUN, " ").slice(0, 120),
      rule: rule,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (ts.isStringLiteral(node.right) ||
        ts.isNoSubstitutionTemplateLiteral(node.right)) &&
      MILLISECONDS_AFTER_FIGURE.test(node.right.text)
    ) {
      report(node, "joined with +");
    }

    if (
      data.isHeldToEveryRule &&
      ts.isTemplateExpression(node) &&
      !isEnglishOfADurationHelper(node)
    ) {
      const isCssValue: boolean = isCssPropertyValue(node);
      const writesMilliseconds: boolean = node.templateSpans.some(
        (span: ts.TemplateSpan): boolean => {
          // A no-break space put in as a value is the space before the unit.
          const text: string = isNoBreakSpace(span.expression)
            ? ` ${span.literal.text}`
            : span.literal.text;

          return (
            DURATION_UNIT_AFTER_FIGURE.test(text) &&
            !isCssValue &&
            !CSS_TIME_IN_TEXT.test(text)
          );
        },
      );

      if (writesMilliseconds) {
        report(node, "written after a template's figure");
      }
    }

    if (
      data.isHeldToEveryRule &&
      ts.isJsxText(node) &&
      JSX_DURATION_UNIT_AFTER_FIGURE.test(node.text) &&
      followsJsxFigure(node)
    ) {
      report(node, "written after a JSX figure");
    }

    if (
      data.isHeldToEveryRule &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      LONE_DURATION_KEY.test(node.text)
    ) {
      report(node, "lone key");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

interface ScanResult {
  findings: Array<MillisecondsFinding>;
  filesRead: number;
  dashboardFilesRead: number;
  summaryFilesRead: number;
}

// Whether `file` (relative to the repository) is held to every rule.
const isHeldToEveryRule: (relativeFile: string) => boolean = (
  relativeFile: string,
): boolean => {
  return isDashboardFile(relativeFile) || isMonitorSummaryFile(relativeFile);
};

// Every frontend's files are read once, for all the tests below.
let scanResult: ScanResult | undefined = undefined;

const readAllFindings: () => ScanResult = (): ScanResult => {
  if (scanResult) {
    return scanResult;
  }

  const findings: Array<MillisecondsFinding> = [];
  let filesRead: number = 0;
  let dashboardFilesRead: number = 0;
  let summaryFilesRead: number = 0;

  const roots: Array<string> = [
    ...listScanRoots(REPOSITORY_ROOT),
    ...SHARED_MONITOR_SUMMARY_SCOPE.map((scope: string): string => {
      return path.join(REPOSITORY_ROOT, scope);
    }),
  ];
  const seen: Set<string> = new Set<string>();

  for (const root of roots) {
    for (const filePath of listSourceFiles(root)) {
      const file: string = toRelativePath(REPOSITORY_ROOT, filePath);

      if (seen.has(file)) {
        continue;
      }

      seen.add(file);
      filesRead++;

      if (isDashboardFile(file)) {
        dashboardFilesRead++;
      }

      if (isMonitorSummaryFile(file)) {
        summaryFilesRead++;
      }

      findings.push(
        ...findHandWrittenMilliseconds({
          file: file,
          source: fs.readFileSync(filePath, "utf8"),
          isHeldToEveryRule: isHeldToEveryRule(file),
        }),
      );
    }
  }

  scanResult = { findings, filesRead, dashboardFilesRead, summaryFilesRead };

  return scanResult;
};

const describeFinding: (finding: MillisecondsFinding) => string = (
  finding: MillisecondsFinding,
): string => {
  return `${finding.file}:${finding.line} (${finding.rule}) ${finding.text}`;
};

// The rule and line of each finding in a made-up source.
const rulesOf: (findings: Array<MillisecondsFinding>) => Array<string> = (
  findings: Array<MillisecondsFinding>,
): Array<string> => {
  return findings.map((finding: MillisecondsFinding): string => {
    return `${finding.line} ${finding.rule}`;
  });
};

describe("durations in milliseconds, in the reader's language", () => {
  test("no frontend joins a figure to 'ms', and no Dashboard file writes a duration's unit by hand", () => {
    const { findings } = readAllFindings();

    expect(
      findings
        .filter((finding: MillisecondsFinding): boolean => {
          return (
            OWNED_ELSEWHERE[finding.file] === undefined &&
            ENGLISH_READINGS[finding.file] === undefined
          );
        })
        .map(describeFinding),
    ).toEqual([]);
  });

  test("a file another issue owns still writes a unit by hand: the list only shrinks", () => {
    const { findings } = readAllFindings();

    for (const file of Object.keys(OWNED_ELSEWHERE)) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        isDashboardFile: isDashboardFile(file),
        stillWritesMsByHand: findings.some(
          (finding: MillisecondsFinding): boolean => {
            return finding.file === file;
          },
        ),
      }).toEqual({
        file,
        exists: true,
        isDashboardFile: true,
        stillWritesMsByHand: true,
      });
      expect(OWNED_ELSEWHERE[file]).toMatch(/^#\d+$/);
    }
  });

  test("a helper's English reading still writes its unit by hand, and says why: the list only shrinks", () => {
    const { findings } = readAllFindings();

    for (const file of Object.keys(ENGLISH_READINGS)) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
        isDashboardFile: isDashboardFile(file),
        isOwnedElsewhere: OWNED_ELSEWHERE[file] !== undefined,
        stillWritesAUnitByHand: findings.some(
          (finding: MillisecondsFinding): boolean => {
            return finding.file === file;
          },
        ),
      }).toEqual({
        file,
        exists: true,
        isDashboardFile: true,
        isOwnedElsewhere: false,
        stillWritesAUnitByHand: true,
      });
      // A reason, as a sentence: never an issue number alone.
      expect(ENGLISH_READINGS[file]).toMatch(/^[a-zA-Z].{40,}\.$/);
    }
  });

  test("the scan reads the frontends, every Dashboard file and every place a check is summarized", () => {
    const { filesRead, dashboardFilesRead, summaryFilesRead } =
      readAllFindings();

    for (const scope of MONITOR_SUMMARY_SCOPE) {
      expect({
        scope,
        exists: fs.existsSync(path.join(DASHBOARD_SOURCE, scope)),
      }).toEqual({ scope, exists: true });
    }

    for (const scope of [
      ...SHARED_MONITOR_SUMMARY_SCOPE,
      ...DASHBOARD_SCOPES,
    ]) {
      expect({
        scope,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, scope)),
      }).toEqual({ scope, exists: true });
    }

    expect(filesRead).toBeGreaterThan(1000);
    // The Dashboard has several thousand modules.
    expect(dashboardFilesRead).toBeGreaterThan(2000);
    /*
     * The summary views (about 40 of them), the two files beside them, the
     * overview's cards (about 30) and the shared monitor helpers (about 30).
     */
    expect(summaryFilesRead).toBeGreaterThan(90);
  });

  test("the overview's hero and its Probes card are read as monitor summaries", () => {
    expect(
      isMonitorSummaryFile(
        "packages/Common/Utils/Monitor/MonitorOverviewPresentationUtil.ts",
      ),
    ).toBe(true);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard.tsx",
      ),
    ).toBe(true);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorResponseTimeCard.tsx",
      ),
    ).toBe(true);
  });

  test("every Dashboard file is held to every rule, other frontends to the + rule", () => {
    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView.tsx",
      "packages/App/FeatureSet/Dashboard/src/Utils/BreadcrumbTimelinePresentation.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/Code/Task/Log.tsx",
      "ee/Dashboard/AuditLogs/Made.tsx",
      "packages/Common/Utils/Monitor/MonitorOverviewPresentationUtil.ts",
    ]) {
      expect({ file, held: isHeldToEveryRule(file) }).toEqual({
        file,
        held: true,
      });
    }

    for (const file of [
      "packages/App/FeatureSet/StatusPage/src/Pages/Made.tsx",
      "packages/Common/UI/Components/Made.tsx",
      "packages/App/FeatureSet/DashboardMade/src/Made.tsx",
    ]) {
      expect({ file, held: isHeldToEveryRule(file) }).toEqual({
        file,
        held: false,
      });
    }
  });

  test("the duration helper is the one place that holds the key", () => {
    const helper: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, MILLISECONDS_HELPER),
      "utf8",
    );
    const dashboardHelper: string = fs.readFileSync(
      path.join(DASHBOARD_SOURCE, "Utils/Milliseconds.ts"),
      "utf8",
    );

    expect(helper).toContain('translationKey("{{value}} ms")');
    // The Dashboard hands its views the same helper, never a copy of it.
    expect(dashboardHelper).toContain('from "Common/Utils/Milliseconds"');
    expect(dashboardHelper).toContain("formatMillisecondsInEnglish");
    expect(dashboardHelper).not.toContain("translationKey(");
    expect(dashboardHelper).not.toContain("translateTemplate(");
    expect(isMonitorSummaryFile(MILLISECONDS_HELPER)).toBe(false);
    expect(isHeldToEveryRule(MILLISECONDS_HELPER)).toBe(false);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Utils/Milliseconds.ts",
      ),
    ).toBe(false);
  });
});

describe("negative controls: the scan catches what it is for", () => {
  test("a figure joined to ' ms' with +, anywhere", () => {
    const findings: Array<MillisecondsFinding> = findHandWrittenMilliseconds({
      file: "packages/App/FeatureSet/StatusPage/src/Pages/Anywhere.tsx",
      source:
        'const a: string = responseTimeInMs + " ms";\nconst b: string = value + "ms";\n',
      isHeldToEveryRule: false,
    });

    expect(rulesOf(findings)).toEqual(["1 joined with +", "2 joined with +"]);
  });

  test("a template's figure followed by 'ms', or the lone key, in a monitor summary", () => {
    const source: string = [
      "const a: string = `${Math.round(durationInMs * 100) / 100} ms`;",
      'const b: string = translator.translateTemplate("{{value}} ms", { value: 1 });',
      'const c: string = translator.translateTemplate("{{latency}} ms", { latency: 1 });',
    ].join("\n");

    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Made.tsx",
          source: source,
          isHeldToEveryRule: true,
        }),
      ),
    ).toEqual([
      "1 written after a template's figure",
      "2 lone key",
      "3 lone key",
    ]);

    // The same source in another frontend: only the + rule holds there.
    const elsewhere: string =
      "packages/App/FeatureSet/StatusPage/src/Pages/Elsewhere.tsx";

    expect(
      findHandWrittenMilliseconds({
        file: elsewhere,
        source: source,
        isHeldToEveryRule: isHeldToEveryRule(elsewhere),
      }),
    ).toEqual([]);
  });

  /*
   * How the Dashboard wrote its durations outside the summaries (#7418),
   * each caught in a file that is no summary.
   */
  test("a synthetic `${x} ms` in a Dashboard file that is no summary: a trace, a breadcrumb, a ping, a topology edge", () => {
    const source: string = [
      "const a: string = `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;",
      "const b: string = `${sign}${Math.round(absMs)} ms`;",
      "const c: string = `${formatReaderFigure(value, { decimals: 1 })} ms`;",
      "const d: string = `${Math.round(avgDurationMs)}ms`;",
      "const e: string = `${amount}\\u00a0ms`;",
      "const f: string = ` · ${call.durationMs} ms`;",
    ].join("\n");
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/Made.tsx";

    expect(isMonitorSummaryFile(file)).toBe(false);
    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: file,
          source: source,
          isHeldToEveryRule: isHeldToEveryRule(file),
        }),
      ),
    ).toEqual([
      "1 written after a template's figure",
      "2 written after a template's figure",
      "3 written after a template's figure",
      "4 written after a template's figure",
      "5 written after a template's figure",
      "6 written after a template's figure",
    ]);
  });

  /*
   * How the same formatters wrote their other units (#8348): a trace's
   * seconds and microseconds, a span's nanoseconds, a cloud metric's
   * minutes, each caught in a file that is no summary.
   */
  test("the other units after a template's figure: seconds, microseconds, nanoseconds, minutes", () => {
    const source: string = [
      "const a: string = `${(ms / 1000).toFixed(2)} s`;",
      "const b: string = `${Math.round(ms * 1000)} µs`;",
      "const c: string = `${minutes}${NO_BREAK_SPACE}min`;",
      "const d: string = `${durationNano}ns`;",
      "const e: string = `${Math.round(durationMicro)}µs`;",
      "const f: string = `${(ms / 60000).toFixed(1)} min`;",
      "const g: string = `${minutes} min ${seconds} s`;",
      "const h: string = `${translator.formatNumber(seconds)}\\u00a0s`;",
      "const i: string = `${value} μs`;",
    ].join("\n");
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/Made.tsx";

    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: file,
          source: source,
          isHeldToEveryRule: isHeldToEveryRule(file),
        }),
      ),
    ).toEqual([
      "1 written after a template's figure",
      "2 written after a template's figure",
      "3 written after a template's figure",
      "4 written after a template's figure",
      "5 written after a template's figure",
      "6 written after a template's figure",
      "7 written after a template's figure",
      "8 written after a template's figure",
      "9 written after a template's figure",
    ]);
  });

  test("the English a duration helper is handed is its own: formatDurationInUnit holds its figure to its unit", () => {
    const source: string = [
      'const a: string = formatDurationInUnit(t, value, "microsecond", { decimals: 0, english: `${Math.round(value)} µs` });',
      'const b: string = write(value, "second", { english: `${value.toFixed(1)} s` });',
      // The same template anywhere else is still caught.
      "const c = { title: `${value.toFixed(1)} s` };",
    ].join("\n");

    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: "packages/App/FeatureSet/Dashboard/src/Pages/Made.ts",
          source: source,
          isHeldToEveryRule: true,
        }),
      ),
    ).toEqual(["3 written after a template's figure"]);
  });

  test("a plural's s, a CSS class's min and a word that starts with the unit are no duration", () => {
    const source: string = [
      "const a: string = `Check the open ${subjectType}s.`;",
      "const b: string = `${CELL_ROWS} min-w-0`;",
      "const c: string = `${count} sessions`;",
      "const d: string = `${count} minutes`;",
      "const e: string = `${count} seconds ago`;",
      "const f: string = `${noun}s.tf`;",
      "const g: string = `${prefix}nsx`;",
      "const h = { transition: `opacity ${seconds}s ease` };",
      "const i = () => <span>{count} sessions</span>;",
    ].join("\n");

    expect(
      findHandWrittenMilliseconds({
        file: "packages/App/FeatureSet/Dashboard/src/Components/Made.tsx",
        source: source,
        isHeldToEveryRule: true,
      }),
    ).toEqual([]);
  });

  test("the other units after a JSX figure", () => {
    const source: string = [
      "const A = () => <span>{seconds} s</span>;",
      "const B = () => <span>{micro}µs</span>;",
      "const C = () => <span>{minutes} min</span>;",
      "const D = () => <span>{nanos} ns</span>;",
    ].join("\n");

    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: "packages/App/FeatureSet/Dashboard/src/Pages/Made.tsx",
          source: source,
          isHeldToEveryRule: true,
        }),
      ),
    ).toEqual([
      "1 written after a JSX figure",
      "2 written after a JSX figure",
      "3 written after a JSX figure",
      "4 written after a JSX figure",
    ]);
  });

  test("a figure drawn in JSX and followed by 'ms'", () => {
    const source: string = [
      "const A = () => <span>{entry.durationInMs} ms</span>;",
      "const B = () => (",
      "  <div>",
      "    {span.durationMs.toLocaleString()} ms",
      "  </div>",
      ");",
      "const C = () => <>{value}ms</>;",
    ].join("\n");

    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: "packages/App/FeatureSet/Dashboard/src/Pages/Code/Task/Made.tsx",
          source: source,
          isHeldToEveryRule: true,
        }),
      ),
    ).toEqual([
      "1 written after a JSX figure",
      "4 written after a JSX figure",
      "7 written after a JSX figure",
    ]);
  });

  test("a template's figure followed by 'ms' on the monitor overview: its cards and its hero", () => {
    // How the Probes card and the hero's Latest result wrote it (#7416).
    const source: string = [
      "const a: string = `Up · ${Math.round(responseTimeInMs)} ms`;",
      "value += ` · ${Math.round(result.responseTimeInMs)} ms`;",
    ].join("\n");

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard.tsx",
      "packages/Common/Utils/Monitor/MonitorOverviewPresentationUtil.ts",
    ]) {
      expect(
        findHandWrittenMilliseconds({
          file: file,
          source: source,
          isHeldToEveryRule: isHeldToEveryRule(file),
        }).map((finding: MillisecondsFinding): string => {
          return `${finding.file}:${finding.line} ${finding.rule}`;
        }),
      ).toEqual([
        `${file}:1 written after a template's figure`,
        `${file}:2 written after a template's figure`,
      ]);
    }
  });

  test("what is no duration is left alone: a comment, 'msg', a whole sentence, a figure drawn by the helper", () => {
    const source: string = [
      '// value + " ms" was how a summary wrote it',
      'const a: string = prefix + " msg";',
      'const b: string = translator.translateTemplate("{{host}} resolved to {{addresses}} in {{time}} ms");',
      "const c: string = `${count} msgs`;",
      "const d = () => <span>{count} msgs</span>;",
      "const e = () => <span>ms {value}</span>;",
      "const f = () => (",
      "  <span>",
      "    {value}",
      "    {formatMilliseconds(translator, ms)}",
      "  </span>",
      ");",
    ].join("\n");

    expect(
      findHandWrittenMilliseconds({
        file: "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Made.tsx",
        source: source,
        isHeldToEveryRule: true,
      }),
    ).toEqual([]);
  });

  test("a CSS time is no duration: a transition, an animation, a custom property, a stylesheet", () => {
    const source: string = [
      "const a = { transition: `opacity ${EMPHASIS_TRANSITION_MS}ms ease` };",
      "const b = { animationDuration: `${props.turn.intervalMs}ms`, animationDelay: `-${elapsedMs}ms` };",
      'const c = { "--oneuptime-replay-cursor-ms": `${cursorMs}ms` };',
      "const d: string = `.stage { transition: left var(--x, ${SAMPLE_MS}ms) linear; }`;",
      "const e: string = `.stage { transition-duration: ${SAMPLE_MS}ms; }`;",
    ].join("\n");
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/Made.tsx";

    expect(
      findHandWrittenMilliseconds({
        file: file,
        source: source,
        isHeldToEveryRule: true,
      }),
    ).toEqual([]);

    // A duration in a style object's other property, or on its own, is still caught.
    expect(
      rulesOf(
        findHandWrittenMilliseconds({
          file: file,
          source: [
            "const f = { title: `${durationMs}ms` };",
            "const g: string = `${durationMs}ms`;",
            "const h: string = `${durationMs} ms ease`;",
          ].join("\n"),
          isHeldToEveryRule: true,
        }),
      ),
    ).toEqual([
      "1 written after a template's figure",
      "2 written after a template's figure",
      "3 written after a template's figure",
    ]);
  });

  test("the summary scope is the summaries, the evaluation, the hops table and the overview", () => {
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/WebsiteMonitorView.tsx",
      ),
    ).toBe(true);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetails.tsx",
      ),
    ).toBe(true);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/TracerouteHopsTable.tsx",
      ),
    ).toBe(true);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryViewer.tsx",
      ),
    ).toBe(false);
    expect(
      isMonitorSummaryFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/OverviewMade.tsx",
      ),
    ).toBe(false);
    expect(
      isMonitorSummaryFile("packages/Common/Utils/MonitorMade/Made.ts"),
    ).toBe(false);
  });
});
