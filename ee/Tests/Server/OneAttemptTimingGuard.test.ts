import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fastestRun } from "Common/Tests/Helpers/FastestRun";
import {
  OneAttemptTiming,
  findOneAttemptTimings,
  findTimedOnceTimings,
  isInOneAttemptTimingScope,
  reportOneAttemptTiming,
} from "Common/Tests/Helpers/OneAttemptTimingScan";
import {
  REPOSITORY_DIRECTORY,
  listTestFiles,
} from "Common/Tests/Helpers/TagStripScan";

/*
 * ee/'s tests hold no one attempt's time to a limit, either.
 *
 * packages/Common/Tests/Helpers/OneAttemptTimingGuard.test.ts fails a test
 * that times work with one pair of clock reads and holds that time to a
 * limit - the kind of timing that fails on a busy runner for code that has
 * not changed - and points at Tests/Helpers/FastestRun, which runs the work
 * up to three times and counts the fastest. It walks every test file of the
 * checkout, but the Common Test job removes ee/ before it runs, so in CI it
 * never reads one of ee/'s. This suite runs the same detector
 * (Common/Tests/Helpers/OneAttemptTimingScan) over ee/'s test files, from
 * ee's own jest run: the Enterprise Edition Test job, the only one with ee/
 * checked out.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

describe("ee/'s tests hold no one attempt's time to a limit", () => {
  const eeTestFiles: Array<string> = listTestFiles(EE_DIR, REPOSITORY_ROOT);

  test("the shared detector reads this checkout, and every ee/ test file is in its scope", () => {
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
    expect(eeTestFiles.length).toBeGreaterThan(50);
    expect(eeTestFiles).toEqual(
      expect.arrayContaining([
        "ee/Tests/Server/OneAttemptTimingGuard.test.ts",
        "ee/Tests/Server/Identity/SCIMFilter.test.ts",
        "ee/Tests/Server/Identity/SCIMMemberFilterLinearTime.test.ts",
      ]),
    );
    expect(eeTestFiles.filter(isInOneAttemptTimingScope)).toEqual(eeTestFiles);
  });

  test("no ee/ test file times work once and holds that time to a limit, and none is timed once on purpose", () => {
    const findings: Array<string> = [];
    const timedOnce: Array<string> = [];

    for (const file of eeTestFiles) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      findings.push(
        ...findOneAttemptTimings(file, text).map(reportOneAttemptTiming),
      );
      timedOnce.push(
        ...findTimedOnceTimings(file, text).map(reportOneAttemptTiming),
      );
    }

    expect(findings).toEqual([]);
    expect(timedOnce).toEqual([]);
  });

  test("the detector finds an ee/ test that times once, and what it points at works from ee/'s tests", () => {
    expect(
      findOneAttemptTimings(
        "ee/Tests/Server/License/LicenseKeyLinearTime.test.ts",
        [
          'test("reads a long key quickly", () => {',
          "  const started: number = Date.now();",
          "  readLicenseKey(key);",
          "  expect(Date.now() - started).toBeLessThan(2000);",
          "});",
        ].join("\n"),
      ).map((timing: OneAttemptTiming): number => {
        return timing.line;
      }),
    ).toEqual([4]);

    // Tests/Helpers/FastestRun, through the "Common/..." specifier ee/ uses.
    expect(
      fastestRun({
        run: (): number => {
          return 1 + 1;
        },
        limitInMs: 2000,
      }).result,
    ).toBe(2);
  });
});
