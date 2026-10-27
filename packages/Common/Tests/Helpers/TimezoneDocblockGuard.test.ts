import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PRAGMA_NOT_FIRST_MESSAGE,
  PRAGMA_NOT_HONOURED_MESSAGE,
  RUNTIME_ASSIGNMENT_MESSAGE,
  TimezoneProblem,
  UNKNOWN_ZONE_MESSAGE,
  findTimezoneProblems,
  isKnownZone,
  reportTimezoneProblem,
} from "./TimezoneDocblockScan";
import { REPOSITORY_DIRECTORY, listTestFiles } from "./TagStripScan";

/*
 * A TEST THAT RUNS IN A ZONE SAYS SO IN A DOCBLOCK JEST READS.
 *
 * Assigning process.env.TZ inside a Jest test file never changes the zone
 * the file runs in: Jest's process.env is a copy of the real one, so Date's
 * local getters, Intl and moment stay in the zone the worker started in -
 * UTC in CI. Four suites did it and so tested nothing in the zones they
 * named: DateClickhouseFormat and DateTelemetryHotPath (America/New_York,
 * against a formatter slipping onto local getters), ChartTrailingBucketGap
 * (a daylight-saving day in Europe/London) and DateColumnValue (a host on
 * Pacific time). Each now runs from a file whose first comment is a docblock
 * that names its zone (the timezone pragma), which Common's test environment
 * (Tests/Utils/TimezoneEnvironment.js) reads to set the worker's real zone
 * before the file loads, and each asserts the zone took.
 *
 * This guard reads every test file of the checkout - the walk of the other
 * test guards (Tests/Helpers/TagStripScan) - and fails on an assignment to
 * process.env.TZ inside Jest, on a @timezone pragma Jest never reads (not in
 * the file's first comment) or whose project's environment ignores it, and
 * on a zone Node does not know (it would run the file in UTC). The
 * Playwright package is left out: its specs and fixture servers run in
 * Node's own process, where process.env.TZ does set the zone. ee/'s files
 * are read by ee/Tests/Server/TimezoneDocblockGuard.test.ts, since the
 * Common Test job removes ee/ before it runs.
 */

// Thousands of files are walked; few name a zone, so few are parsed.
const SCAN_TIMEOUT_IN_MS: number = 300000;

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

// What the detector finds in a file: each problem's line and message.
const problemsIn: (file: string, text: string) => Array<[number, string]> = (
  file: string,
  text: string,
): Array<[number, string]> => {
  return findTimezoneProblems(file, text).map(
    (problem: TimezoneProblem): [number, string] => {
      return [problem.line, problem.message];
    },
  );
};

// The zone a file's first comment names, if any.
const docblockZoneOf: (file: string) => string | undefined = (
  file: string,
): string | undefined => {
  const text: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, file),
    "utf8",
  );
  const docblock: RegExpExecArray | null = DOCBLOCK.exec(text);

  return docblock ? docblock[1] : undefined;
};

const DOCBLOCK: RegExp = /^\/\*\* @timezone (\S+) \*\//;

const COMMON_TEST: string = "packages/Common/Tests/Types/Example.test.ts";

describe("every test that runs in a zone asks for it in a docblock Jest reads", () => {
  const testFiles: Array<string> = listTestFiles(REPOSITORY_DIRECTORY);
  const problems: Array<TimezoneProblem> = [];

  beforeAll(() => {
    for (const file of testFiles) {
      problems.push(
        ...findTimezoneProblems(
          file,
          fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
        ),
      );
    }
  }, SCAN_TIMEOUT_IN_MS);

  test("the walk reads the test files of every package", () => {
    // Guards the guard: a broken walk would leave the scan reading nothing.
    expect(testFiles.length).toBeGreaterThan(5000);
    expect(testFiles).toEqual(
      expect.arrayContaining([
        "packages/Common/Tests/Types/DateClickhouseFormat.test.ts",
        "packages/Common/Tests/UI/Components/XAxisDaylightSaving.test.ts",
        "packages/App/Tests/Dashboard/ChartGridStep.test.ts",
        "packages/Probe/Tests/Utils/Monitors/DigOutputLinearTime.test.ts",
      ]),
    );
  });

  test(
    "no test file assigns process.env.TZ inside Jest, or names a zone in a way Jest never reads",
    () => {
      // Nothing is excused, this file and the detector included.
      expect(problems.map(reportTimezoneProblem)).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test.each([
    [
      "packages/Common/Tests/Types/DateClickhouseFormat.test.ts",
      "America/New_York",
    ],
    [
      "packages/Common/Tests/Types/DateTelemetryHotPath.test.ts",
      "America/New_York",
    ],
    [
      "packages/Common/Tests/UI/Components/Charts/ChartTrailingBucketGapLondon.test.ts",
      "Europe/London",
    ],
    [
      "packages/Common/Tests/Types/Database/DateColumnValueHostTimezone.test.ts",
      "America/Los_Angeles",
    ],
  ])("%s runs in %s, from its docblock", (file: string, zone: string) => {
    // The four suites that used to set the zone at run time, and test in UTC.
    expect(docblockZoneOf(file)).toBe(zone);
    expect(
      fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
    ).toContain(`resolvedOptions().timeZone).toBe(\n      "${zone}",`);
  });
});

describe("the detector", () => {
  test.each([
    ['process.env["TZ"] = "Europe/London";'],
    ["process.env['TZ'] = 'Europe/London';"],
    ['process.env.TZ = "Europe/London";'],
    ['(process.env.TZ) = "Europe/London";'],
    ['process.env.TZ ||= "Europe/London";'],
    ['process.env.TZ ??= "Europe/London";'],
  ])("finds an assignment to the zone: %s", (assignment: string) => {
    expect(
      problemsIn(
        COMMON_TEST,
        code('import { test } from "@jest/globals";', "", assignment),
      ),
    ).toEqual([[3, RUNTIME_ASSIGNMENT_MESSAGE]]);
  });

  test("finds an assignment inside a test, a hook and a helper, each on its line", () => {
    expect(
      problemsIn(
        "packages/App/Tests/Example.test.ts",
        code(
          "beforeAll(() => {",
          '  process.env["TZ"] = "Asia/Tokyo";',
          "});",
          "function inZone(zone: string): void {",
          "  process.env.TZ = zone;",
          "}",
        ),
      ),
    ).toEqual([
      [2, RUNTIME_ASSIGNMENT_MESSAGE],
      [5, RUNTIME_ASSIGNMENT_MESSAGE],
    ]);
  });

  test("leaves a read of the zone, a comparison and other variables alone", () => {
    expect(
      problemsIn(
        COMMON_TEST,
        code(
          'const zone: string | undefined = process.env["TZ"];',
          'if (process.env.TZ === "UTC") {',
          "  delete process.env.TZ_DATA;",
          '  process.env["TZ_NAME"] = "x";',
          '  process.env.LANG = "en_US.UTF-8";',
          "}",
          "const text: string = 'process.env.TZ = \"Europe/London\"';",
        ),
      ),
    ).toEqual([]);
  });

  test("leaves code that runs in Node's own process alone: Playwright, node --test and the environment", () => {
    const assignment: string = 'process.env["TZ"] = "Europe/London";';

    expect(
      problemsIn("packages/E2E/Calendar/Fixture/server.js", assignment),
    ).toEqual([]);
    expect(
      problemsIn("packages/E2E/playwright.calendar-ui.config.ts", assignment),
    ).toEqual([]);
    expect(
      problemsIn(
        "packages/Common/Tests/Utils/TimezoneEnvironment.js",
        "process.env.TZ = requestedTimezone;",
      ),
    ).toEqual([]);
    // node --test runs each file in a process of its own.
    expect(
      problemsIn("agents/KubernetesCostAgent/Tests/TestEnv.ts", assignment),
    ).toEqual([]);
    expect(
      problemsIn("packages/Nginx/Tests/Example.test.js", assignment),
    ).toEqual([]);
  });

  test("takes a docblock that is the file's first comment, in Common and in ee's UI tests", () => {
    const file: string = code(
      "/** @timezone Europe/London */",
      "",
      'import { test } from "@jest/globals";',
    );

    expect(problemsIn(COMMON_TEST, file)).toEqual([]);
    expect(problemsIn("ee/Tests/UI/Example.test.tsx", file)).toEqual([]);
    expect(
      problemsIn(
        COMMON_TEST,
        code(
          "",
          "/**",
          " * @timezone America/New_York",
          " */",
          'import { test } from "@jest/globals";',
        ),
      ),
    ).toEqual([]);
  });

  test("finds a pragma that is not in the file's first comment", () => {
    expect(
      problemsIn(
        COMMON_TEST,
        code(
          'import { test } from "@jest/globals";',
          "",
          "/** @timezone Europe/London */",
        ),
      ),
    ).toEqual([[3, PRAGMA_NOT_FIRST_MESSAGE]]);
    expect(
      problemsIn(
        COMMON_TEST,
        code(
          "/* The suite. */",
          "",
          "/**",
          " * @timezone Europe/London",
          " */",
        ),
      ),
    ).toEqual([[4, PRAGMA_NOT_FIRST_MESSAGE]]);
  });

  test("finds a docblock in a jest project whose environment ignores it", () => {
    const file: string = code("/** @timezone Europe/London */", "");

    expect(problemsIn("packages/App/Tests/Example.test.ts", file)).toEqual([
      [1, PRAGMA_NOT_HONOURED_MESSAGE],
    ]);
    expect(problemsIn("ee/Tests/Server/Example.test.ts", file)).toEqual([
      [1, PRAGMA_NOT_HONOURED_MESSAGE],
    ]);
    expect(problemsIn("packages/Probe/Tests/Example.test.ts", file)).toEqual([
      [1, PRAGMA_NOT_HONOURED_MESSAGE],
    ]);
  });

  test("finds a zone Node does not know", () => {
    expect(
      problemsIn(COMMON_TEST, code("/** @timezone Europe/Londn */", "")),
    ).toEqual([[1, `${UNKNOWN_ZONE_MESSAGE}: Europe/Londn`]]);
    expect(isKnownZone("Europe/London")).toBe(true);
    expect(isKnownZone("UTC")).toBe(true);
    expect(isKnownZone("Europe/Londn")).toBe(false);
  });

  test("reads no pragma in prose, a string or a line comment", () => {
    expect(
      problemsIn(
        COMMON_TEST,
        code(
          'import { test } from "@jest/globals";',
          "/*",
          " * Start the file with a @timezone docblock to run it in a zone.",
          " */",
          "// @timezone Europe/London",
          'const docblock: string = "/** @timezone Europe/London */";',
          "const template: string = `",
          " * @timezone Europe/London",
          "`;",
        ),
      ),
    ).toEqual([]);
  });

  test("reports a problem with its file and line", () => {
    expect(
      reportTimezoneProblem({
        file: COMMON_TEST,
        line: 7,
        message: RUNTIME_ASSIGNMENT_MESSAGE,
      }),
    ).toBe(`${COMMON_TEST}:7 ${RUNTIME_ASSIGNMENT_MESSAGE}`);
  });
});
