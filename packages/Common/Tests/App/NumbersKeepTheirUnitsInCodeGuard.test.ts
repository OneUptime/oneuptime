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
 * This reads the shared UI, the shared helpers and the Dashboard through the
 * TypeScript AST (a comment is no code) and fails on a template whose figure
 * is followed by a space a line breaks at and a unit's symbol, or by such a
 * space and a unit picked from a list (`${size} ${units[index]}`, the
 * byte formatters' "MiB" and "GiB"), and on a figure joined with + to a
 * string that starts so (`value + " ms"`). Code
 * joins them with a no-break space (`${size}\u00A0MB`) or writes them
 * through a key (formatMilliseconds), where the Translator holds them.
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
  "packages/Common/Utils/SecurityEvent/TelemetryScan/FlowSignals.ts":
    "a security signal's message, stored by the server's scan",
  "packages/Common/Utils/Slo/SloFeedMarkdown.ts":
    "an SLO feed item the server writes and stores as Markdown",
  "packages/Common/Utils/AuditLog/AuditLogValues.ts":
    "what an audit entry records in place of JSON too large to keep, stored and sent to syslog as written",
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

// A run of spaces a line breaks at, and nothing else.
const ONLY_PLAIN_SPACES: RegExp = /^[ \u2000-\u2006\u2008-\u200A\u205F]+$/;

// A unit picked from a list: `units[index]`, `BYTE_UNITS[unit]`.
const UNIT_FROM_A_LIST: RegExp =
  /^(?:[A-Z_]*UNITS|units)\[[^\]]+\](?:\s*as\s+string|!)?$/;

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
      node.templateSpans.some(
        (span: ts.TemplateSpan, index: number): boolean => {
          const next: ts.TemplateSpan | undefined =
            node.templateSpans[index + 1];

          return (
            PLAIN_SPACE_BEFORE_A_UNIT.test(span.literal.text) ||
            (ONLY_PLAIN_SPACES.test(span.literal.text) &&
              next !== undefined &&
              UNIT_FROM_A_LIST.test(next.expression.getText(sourceFile)))
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
          "const m: string = `systemctl ${verb} ${unit}`;",
          "const n: string = `${value} ${units}`;",
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

// Files another issue rewrites, each with the issue: a unit held in a variable.
const INTL_OWNED_ELSEWHERE: Readonly<Record<string, string>> = {
  "packages/Common/Utils/ValueFormatter.ts": "#8457",
};

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
};

// Files another issue rewords, each with the issue.
const WORDS_OWNED_ELSEWHERE: Readonly<Record<string, string>> = {
  ...OWNED_ELSEWHERE,
  // English sentences built in code with a duration's word (#8695).
  "packages/App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/PollingIntervalLabels.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/EntityRiskGuide.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Processes.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Services.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Logs/Settings/RecordingRules.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation.ts": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx": "#8695",
  "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName.ts": "#8695",
  "packages/Common/Types/AI/AIAgentRunLimits.ts": "#8695",
  "packages/Common/Types/AI/CodeTask.ts": "#8695",
  "packages/Common/Types/AI/InvestigationRuleWait.ts": "#8695",
  "packages/Common/Types/Alert/AlertIncidentRuleWait.ts": "#8695",
  "packages/Common/Types/AuditLog/AuditLogSessionEvent.ts": "#8695",
  "packages/Common/Types/DataObservability/DataReconciliation.ts": "#8695",
  "packages/Common/Types/DataSecurity/DataSecurityCheckCatalog.ts": "#8695",
  "packages/Common/Types/NetworkController/NetworkControllerConnectionSettings.ts": "#8695",
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
  "packages/Common/Utils/SessionReplay/SessionReplayBudgetMetricType.ts": "#8695",
  "packages/Common/Utils/Telemetry/TelemetryIngestionBudgetMetricType.ts": "#8695",
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
