import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ONE_ATTEMPT_TIMING_FIX,
  OneAttemptTiming,
  findOneAttemptTimings,
  findTimedOnceTimings,
  isInOneAttemptTimingScope,
  reportOneAttemptTiming,
} from "./OneAttemptTimingScan";
import { REPOSITORY_DIRECTORY, listTestFiles } from "./TagStripScan";

/*
 * NO TEST HOLDS ONE ATTEMPT'S TIME TO A LIMIT.
 *
 * A test that times work with one pair of clock reads fails whenever one
 * attempt is slow, and on a busy runner one attempt often is: the other
 * workers, a garbage collection or a runner two to four times slower than
 * usual stall it for longer than the work takes. Such suites failed master
 * and release gates in October 2026 for code that had not changed - Gsm7Text
 * at 2,039 ms against 568 locally, ProductionReviewDiff at 2,106,
 * MarkdownEditorLongLines twice, twelve suites of #5070 at once. Each moved
 * onto Tests/Helpers/FastestRun, which runs the work up to three times,
 * counts the fastest, and counts it as it would have run on a usual runner
 * when every attempt overran on a slow one. On 2026-10-27 the 270 that were
 * still timed once (257 assertions and 13 helpers) moved onto it too.
 *
 * This guard reads every test file of the packages whose tests can import
 * FastestRun (OneAttemptTimingScan's scope: Common, App but its two npm
 * recorders, Probe, Runner, Home, CLI, TestServer, the Terraform provider's
 * scripts, ee) and fails on
 * an upper bound on the time between two clock reads, and on a helper that
 * returns it, around work that does not await. Work that awaits measures a
 * deadline - a timer, a socket, a process - and is left alone: running it
 * again would repeat what it did. A synchronous deadline says so in a
 * comment above its first clock read, "Timed once: <why>", and is listed
 * below, so each one is a decision a review sees. ee/'s files are read by
 * ee/Tests/Server/OneAttemptTimingGuard.test.ts, since the Common Test job
 * removes ee/ before it runs.
 */

// Thousands of files are walked; the few that read a clock are parsed.
const SCAN_TIMEOUT_IN_MS: number = 300000;

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

const TEST_FILE: string = "packages/Common/Tests/Utils/Example.test.ts";

// What the detector finds in a file: each finding's line and kind.
const findingsIn: (
  text: string,
  file?: string,
) => Array<[number, OneAttemptTiming["kind"]]> = (
  text: string,
  file: string = TEST_FILE,
): Array<[number, OneAttemptTiming["kind"]]> => {
  return findOneAttemptTimings(file, text).map(
    (timing: OneAttemptTiming): [number, OneAttemptTiming["kind"]] => {
      return [timing.line, timing.kind];
    },
  );
};

// The sites timed once on purpose, by file and the assertion they make.
const TIMED_ONCE_ON_PURPOSE: Array<string> = [
  // The build would hang until its own timeout; a second attempt rebuilds.
  "packages/Common/Tests/Scripts/NpmPackage/BuildNpmPackageFixture.test.ts: expect(Date.now() - started).toBeLessThan(BUILD_TIMEOUT_MS / 2);",
];

describe("no test holds one attempt's time to a limit", () => {
  const testFiles: Array<string> = listTestFiles(REPOSITORY_DIRECTORY).filter(
    isInOneAttemptTimingScope,
  );
  const findings: Array<OneAttemptTiming> = [];
  const timedOnce: Array<OneAttemptTiming> = [];

  beforeAll(() => {
    for (const file of testFiles) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );

      findings.push(...findOneAttemptTimings(file, text));
      timedOnce.push(...findTimedOnceTimings(file, text));
    }
  }, SCAN_TIMEOUT_IN_MS);

  test("the walk reads the test files of every package in scope", () => {
    // Guards the guard: a broken walk would leave the scan reading nothing.
    expect(testFiles.length).toBeGreaterThan(5000);
    expect(testFiles).toEqual(
      expect.arrayContaining([
        "packages/Common/Tests/Helpers/FastestRun.test.ts",
        "packages/Common/Tests/Utils/Sms/Gsm7Text.test.ts",
        "packages/App/Tests/Dashboard/SiteMapViewModel.test.ts",
        "packages/Probe/Tests/Utils/Syslog/SyslogStreamFramer.test.ts",
        "packages/Runner/Tests/Utils/RepositoryInstructions.test.ts",
        "packages/Home/Tests/ResellerInquiry.test.ts",
      ]),
    );
  });

  test(
    "no test file times work once and holds that time to a limit",
    () => {
      /*
       * Each line names the file, the line and the code; the fix is in
       * ONE_ATTEMPT_TIMING_FIX.
       */
      expect(findings.map(reportOneAttemptTiming)).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test("the deadlines timed once on purpose are these, each with its reason", () => {
    expect(
      timedOnce.map((timing: OneAttemptTiming): string => {
        return `${timing.file}: ${timing.code}`;
      }),
    ).toEqual(TIMED_ONCE_ON_PURPOSE);
  });

  test("what a finding says to do instead names FastestRun and the mark", () => {
    expect(ONE_ATTEMPT_TIMING_FIX).toContain("Tests/Helpers/FastestRun");
    expect(ONE_ATTEMPT_TIMING_FIX).toContain("Timed once: <why>");
  });
});

describe("the detector", () => {
  test.each([
    ["Date.now()", "toBeLessThan"],
    ["performance.now()", "toBeLessThan"],
    ["new Date().getTime()", "toBeLessThanOrEqual"],
  ])(
    "finds an upper bound on one attempt timed with %s",
    (clock: string, matcher: string) => {
      expect(
        findingsIn(
          code(
            'test("reads a long text quickly", () => {',
            `  const started: number = ${clock};`,
            "  redact(text);",
            `  expect(${clock} - started).${matcher}(2000);`,
            "});",
          ),
        ),
      ).toEqual([[4, "assertion"]]);
    },
  );

  test("finds an upper bound on a variable that holds one attempt's time", () => {
    expect(
      findingsIn(
        code(
          'test("reads a long text quickly", () => {',
          "  const startedAt: number = Date.now();",
          "  const result: string = redact(text);",
          "  const elapsed: number = Date.now() - startedAt;",
          "",
          '  expect(result).toBe("x");',
          "  expect(elapsed).toBeLessThan(2000);",
          "});",
        ),
      ),
    ).toEqual([[7, "assertion"]]);
  });

  test("finds a helper that returns one attempt's time, as an arrow and as a function", () => {
    expect(
      findingsIn(
        code(
          "const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {",
          "  const startedAt: number = Date.now();",
          "  run();",
          "  return Date.now() - startedAt;",
          "};",
          "function timed(work: () => void): number {",
          "  const start: number = performance.now();",
          "  work();",
          "  return performance.now() - start;",
          "}",
        ),
      ),
    ).toEqual([
      [4, "helper"],
      [9, "helper"],
    ]);
  });

  test("finds a timing in a loop, a test.each callback and a .tsx file", () => {
    expect(
      findingsIn(
        code(
          "test.each(CASES)('%s', (_label: string, text: string) => {",
          "  for (const unit of UNITS) {",
          "    const started: number = Date.now();",
          "    render(<Harness text={text + unit} />);",
          "    expect(Date.now() - started).toBeLessThan(2000);",
          "  }",
          "});",
        ),
        "packages/Common/Tests/UI/Example.test.tsx",
      ),
    ).toEqual([[5, "assertion"]]);
  });

  test("leaves work timed through FastestRun alone", () => {
    expect(
      findingsIn(
        code(
          "const timed: FastestRun<string> = fastestRun({",
          "  run: (): string => {",
          "    return redact(text);",
          "  },",
          "  limitInMs: 2000,",
          "});",
          "expect(timed.inMs).toBeLessThan(2000);",
          "const timeOf = (run: () => unknown): number => {",
          "  return fastestRun({ run: run, limitInMs: 2000 }).inMs;",
          "};",
        ),
      ),
    ).toEqual([]);
  });

  test("leaves work that awaits alone: a deadline cannot run twice", () => {
    expect(
      findingsIn(
        code(
          'test("gives up at the timeout", async () => {',
          "  const started: number = Date.now();",
          "  await expect(client.connect()).rejects.toThrow();",
          "  expect(Date.now() - started).toBeLessThan(5000);",
          "});",
          "async function timeOf(run: () => Promise<unknown>): Promise<number> {",
          "  const startedAt: number = Date.now();",
          "  await run();",
          "  return Date.now() - startedAt;",
          "}",
        ),
      ),
    ).toEqual([]);
  });

  test("an await in a callback the work only defines does not make the work await", () => {
    expect(
      findingsIn(
        code(
          'test("reads quickly", async () => {',
          "  const started: number = Date.now();",
          "  const later: () => Promise<void> = async (): Promise<void> => {",
          "    await flush();",
          "  };",
          "  redact(text);",
          "  expect(Date.now() - started).toBeLessThan(2000);",
          "  await later();",
          "});",
        ),
      ),
    ).toEqual([[7, "assertion"]]);
  });

  test("leaves a site marked 'Timed once:' with a reason alone, and lists it", () => {
    const marked: string = code(
      'test("fails before the build times out", () => {',
      "  // Timed once: a build run to its end; a second would build again.",
      "  const started: number = Date.now();",
      "  build();",
      "  expect(Date.now() - started).toBeLessThan(60000);",
      "});",
    );

    expect(findingsIn(marked)).toEqual([]);
    expect(
      findTimedOnceTimings(TEST_FILE, marked).map(
        (timing: OneAttemptTiming): number => {
          return timing.line;
        },
      ),
    ).toEqual([5]);

    // A mark with no reason is no mark.
    expect(
      findingsIn(
        code(
          'test("fails before the build times out", () => {',
          "  // Timed once:",
          "  const started: number = Date.now();",
          "  build();",
          "  expect(Date.now() - started).toBeLessThan(60000);",
          "});",
        ),
      ),
    ).toEqual([[5, "assertion"]]);
  });

  test("leaves lower bounds, timestamps and other clocks alone", () => {
    expect(
      findingsIn(
        code(
          'test("waits at least the back-off", () => {',
          "  const started: number = Date.now();",
          "  retryOnce();",
          "  expect(Date.now() - started).toBeGreaterThanOrEqual(1000);",
          "  // A record stamped a moment ago, not work timed.",
          "  expect(Date.now() - record.createdAt.getTime()).toBeLessThan(5000);",
          "  expect(Date.now() - FIXED_START).toBeLessThan(5000);",
          "  const window: number = Date.now() - 60000;",
          "  expect(window).toBeLessThan(Date.now());",
          "});",
        ),
      ),
    ).toEqual([]);
  });

  test("reads the start a name refers to where it is used, when two tests name theirs alike", () => {
    expect(
      findingsIn(
        code(
          'test("one", async () => {',
          "  const started: number = Date.now();",
          "  await connect();",
          "  expect(Date.now() - started).toBeLessThan(5000);",
          "});",
          'test("two", () => {',
          "  const started: number = Date.now();",
          "  redact(text);",
          "  expect(Date.now() - started).toBeLessThan(2000);",
          "});",
        ),
      ),
    ).toEqual([[9, "assertion"]]);
  });

  test("reports a finding with its file, its line and its code", () => {
    expect(
      reportOneAttemptTiming({
        file: TEST_FILE,
        line: 4,
        kind: "assertion",
        code: "expect(Date.now() - started).toBeLessThan(2000);",
      }),
    ).toBe(
      `${TEST_FILE}:4 holds one attempt's time to a limit: expect(Date.now() - started).toBeLessThan(2000);`,
    );
    expect(
      reportOneAttemptTiming({
        file: TEST_FILE,
        line: 9,
        kind: "helper",
        code: "return Date.now() - startedAt;",
      }),
    ).toBe(
      `${TEST_FILE}:9 returns the time of one attempt: return Date.now() - startedAt;`,
    );
  });
});

describe("the packages the guard reads", () => {
  test.each([
    ["packages/Common/Tests/Utils/X.test.ts", true],
    ["packages/App/Tests/Dashboard/X.test.ts", true],
    ["packages/App/FeatureSet/MCP/Tests/X.test.ts", true],
    ["packages/Probe/Tests/X.test.ts", true],
    ["packages/Runner/Tests/X.test.ts", true],
    ["packages/Home/Tests/X.test.ts", true],
    ["packages/CLI/Tests/X.test.ts", true],
    ["ee/Tests/Server/X.test.ts", true],
    // Playwright, node --test without Common, plain JavaScript, jest-expo.
    ["packages/E2E/Tests/X.spec.ts", false],
    ["agents/ResourceAIAgent/Tests/X.test.ts", false],
    ["packages/Nginx/Tests/X.test.js", false],
    ["Tests/Ops/X.test.js", false],
    ["packages/MobileApp/src/X.test.ts", false],
    // Published from inside App to npm, each with its own jest and no Common.
    ["packages/App/FeatureSet/MobileRecorder/Tests/X.test.ts", false],
    ["packages/App/FeatureSet/BrowserRecorder/Tests/X.test.ts", false],
  ])("%s: %s", (file: string, inScope: boolean) => {
    expect(isInOneAttemptTimingScope(file)).toBe(inScope);
  });
});
