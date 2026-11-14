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
 * This reads every frontend's source through the TypeScript AST (comments
 * are no code), and fails on:
 *
 *   - anywhere: a figure joined to "ms" with + ("x + ' ms'"), the way the
 *     summaries wrote it;
 *   - in the monitor summaries (MONITOR_SUMMARY_SCOPE - the views every
 *     monitor type's Summary, Test Monitor and Monitoring Logs draw, the
 *     incident and alert pages' evaluation, the traceroute hops a network
 *     check's summary lists, and the monitor overview's cards and the
 *     shared monitor helpers that write its hero): "ms" written after a template's
 *     figure (`${x} ms`), or a lone duration's key ("{{value}} ms") looked
 *     up by hand instead of through formatMilliseconds. A whole sentence
 *     that holds a duration ("{{host}} resolved to {{addresses}} in
 *     {{time}} ms") words its own unit in each language, and is left to it.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const DASHBOARD_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);

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

// A lone duration's key: "{{value}} ms", "{{latency}} ms".
const LONE_DURATION_KEY: RegExp = /^\{\{\s*[\w.]+\s*\}\}\s?ms$/;

const WHITESPACE_RUN: RegExp = /\s+/g;

interface MillisecondsFinding {
  file: string;
  line: number;
  text: string;
  rule: "joined with +" | "written after a template's figure" | "lone key";
}

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

// The durations a source writes by hand, by the rules above.
const findHandWrittenMilliseconds: (data: {
  file: string;
  source: string;
  isMonitorSummary: boolean;
}) => Array<MillisecondsFinding> = (data: {
  file: string;
  source: string;
  isMonitorSummary: boolean;
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

    if (data.isMonitorSummary && ts.isTemplateExpression(node)) {
      const writesMilliseconds: boolean = node.templateSpans.some(
        (span: ts.TemplateSpan): boolean => {
          return MILLISECONDS_AFTER_FIGURE.test(span.literal.text);
        },
      );

      if (writesMilliseconds) {
        report(node, "written after a template's figure");
      }
    }

    if (
      data.isMonitorSummary &&
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
  summaryFilesRead: number;
}

// Every frontend's files are read once, for all the tests below.
let scanResult: ScanResult | undefined = undefined;

const readAllFindings: () => ScanResult = (): ScanResult => {
  if (scanResult) {
    return scanResult;
  }

  const findings: Array<MillisecondsFinding> = [];
  let filesRead: number = 0;
  let summaryFilesRead: number = 0;

  const roots: Array<string> = [
    ...listScanRoots(REPOSITORY_ROOT),
    ...SHARED_MONITOR_SUMMARY_SCOPE.map((scope: string): string => {
      return path.join(REPOSITORY_ROOT, scope);
    }),
  ];

  for (const root of roots) {
    for (const filePath of listSourceFiles(root)) {
      const file: string = toRelativePath(REPOSITORY_ROOT, filePath);
      const isMonitorSummary: boolean = isMonitorSummaryFile(file);

      filesRead++;

      if (isMonitorSummary) {
        summaryFilesRead++;
      }

      findings.push(
        ...findHandWrittenMilliseconds({
          file: file,
          source: fs.readFileSync(filePath, "utf8"),
          isMonitorSummary: isMonitorSummary,
        }),
      );
    }
  }

  scanResult = { findings, filesRead, summaryFilesRead };

  return scanResult;
};

describe("durations in milliseconds, in the reader's language", () => {
  test("no frontend joins a figure to 'ms', and no monitor summary writes 'ms' by hand", () => {
    const { findings } = readAllFindings();

    expect(
      findings.map((finding: MillisecondsFinding): string => {
        return `${finding.file}:${finding.line} (${finding.rule}) ${finding.text}`;
      }),
    ).toEqual([]);
  });

  test("the scan reads the frontends and every place a check is summarized", () => {
    const { filesRead, summaryFilesRead } = readAllFindings();

    for (const scope of MONITOR_SUMMARY_SCOPE) {
      expect({
        scope,
        exists: fs.existsSync(path.join(DASHBOARD_SOURCE, scope)),
      }).toEqual({ scope, exists: true });
    }

    for (const scope of SHARED_MONITOR_SUMMARY_SCOPE) {
      expect({
        scope,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, scope)),
      }).toEqual({ scope, exists: true });
    }

    expect(filesRead).toBeGreaterThan(1000);
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
    expect(dashboardHelper).not.toContain("translationKey(");
    expect(dashboardHelper).not.toContain("translateTemplate(");
    expect(isMonitorSummaryFile(MILLISECONDS_HELPER)).toBe(false);
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
      file: "packages/App/FeatureSet/Dashboard/src/Pages/Anywhere.tsx",
      source:
        'const a: string = responseTimeInMs + " ms";\nconst b: string = value + "ms";\n',
      isMonitorSummary: false,
    });

    expect(
      findings.map((finding: MillisecondsFinding): string => {
        return `${finding.line} ${finding.rule}`;
      }),
    ).toEqual(["1 joined with +", "2 joined with +"]);
  });

  test("a template's figure followed by 'ms', or the lone key, in a monitor summary", () => {
    const source: string = [
      "const a: string = `${Math.round(durationInMs * 100) / 100} ms`;",
      'const b: string = translator.translateTemplate("{{value}} ms", { value: 1 });',
      'const c: string = translator.translateTemplate("{{latency}} ms", { latency: 1 });',
    ].join("\n");

    expect(
      findHandWrittenMilliseconds({
        file: "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Made.tsx",
        source: source,
        isMonitorSummary: true,
      }).map((finding: MillisecondsFinding): string => {
        return `${finding.line} ${finding.rule}`;
      }),
    ).toEqual([
      "1 written after a template's figure",
      "2 lone key",
      "3 lone key",
    ]);

    // The same source outside the summaries: other pages wait for their turn.
    expect(
      findHandWrittenMilliseconds({
        file: "packages/App/FeatureSet/Dashboard/src/Pages/Elsewhere.tsx",
        source: source,
        isMonitorSummary: false,
      }),
    ).toEqual([]);
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
          isMonitorSummary: isMonitorSummaryFile(file),
        }).map((finding: MillisecondsFinding): string => {
          return `${finding.file}:${finding.line} ${finding.rule}`;
        }),
      ).toEqual([
        `${file}:1 written after a template's figure`,
        `${file}:2 written after a template's figure`,
      ]);
    }
  });

  test("what is no duration is left alone: a comment, 'msg', a whole sentence", () => {
    const source: string = [
      '// value + " ms" was how a summary wrote it',
      'const a: string = prefix + " msg";',
      'const b: string = translator.translateTemplate("{{host}} resolved to {{addresses}} in {{time}} ms");',
      "const c: string = `${count} msgs`;",
    ].join("\n");

    expect(
      findHandWrittenMilliseconds({
        file: "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Made.tsx",
        source: source,
        isMonitorSummary: true,
      }),
    ).toEqual([]);
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
