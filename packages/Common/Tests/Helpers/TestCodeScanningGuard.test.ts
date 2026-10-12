import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  CODE_SCANNING_FIXES,
  CODE_SCANNING_GUARD_OPTIONS,
  CodeScanningFinding,
  SHARED_REGEXP_ESCAPE_FILE,
  findCodeScanningProblems,
  isIgnoredByCodeScanning,
  isProductCode,
  isTestCodeFile,
  listFilesReadByCodeScanning,
  listProductFiles,
  listTestCodeFiles,
  reachesCommon,
} from "./CodeScanning";
import {
  REPOSITORY_DIRECTORY,
  importedNames,
  isTestCode,
  listTestFiles,
} from "./TagStripScan";
import { escapeRegExp } from "../../Utils/RegExpEscape";

/*
 * TESTS WRITE NOTHING CODE SCANNING REPORTS AS INCOMPLETE ESCAPING OR AN
 * OVERLY LARGE RANGE.
 *
 * Code scanning reads test code as it reads product code. It had 23
 * js/incomplete-sanitization alerts open on test files (FIXED_ALERTS below),
 * each written in place: a pattern built from a title, a host name, a key
 * or a time with only its dots or brackets escaped; a subject's Markdown
 * made by escaping its first "[" and first "]"; a Markdown table cell whose
 * "|" was escaped but not the backslashes before it; page text whose first
 * "&" was escaped for HTML; an expected header value made by replacing the
 * first quote and the first backslash; and the first "{" of an ORDER BY
 * term taken off. Each now escapes with the shared escapeRegExp
 * (Common/Utils/RegExpEscape) or markdownTableCell, spells the text out,
 * reads it whole, or builds it without a replace - and asserts what it did,
 * or more.
 *
 * This guard reads every test file of the checkout the way code scanning
 * reads it for js/incomplete-sanitization and js/overly-large-range
 * (Tests/Helpers/CodeScanning says how, query by query), and fails on what
 * it would report, so the next one is found on its pull request instead of
 * after the merge. Run over master before these fixes, it reports exactly
 * those 23 alerts, on their lines. Like the product code guard, and with
 * the same options, it also fails on a copy of the regular expression
 * escape where the shared one can be imported - 57 test files carried one,
 * and the partial escapes were written beside them - and on a pattern
 * literal Unicode normalization would change.
 *
 * The test files are what CodeScanning's isTestCodeFile takes, the other
 * half of isProductCode: every file of code under a Tests, tests or
 * __tests__ folder, every *.test.* and *.spec.* file, all of packages/E2E
 * (TagStripScan's isTestCode, the walk of the other test guards), and a
 * template in those folders, outside builds, hidden folders and the
 * directories code scanning leaves out. The Common Test job removes ee/
 * before it runs, so ee/Tests/Server/TestCodeScanningGuard.test.ts reads
 * ee/'s test files from the Enterprise Edition Test job.
 */

interface FixedAlert {
  // The code scanning alerts, by number.
  alerts: Array<number>;
  // The file they were on.
  file: string;
  // The code they were on, as it was.
  original: string;
  // What code scanning said, once per alert, in the order they are found.
  messages: Array<string>;
  // What the file does instead.
  fixedBy: string;
  // What it imports for that, if anything.
  imports: Array<string>;
}

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

// "${" and "`" of the code below, without starting or ending anything here.
const SUBSTITUTION_START: string = "$" + "{";
const BACKTICK: string = "`";

const DOES_NOT_ESCAPE_BACKSLASHES: string =
  "This does not escape backslash characters in the input.";

const firstOccurrenceOnly: (text: string) => string = (
  text: string,
): string => {
  return `This replaces only the first occurrence of ${JSON.stringify(text)}.`;
};

const ESCAPE_REGEXP: string = "escapeRegExp";
const BY_ESCAPE_REGEXP: string =
  "escapes the text with the shared escapeRegExp";

// The subject of a public note's feed item, as both note suites wrote it.
const subjectInMarkdown: (title: string) => string = (
  title: string,
): string => {
  return code(
    "const subject: string =",
    "  " +
      BACKTICK +
      SUBSTITUTION_START +
      "DEFAULT_SUBJECT_PREFIX[trigger.job]}" +
      SUBSTITUTION_START +
      title +
      "}" +
      BACKTICK,
    String.raw`    .replace("[", "\\[")`,
    String.raw`    .replace("]", "\\]");`,
  );
};

// An ORDER BY term's bound name, as both analytics suites read it.
const ORDER_BY_TERM_READ: string = String.raw`      const param: string = term.split(":")[0]!.replace("{", "");`;

// A setup guide's URL line, as the Docker and Podman suites matched it.
const URL_LINE_PATTERN: string =
  "        new RegExp(" +
  BACKTICK +
  'ONEUPTIME_URL="?' +
  SUBSTITUTION_START +
  String.raw`URL.replace(/\./g, "\\.")}"?( \\\\)?$` +
  BACKTICK +
  "),";

const FIXED_ALERTS: Array<FixedAlert> = [
  {
    alerts: [2177],
    file: "packages/Common/Tests/Server/Types/Database/Permissions/CredentialSettingsReferences.test.ts",
    original: code(
      "const refusedFor: (title: string, id: string) => RegExp = (",
      "  title: string,",
      "  id: string,",
      "): RegExp => {",
      "  return new RegExp(",
      "    " +
        BACKTICK +
        "references records that are not in this project: " +
        SUBSTITUTION_START +
        "title.replace(",
      "      /[/]/g,",
      String.raw`      "\\/",`,
      '    )} "' + SUBSTITUTION_START + 'id}"' + BACKTICK + ",",
      "  );",
      "};",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [2173, 2174],
    file: "packages/Common/Tests/Server/Utils/IRC/IRCClient.test.ts",
    original: code(
      "expect(error.message).toMatch(",
      "  new RegExp(",
      "    " +
        BACKTICK +
        "^The TLS certificate of the IRC server " +
        SUBSTITUTION_START +
        String.raw`HOST_NAME.replace(/\./g, "\\.")}:` +
        SUBSTITUTION_START +
        "fakeServer.port} is not trusted: self-signed certificate" +
        BACKTICK +
        ",",
      "  ),",
      ");",
      "expect(error.message).toMatch(",
      "  new RegExp(",
      "    " +
        BACKTICK +
        "^Could not start TLS with the IRC server " +
        SUBSTITUTION_START +
        String.raw`HOST_NAME.replace(/\./g, "\\.")}:` +
        SUBSTITUTION_START +
        "fakeServer.port}: " +
        BACKTICK +
        ",",
      "  ),",
      ");",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES, DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [2155],
    file: "packages/Common/Tests/Utils/Markdown/MarkdownEscape.test.ts",
    original: code(
      String.raw`expect(slackTextOf(value.replace(/</g, "\\<"))).toMatch(`,
      "  SLACK_CONTROL_SEQUENCE_PATTERN,",
      ");",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy:
      "escapes every punctuation character, backslashes included, and shows Slack still reads the mention",
    imports: [],
  },
  {
    alerts: [2130],
    file: "packages/Common/Tests/App/Dashboard/ProjectAiDailyLimitsSettings.test.tsx",
    original: code(
      "function inputFor(dialog: HTMLElement, title: string): HTMLInputElement {",
      "  return within(dialog).getByLabelText(",
      String.raw`    new RegExp(title.replace(/[()]/g, "\\$&")),`,
      "  ) as HTMLInputElement;",
      "}",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [2117],
    file: "packages/App/Tests/AdminDashboard/AdminSettingsSwitchesWiring.test.ts",
    original: code(
      "const pattern: RegExp = new RegExp(",
      "  " +
        BACKTICK +
        String.raw`\\bt\\(\\s*"(pages\\.` +
        SUBSTITUTION_START +
        String.raw`block.replace(/\./g, "\\.")}\\.[A-Za-z0-9_]+)"` +
        BACKTICK +
        ",",
      '  "g",',
      ");",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1869, 1870],
    file: "packages/App/FeatureSet/MCP/Tests/OAuth/BearerChallenge.test.ts",
    original: String.raw`const expected: string = all.replace('"', "'").replace("\\", "'");`,
    // The outer replace first: the backslash, then the quote.
    messages: [firstOccurrenceOnly("\\"), firstOccurrenceOnly('"')],
    fixedBy:
      "builds the expected header value character by character as the text is built",
    imports: [],
  },
  {
    alerts: [1864],
    file: "packages/Common/Tests/App/Dashboard/PodmanSetupGuide.test.ts",
    original: URL_LINE_PATTERN,
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1863],
    file: "packages/Common/Tests/App/Dashboard/DockerSetupGuide.test.ts",
    original: URL_LINE_PATTERN,
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1847],
    file: "packages/App/Tests/Dashboard/LogsTracesTimeRangeZoomWiring.test.ts",
    original: code(
      "expect(source).toMatch(",
      "  new RegExp(",
      "    " +
        BACKTICK +
        String.raw`const chartRootCursorProps: \\{ style\\?: React\\.CSSProperties \\} = ` +
        SUBSTITUTION_START +
        "condition.replace(",
      String.raw`      /\./g,`,
      String.raw`      "\\.",`,
      String.raw`    )} \\? \\{ style: \\{ cursor: "crosshair" \\} \\} : \\{\\};` +
        BACKTICK +
        ",",
      "  ),",
      ");",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1840, 1841],
    file: "packages/App/Tests/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.test.ts",
    original: subjectInMarkdown("INCIDENT_TITLE"),
    messages: [firstOccurrenceOnly("]"), firstOccurrenceOnly("[")],
    fixedBy: "spells out the subject's Markdown, its brackets escaped",
    imports: [],
  },
  {
    alerts: [1838, 1839],
    file: "packages/App/Tests/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.test.ts",
    original: subjectInMarkdown("EPISODE_TITLE"),
    messages: [firstOccurrenceOnly("]"), firstOccurrenceOnly("[")],
    fixedBy: "spells out the subject's Markdown, its brackets escaped",
    imports: [],
  },
  {
    alerts: [1832, 1833],
    file: "packages/App/Tests/Dashboard/NetworkMetricTooltipWiring.test.ts",
    original: code(
      "SOURCES.filter((source: string): boolean => {",
      "  return new RegExp(" +
        BACKTICK +
        SUBSTITUTION_START +
        String.raw`reference.replace(/\./g, "\\.")}\\b` +
        BACKTICK +
        ").test(source);",
      "});",
      "SITE_SOURCES.filter((source: string): boolean => {",
      "  return new RegExp(" +
        BACKTICK +
        SUBSTITUTION_START +
        String.raw`reference.replace(/\./g, "\\.")}\\b` +
        BACKTICK +
        ").test(source);",
      "});",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES, DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1817],
    file: "packages/Common/Tests/App/Dashboard/SecurityEventDetailPanel.test.tsx",
    original: code(
      'screen.getByRole("button", {',
      "  name: new RegExp(",
      "    " +
        BACKTICK +
        "(Show|Stop showing) " +
        SUBSTITUTION_START +
        String.raw`key.replace(/\./g, "\\.")} on event rows` +
        BACKTICK +
        ",",
      "  ),",
      "});",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1816],
    file: "packages/App/FeatureSet/BrowserRecorder/Tests/Recorder.test.ts",
    original: code(
      "document.body.innerHTML = " +
        BACKTICK +
        "<div id='app'><p>" +
        SUBSTITUTION_START +
        "PAGE_TEXT.replace(",
      '  "&",',
      '  "&amp;",',
      ")}</p><a href='https://docs.example.com/get%20started%0Anow?a=1&b=2'>docs</a></div>" +
        BACKTICK +
        ";",
    ),
    messages: [firstOccurrenceOnly("&")],
    fixedBy:
      "sets the page text as the paragraph's text, with no markup to escape it for",
    imports: [],
  },
  {
    alerts: [1805],
    file: "packages/Common/Tests/Server/Utils/Monitor/MonitorCriteriaEvaluatorBreachingSamples.test.ts",
    original: code(
      "expect(slack).toMatch(",
      "  new RegExp(" +
        BACKTICK +
        String.raw`(^|\\n)` +
        SUBSTITUTION_START +
        String.raw`i}\\.\\s+\`` +
        SUBSTITUTION_START +
        String.raw`iso(i - 1).replace(/\./g, "\\.")}\`` +
        BACKTICK +
        "),",
      ");",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy: BY_ESCAPE_REGEXP,
    imports: [ESCAPE_REGEXP],
  },
  {
    alerts: [1786],
    file: "packages/Common/Tests/App/Dashboard/SecurityEventsGuideContent.test.ts",
    original: code(
      "for (const doc of SIGMA_MODIFIER_DOCS) {",
      String.raw`  expect(writing).toContain(doc.example.replace(/\|/g, "\\|"));`,
      "}",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
    fixedBy:
      "places the example with markdownTableCell and reads it back from its row as marked reads the table",
    imports: ["markdownTableCell", "Lexer"],
  },
  {
    alerts: [1738],
    file: "packages/Common/Tests/Server/Services/AnalyticsDatabasePaginationStability.test.ts",
    original: ORDER_BY_TERM_READ,
    messages: [firstOccurrenceOnly("{")],
    fixedBy:
      "reads each ORDER BY term whole, as a bound column name and a direction",
    imports: [],
  },
  {
    alerts: [1737],
    file: "packages/Common/Tests/Server/Services/AnalyticsDatabaseSortKeyBoundary.test.ts",
    original: ORDER_BY_TERM_READ,
    messages: [firstOccurrenceOnly("{")],
    fixedBy:
      "reads each ORDER BY term whole, as a bound column name and a direction",
    imports: [],
  },
];

// Thousands of files are parsed: about ten seconds here, more on a runner.
const SCAN_TIMEOUT_IN_MS: number = 300000;

// What a file holds that the guard reports.
const problemsIn: (file: string, text: string) => Array<CodeScanningFinding> = (
  file: string,
  text: string,
): Array<CodeScanningFinding> => {
  return findCodeScanningProblems(file, text, CODE_SCANNING_GUARD_OPTIONS);
};

const rulesAndMessages: (
  findings: Array<CodeScanningFinding>,
) => Array<[string, string]> = (
  findings: Array<CodeScanningFinding>,
): Array<[string, string]> => {
  return findings.map((finding: CodeScanningFinding): [string, string] => {
    return [finding.rule, finding.message];
  });
};

// A finding as the guard prints it: where, what, and what to use instead.
const reported: (finding: CodeScanningFinding) => string = (
  finding: CodeScanningFinding,
): string => {
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} ${finding.code} -> ${CODE_SCANNING_FIXES[finding.rule]}`;
};

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
};

const EE_IS_CHECKED_OUT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIRECTORY, "ee"),
);

// What code scanning reads as code: scripts and the templates they sit in.
const CODE_OR_TEMPLATE_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs|ejs|html?)$/i;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;
const MINIFIED_FILE: RegExp = /\.min\.js$/;

// The files git tracks, by their paths from the repository's root.
const trackedFiles: () => Array<string> = (): Array<string> => {
  return childProcess
    .execFileSync("git", ["ls-files", "-z"], {
      cwd: REPOSITORY_DIRECTORY,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
    .split("\0")
    .filter((file: string): boolean => {
      return file !== "";
    });
};

describe("every test file writes nothing code scanning reports", () => {
  const files: Array<string> = listTestCodeFiles();

  test("the walk reads the test files of every package, their helpers and fixtures", () => {
    /*
     * Guards the guard: a moved folder or a broken walk would leave the scan
     * below passing over nothing.
     */
    expect(files.length).toBeGreaterThan(5000);
    expect(files).toEqual(
      expect.arrayContaining([
        "packages/Common/Tests/Helpers/TestCodeScanningGuard.test.ts",
        "packages/Common/Tests/Helpers/CodeScanning.ts",
        "packages/Common/Tests/RenderedMarkup.ts",
        "packages/App/Tests/FeatureSet/Docs/DocsTranslationChecks.ts",
        "packages/Home/Tests/ViewRendering.test.ts",
        "packages/Probe/Tests/Build/PrivateNetworkMonitorsDeploymentSurfaces.test.ts",
        "packages/E2E/Topology/Fixture.js",
        // The checkout's own Tests/ folder, outside every package.
        "Tests/Ops/CodeQlWorkflow.test.js",
        ...(EE_IS_CHECKED_OUT
          ? ["ee/Tests/Server/TestCodeScanningGuard.test.ts"]
          : []),
        ...FIXED_ALERTS.map((fixed: FixedAlert): string => {
          return fixed.file;
        }),
      ]),
    );

    // Every package that has tests: the agents, the scripts, the mobile app ...
    for (const tree of [
      "packages/App/FeatureSet/BrowserRecorder/Tests/",
      "packages/App/FeatureSet/MCP/Tests/",
      "packages/CLI/Tests/",
      "packages/Runner/Tests/",
      "packages/MobileApp/src/",
      "agents/ResourceAIAgent/Tests/",
      "Scripts/TerraformProvider/Tests/",
    ]) {
      expect([
        tree,
        files.some((file: string): boolean => {
          return file.startsWith(tree);
        }),
      ]).toEqual([tree, true]);
    }

    for (const file of files) {
      expect([file, isTestCodeFile(file), isProductCode(file)]).toEqual([
        file,
        true,
        false,
      ]);
    }

    // Nothing of a dependency, a build, a test report or a hidden folder.
    expect(
      files.filter((file: string): boolean => {
        return (
          file.includes("node_modules/") ||
          file.includes("/build/") ||
          file.includes("/dist/") ||
          file.includes("/coverage/") ||
          file.includes("/playwright-report/") ||
          file.includes("/test-results/") ||
          file.startsWith(".") ||
          file.includes("/.")
        );
      }),
    ).toEqual([]);
  });

  test("its test code is what the other test guards read, less the files code scanning skips", () => {
    // TestTagStripGuard and SeededRandomGuard walk with listTestFiles.
    expect(
      files.filter((file: string): boolean => {
        return isTestCode(file);
      }),
    ).toEqual(listTestFiles(REPOSITORY_DIRECTORY).filter(isTestCodeFile));
  });

  test("every tracked file of code is read by the product code guard or this one, never both", () => {
    /*
     * Code scanning reads what git tracks. A file of code neither guard
     * reads is one it reports on unseen: product code in a top-level folder
     * CODE_ROOTS does not name, test code this walk passes over, or a file
     * in a folder the walks skip as never the repository's (a build, a test
     * report). The checkout's root and its hidden folders hold configuration
     * (eslint.config.js, .github), and ee/ is checked out only in the
     * Enterprise Edition jobs.
     */
    const productFiles: Array<string> = listProductFiles();
    const testFileSet: Set<string> = new Set<string>(files);
    const readByAGuard: Set<string> = new Set<string>([
      ...productFiles,
      ...files,
    ]);
    const trackedCode: Array<string> = trackedFiles().filter(
      (file: string): boolean => {
        return (
          file.includes("/") &&
          !file.startsWith(".") &&
          CODE_OR_TEMPLATE_FILE.test(file) &&
          !DECLARATION_FILE.test(file) &&
          !MINIFIED_FILE.test(file) &&
          !isIgnoredByCodeScanning(file) &&
          fs.existsSync(path.join(REPOSITORY_DIRECTORY, file))
        );
      },
    );

    // Guards the check: git answered, and with the files the guards read.
    expect(trackedCode.length).toBeGreaterThan(15000);
    expect(
      productFiles.filter((file: string): boolean => {
        return testFileSet.has(file);
      }),
    ).toEqual([]);
    expect(
      trackedCode.filter((file: string): boolean => {
        return !readByAGuard.has(file);
      }),
    ).toEqual([]);
  });

  test(
    "no test file holds an escape that misses a backslash, a first-only replace, an overly large range, a copy of escapeRegExp or a normalized character",
    () => {
      const findings: Array<CodeScanningFinding> = [];

      for (const file of files) {
        findings.push(...problemsIn(file, read(file)));
      }

      // The strings ARE the message: a failure names every file, line and fix.
      expect(findings.map(reported)).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test.each(FIXED_ALERTS)(
    "$file (alerts $alerts) reads clean: it $fixedBy",
    (fixed: FixedAlert) => {
      const text: string = read(fixed.file);

      expect(problemsIn(fixed.file, text)).toEqual([]);
      expect(importedNames(fixed.file, text)).toEqual(
        expect.arrayContaining(fixed.imports),
      );
    },
  );

  test.each(FIXED_ALERTS)(
    "$file: the code of alerts $alerts is found again, in code scanning's words",
    (fixed: FixedAlert) => {
      expect(rulesAndMessages(problemsIn(fixed.file, fixed.original))).toEqual(
        fixed.messages.map((message: string): [string, string] => {
          return ["js/incomplete-sanitization", message];
        }),
      );
    },
  );

  test("lists each alert code scanning raised on a test file once", () => {
    const alerts: Array<number> = FIXED_ALERTS.flatMap(
      (fixed: FixedAlert): Array<number> => {
        return fixed.alerts;
      },
    );

    expect(alerts).toHaveLength(23);
    expect(new Set<number>(alerts).size).toBe(23);

    for (const fixed of FIXED_ALERTS) {
      expect([fixed.alerts, fixed.messages.length]).toEqual([
        fixed.alerts,
        fixed.alerts.length,
      ]);
    }
  });
});

describe("what the guard reports in a test file, and what it passes", () => {
  const FILE: string = "packages/Common/Tests/Utils/Example.test.ts";

  test("reads with the product code guard's options: one escape, wherever Common can be imported", () => {
    expect(CODE_SCANNING_GUARD_OPTIONS).toEqual({
      regExpEscapeFile: SHARED_REGEXP_ESCAPE_FILE,
      reachesSharedHelpers: reachesCommon,
    });
  });

  test("a pattern built from text with only its dots escaped is reported; with escapeRegExp it is not", () => {
    expect(
      rulesAndMessages(
        problemsIn(
          FILE,
          String.raw`const pattern: RegExp = new RegExp(host.replace(/\./g, "\\."));`,
        ),
      ),
    ).toEqual([["js/incomplete-sanitization", DOES_NOT_ESCAPE_BACKSLASHES]]);
    expect(
      problemsIn(
        FILE,
        code(
          'import { escapeRegExp } from "../../Utils/RegExpEscape";',
          "const pattern: RegExp = new RegExp(escapeRegExp(host));",
        ),
      ),
    ).toEqual([]);
  });

  test("a first-only replace of a meta-character is reported; replaceAll, a pair that unwraps, and an anchored read are not", () => {
    expect(
      rulesAndMessages(
        problemsIn(FILE, 'const id: string = term.replace("{", "");'),
      ),
    ).toEqual([["js/incomplete-sanitization", firstOccurrenceOnly("{")]]);

    for (const line of [
      'const text: string = value.replaceAll("&", "&amp;");',
      'const inner: string = value.replace("[", "").replace("]", "");',
      "const parameter: string | undefined = ORDER_BY_TERM.exec(term)?.[1];",
    ]) {
      expect([line, problemsIn(FILE, line)]).toEqual([line, []]);
    }
  });

  test("a range across letters and punctuation is reported; script properties with the u flag are not", () => {
    const findings: Array<CodeScanningFinding> = problemsIn(
      FILE,
      "const LETTER: RegExp = /[A-z]/;",
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(
      findings.every((finding: CodeScanningFinding): boolean => {
        return finding.rule === "js/overly-large-range";
      }),
    ).toBe(true);
    expect(
      problemsIn(
        FILE,
        "const WIDE: RegExp = /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/u;",
      ),
    ).toEqual([]);
  });

  test("a copy of the escape is reported in the test files of every package that can import Common, and not elsewhere", () => {
    const copy: string =
      "const escape = (text: string): string => { return text.replace(/[.*+?^$" +
      '{}()|[\\]\\\\]/g, "\\\\$&"); };';

    for (const file of [
      "packages/Common/Tests/Utils/Example.test.ts",
      "packages/App/Tests/Dashboard/Example.test.ts",
      "packages/Home/Tests/Example.test.ts",
      "packages/Probe/Tests/Example.test.ts",
      "packages/E2E/Tests/App/Example.spec.ts",
      "ee/Tests/Server/Example.test.ts",
    ]) {
      expect([file, rulesAndMessages(problemsIn(file, copy))]).toEqual([
        file,
        [
          [
            "own regular expression escape",
            "This escapes text for a pattern with a copy of escapeRegExp.",
          ],
        ],
      ]);
    }

    for (const file of [
      "agents/ResourceAIAgent/Tests/Example.test.ts",
      "packages/MobileApp/src/utils/Example.test.ts",
      "Scripts/TerraformProvider/Tests/Example.test.ts",
      "Tests/Ops/Example.test.js",
    ]) {
      expect([file, problemsIn(file, copy)]).toEqual([file, []]);
    }
  });

  test("what a finding asks for works from a test: the shared escape matches the text and nothing else", () => {
    expect(CODE_SCANNING_FIXES["own regular expression escape"]).toContain(
      "escapeRegExp from Common/Utils/RegExpEscape",
    );

    const host: string = "irc.test.invalid";
    const pattern: RegExp = new RegExp(`^${escapeRegExp(host)}$`);

    expect(pattern.test(host)).toBe(true);
    // With only its dots escaped, "C:\d" would match "C:7".
    expect(new RegExp(`^${escapeRegExp("C:\\d")}$`).test("C:7")).toBe(false);
    expect(new RegExp(`^${escapeRegExp("C:\\d")}$`).test("C:\\d")).toBe(true);
  });
});

describe("isTestCodeFile and listTestCodeFiles, on a tree written here", () => {
  // A checkout in miniature: test code of every kind, and what is not test code.
  const TEST_CODE: Array<string> = [
    "Tests/Ops/run-suite.mjs",
    "agents/Agent/Tests/Agent.test.ts",
    "ee/Tests/Server/E.test.ts",
    "packages/App/FeatureSet/Y/__tests__/i.ts",
    "packages/App/FeatureSet/Y/j.spec.ts",
    // A template named as a test is one, wherever it is.
    "packages/App/FeatureSet/Y/Widget.spec.html",
    "packages/App/FeatureSet/Y/tests/h.ts",
    "packages/Common/Tests/Helpers/Helper.ts",
    "packages/Common/Tests/Utils/A.test.ts",
    "packages/E2E/Fixtures/page.html",
    "packages/E2E/Specs/k.ts",
    "packages/Home/Tests/Views/m.ejs",
    "packages/MobileApp/src/utils/text.test.ts",
  ];
  const NOT_TEST_CODE: Array<string> = [
    // Product code and templates.
    "packages/Common/Utils/A.ts",
    "packages/Home/Views/d.ejs",
    "packages/App/FeatureSet/X/public/index.html",
    // A declaration, a minified file, a file of no code.
    "packages/Common/Tests/Types/Some.d.ts",
    "packages/Common/Tests/Fixtures/vendor.min.js",
    "packages/Common/Tests/README.md",
    // Dependencies, builds, hidden folders, and what code scanning leaves out.
    "packages/Common/node_modules/n/Tests/index.test.js",
    "packages/Common/build/Tests/o.test.js",
    "packages/App/dist/Tests/p.test.js",
    // Reports a local run leaves behind, which git ignores.
    "packages/Common/coverage/lcov-report/Tests/Helpers/index.html",
    "packages/E2E/playwright-report/index.html",
    "packages/E2E/test-results/Some-spec/fixture.js",
    "packages/Common/.hidden/Tests/t.test.ts",
    "packages/Common/Server/Static/Vendor/tailwind/Tests/q.test.js",
  ];

  let root: string = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "test-code-scanning-"));

    for (const file of [...TEST_CODE, ...NOT_TEST_CODE]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "");
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("reads test code and the templates beside it, in the whole checkout", () => {
    expect(listTestCodeFiles(root)).toEqual([...TEST_CODE].sort());
  });

  test("reads only the folders asked for, naming files from the root", () => {
    expect(listTestCodeFiles(root, ["ee"])).toEqual([
      "ee/Tests/Server/E.test.ts",
    ]);
    expect(listTestCodeFiles(root, ["packages/E2E", "Tests"])).toEqual([
      "Tests/Ops/run-suite.mjs",
      "packages/E2E/Fixtures/page.html",
      "packages/E2E/Specs/k.ts",
    ]);
    expect(listTestCodeFiles(root, ["NotThere"])).toEqual([]);
  });

  test("is the other half of isProductCode", () => {
    for (const file of TEST_CODE) {
      expect([file, isTestCodeFile(file), isProductCode(file)]).toEqual([
        file,
        true,
        false,
      ]);
    }

    for (const file of NOT_TEST_CODE) {
      expect([file, isTestCodeFile(file)]).toEqual([file, false]);
    }

    expect(
      listFilesReadByCodeScanning(root, [""]).filter((file: string) => {
        return !isTestCodeFile(file);
      }),
    ).toEqual(listProductFiles(root, [""]));
  });

  test("reads a template in a test folder for its code, as code scanning does", () => {
    expect(
      problemsIn(
        "packages/E2E/Fixtures/page.html",
        code(
          "<html><body>",
          "<script>",
          '  var label = location.hash.replace("<", "");',
          "</script>",
          "</body></html>",
        ),
      ).map((finding: CodeScanningFinding): [number, string] => {
        return [finding.line, finding.message];
      }),
    ).toEqual([[3, firstOccurrenceOnly("<")]]);
  });
});
