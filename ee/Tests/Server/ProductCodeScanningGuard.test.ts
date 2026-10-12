import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CODE_SCANNING_FIXES,
  CodeScanningFinding,
  SHARED_REGEXP_ESCAPE_FILE,
  findCodeScanningProblems,
  listProductFiles,
  reachesCommon,
} from "Common/Tests/Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "Common/Tests/Helpers/TagStripScan";

/*
 * ee/'s product code writes nothing code scanning reports as incomplete
 * escaping or an overly large range, either.
 *
 * packages/Common/Tests/Helpers/ProductCodeScanningGuard.test.ts reads every
 * file of product code the way code scanning reads it for
 * js/incomplete-sanitization and js/overly-large-range, and fails on what it
 * would report - an escape that leaves a backslash in the text, a replace of
 * the first meta-character only, a character range wider than it looks - and
 * on a copy of the shared regular expression escape (escapeRegExp,
 * Common/Utils/RegExpEscape). The Common Test job removes ee/ before it
 * runs, so this suite runs the same reading (Common/Tests/Helpers/
 * CodeScanning) over ee/'s product code from ee's own jest run: the
 * Enterprise Edition Test job, the only one with ee/ checked out.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

describe("ee/'s product code writes nothing code scanning reports", () => {
  const files: Array<string> = listProductFiles(REPOSITORY_ROOT, ["ee"]);

  test("the shared reading reads this checkout", () => {
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
  });

  test("the walk reads ee/'s product code, and none of its tests", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^ee\/Server\//),
        expect.stringMatching(/^ee\/Dashboard\//),
      ]),
    );

    for (const file of files) {
      expect([file, file.startsWith("ee/Tests/")]).toEqual([file, false]);
      expect([file, reachesCommon(file)]).toEqual([file, true]);
    }
  });

  test("no file holds an escape that misses a backslash, a first-only replace, an overly large range or a copy of escapeRegExp", () => {
    const findings: Array<string> = [];

    for (const file of files) {
      for (const finding of findCodeScanningProblems(
        file,
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        {
          regExpEscapeFile: SHARED_REGEXP_ESCAPE_FILE,
          reachesSharedHelpers: reachesCommon,
        },
      )) {
        findings.push(reportedAs(finding));
      }
    }

    expect(findings).toEqual([]);
  }, 120000);

  test("the reading catches an ee/ file that escapes a pipe but not a backslash", () => {
    expect(
      findCodeScanningProblems(
        "ee/Server/Example.ts",
        'export const cell = (text: string): string => { return text.replace(/\\|/g, "\\\\|"); };',
        {
          regExpEscapeFile: SHARED_REGEXP_ESCAPE_FILE,
          reachesSharedHelpers: reachesCommon,
        },
      ).map((finding: CodeScanningFinding): string => {
        return finding.message;
      }),
    ).toEqual(["This does not escape backslash characters in the input."]);
  });
});

// A finding as the guard prints it: where, what, and what to use instead.
function reportedAs(finding: CodeScanningFinding): string {
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} ${finding.code} -> ${CODE_SCANNING_FIXES[finding.rule]}`;
}
