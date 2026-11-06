import { describe, expect, test } from "@jest/globals";
import {
  ENTERPRISE_FRONTEND_DIRECTORIES,
  ERROR_LINES_ON_A_DARK_GROUND,
  ErrorLineOnADarkGround,
  FIELD_ERROR_COLOR_ADVICE,
  FieldErrorColorFinding,
  FieldErrorColorFindingKind,
  REPOSITORY_ROOT,
  describeFieldErrorColorFinding,
  findFieldErrorColorFindings,
  isOnADarkGround,
  listFrontendFiles,
  readSources,
} from "Common/Tests/Helpers/FieldErrorColorScan";
import path from "path";

/*
 * ee/'s frontends draw a field's error in the one red, too.
 *
 * packages/Common/Tests/UI/FieldErrorColorGuard.test.ts holds every
 * frontend to it: FieldError draws a field's error in its own red - one a
 * reader can read, 4.5:1 or more in both themes - a field's className only
 * places the line, and an error line drawn by hand is never lighter than
 * red-600. The Common Test job removes ee/ before it runs, so that suite
 * never reads one of ee/'s pages in CI. This suite runs the same reading
 * (Common/Tests/Helpers/FieldErrorColorScan) from ee's own jest run: the
 * Enterprise Edition Test job, the only one with ee/ checked out.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");

describe("ee/'s error lines are drawn in a red that can be read", () => {
  const enterpriseFiles: Array<string> =
    ENTERPRISE_FRONTEND_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return listFrontendFiles(directory);
      },
    );

  const findings: Array<FieldErrorColorFinding> = findFieldErrorColorFindings(
    readSources(enterpriseFiles),
  );

  test("the shared reading reads this checkout, and ee/'s frontends", () => {
    expect(REPOSITORY_ROOT).toBe(path.resolve(EE_DIR, ".."));
    expect(enterpriseFiles.length).toBeGreaterThan(50);
    expect(enterpriseFiles).toEqual(
      expect.arrayContaining([
        "ee/AdminDashboard/Health/DiagnosticLogs.tsx",
        "ee/Dashboard/TeamCompliance/ComplianceRulesCard.tsx",
      ]),
    );
  });

  test("no ee/ page colours a field's error, or draws an error line in a light red", () => {
    const unexplained: Array<string> = findings
      .filter((finding: FieldErrorColorFinding): boolean => {
        return !isOnADarkGround(finding);
      })
      .map(describeFieldErrorColorFinding);

    if (unexplained.length > 0) {
      throw new Error(
        `${unexplained.length} error lines in ee/ are drawn in a red of their own or one too light to read:\n\n${unexplained.join("\n")}\n\n${FIELD_ERROR_COLOR_ADVICE}`,
      );
    }

    expect(unexplained).toEqual([]);
  });

  test("every line left on a dark ground is still drawn there, and still light", () => {
    for (const entry of ERROR_LINES_ON_A_DARK_GROUND) {
      expect([
        entry.file,
        findings.some((finding: FieldErrorColorFinding): boolean => {
          return (
            finding.kind === FieldErrorColorFindingKind.LightErrorLine &&
            finding.file === entry.file &&
            finding.value === entry.value
          );
        }),
      ]).toEqual([entry.file, true]);
    }
  });

  test("each says why its ground is dark", () => {
    for (const entry of ERROR_LINES_ON_A_DARK_GROUND) {
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(
        ERROR_LINES_ON_A_DARK_GROUND.filter(
          (other: ErrorLineOnADarkGround): boolean => {
            return other.file === entry.file && other.value === entry.value;
          },
        ),
      ).toHaveLength(1);
    }
  });
});
