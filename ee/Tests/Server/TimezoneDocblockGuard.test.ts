import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PRAGMA_NOT_HONOURED_MESSAGE,
  RUNTIME_ASSIGNMENT_MESSAGE,
  TimezoneProblem,
  findTimezoneProblems,
  reportTimezoneProblem,
} from "Common/Tests/Helpers/TimezoneDocblockScan";
import {
  REPOSITORY_DIRECTORY,
  listTestFiles,
} from "Common/Tests/Helpers/TagStripScan";

/*
 * ee/'s tests that run in a zone ask for it in a docblock Jest reads, too.
 *
 * packages/Common/Tests/Helpers/TimezoneDocblockGuard.test.ts fails a Jest
 * test file that assigns process.env.TZ - which never changes the zone the
 * file runs in, since Jest's process.env is a copy - and a @timezone pragma
 * Jest never reads. It walks every test file of the checkout, but the
 * Common Test job removes ee/ before it runs, so in CI it never reads one of
 * ee/'s. This suite runs the same detector
 * (Common/Tests/Helpers/TimezoneDocblockScan) over ee/'s test files, from
 * ee's own jest run: the Enterprise Edition Test job, the only one with ee/
 * checked out.
 *
 * Here the docblock is honoured in ee/Tests/UI only: ee/jest.config.js runs
 * that project in Common's TimezoneEnvironment, and the server project in
 * Node's own.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

describe("ee/'s tests ask for a zone in a docblock Jest reads", () => {
  const eeTestFiles: Array<string> = listTestFiles(EE_DIR, REPOSITORY_ROOT);

  test("the shared detector reads this checkout", () => {
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
  });

  test("the walk reads ee/'s test files", () => {
    // Guards the guard: a broken walk would leave the scan reading nothing.
    expect(eeTestFiles.length).toBeGreaterThan(50);
    expect(eeTestFiles).toEqual(
      expect.arrayContaining([
        "ee/Tests/Server/TimezoneDocblockGuard.test.ts",
        "ee/Tests/UI/Identity/ScimForms.test.tsx",
      ]),
    );
  });

  test("no ee/ test file assigns process.env.TZ, or names a zone in a way Jest never reads", () => {
    const problems: Array<string> = [];

    for (const file of eeTestFiles) {
      problems.push(
        ...findTimezoneProblems(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        ).map(reportTimezoneProblem),
      );
    }

    expect(problems).toEqual([]);
  });

  test("the detector reads ee/'s files by their place: a server test's assignment and docblock are found, a UI test's docblock is taken", () => {
    const toPairs: (
      problems: Array<TimezoneProblem>,
    ) => Array<[number, string]> = (
      problems: Array<TimezoneProblem>,
    ): Array<[number, string]> => {
      return problems.map((problem: TimezoneProblem): [number, string] => {
        return [problem.line, problem.message];
      });
    };

    expect(
      toPairs(
        findTimezoneProblems(
          "ee/Tests/Server/License/LicenseExpiry.test.ts",
          code(
            "/** @timezone Europe/London */",
            'process.env["TZ"] = "Europe/London";',
          ),
        ),
      ),
    ).toEqual([
      [1, PRAGMA_NOT_HONOURED_MESSAGE],
      [2, RUNTIME_ASSIGNMENT_MESSAGE],
    ]);
    expect(
      toPairs(
        findTimezoneProblems(
          "ee/Tests/UI/License/LicenseExpiry.test.tsx",
          code("/** @timezone Europe/London */", ""),
        ),
      ),
    ).toEqual([]);
  });
});
