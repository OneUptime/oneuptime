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
 * This reads the shared UI, the shared helpers and the Dashboard through the
 * TypeScript AST (a comment is no code) and fails on a template whose figure
 * is followed by a space a line breaks at and a unit's symbol, and on a
 * figure joined with + to a string that starts so (`value + " ms"`). Code
 * joins them with a no-break space (`${size}\u00A0MB`) or writes them
 * through a key (formatMilliseconds), where the Translator holds them.
 *
 * Text that is no page's keeps its plain space - a prompt, a Markdown
 * export, a stored description - each file listed in AS_WRITTEN with why.
 * A file another issue rewords whole is listed in OWNED_ELSEWHERE with
 * that issue. Both lists only shrink: a listed file that no longer joins a
 * figure to a unit with a plain space fails until it is taken off.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// The source read, relative to the repository (ee/ is not in every checkout).
const SCAN_SCOPES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/Common/Utils",
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
      node.templateSpans.some((span: ts.TemplateSpan): boolean => {
        return PLAIN_SPACE_BEFORE_A_UNIT.test(span.literal.text);
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
      PLAIN_SPACE_BEFORE_A_UNIT.test(node.right.text)
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

  test("the scan reads the shared UI, the shared helpers and the Dashboard", () => {
    const { filesRead } = readAllFindings();

    expect(filesRead["packages/Common/UI"]).toBeGreaterThan(500);
    expect(filesRead["packages/Common/Utils"]).toBeGreaterThan(200);
    expect(filesRead["packages/App/FeatureSet/Dashboard/src"]).toBeGreaterThan(
      2000,
    );
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
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
