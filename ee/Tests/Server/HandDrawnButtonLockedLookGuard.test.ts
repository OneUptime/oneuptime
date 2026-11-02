import { describe, expect, test } from "@jest/globals";
import {
  CORE_FRONTEND_DIRECTORIES,
  ENTERPRISE_FRONTEND_DIRECTORIES,
  LOCKED_LOOK_ADVICE,
  LockedLookFinding,
  LockedLookScan,
  REPOSITORY_ROOT,
  describeFinding,
  listFrontendFiles,
  readSources,
} from "Common/Tests/Helpers/HandDrawnButtonLookScan";
import path from "path";

/*
 * ee/'s frontends draw a locked button one way, too.
 *
 * packages/Common/Tests/UI/HandDrawnButtonLockedLookGuard.test.ts holds
 * every frontend to one locked look - Button's, which a button drawn by
 * hand takes from Common/UI/Components/Button/ButtonStates - and fails a
 * class string that says "locked" in a look of its own (a disabled:
 * utility, the not-allowed cursor written by hand). It reads ee/Dashboard
 * and ee/AdminDashboard when the checkout has them, but the Common Test job
 * removes ee/ before it runs, so in CI it never reads one of ee/'s. This
 * suite runs the same detector (Common/Tests/Helpers/HandDrawnButtonLookScan)
 * from ee's own jest run: the Enterprise Edition Test job, the only one with
 * ee/ checked out. It reads the core frontends as well, so a constant an ee
 * page imports is followed to where it is drawn, and reports ee/'s findings
 * only - the core ones are the Common suite's.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");

describe("ee/'s hand-drawn buttons look locked the shared way", () => {
  const enterpriseFiles: Array<string> =
    ENTERPRISE_FRONTEND_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return listFrontendFiles(directory);
      },
    );

  test("the shared detector reads this checkout, and ee/'s frontends", () => {
    expect(REPOSITORY_ROOT).toBe(path.resolve(EE_DIR, ".."));
    expect(enterpriseFiles.length).toBeGreaterThan(50);
    expect(enterpriseFiles).toEqual(
      expect.arrayContaining([
        "ee/Dashboard/TeamCompliance/ComplianceRulePresets.tsx",
      ]),
    );
  });

  test("no ee/ frontend says a button is locked in a look of its own", () => {
    const coreFiles: Array<string> = CORE_FRONTEND_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return listFrontendFiles(directory);
      },
    );

    const findings: Array<string> = new LockedLookScan(
      readSources([...enterpriseFiles, ...coreFiles]),
    )
      .findAll()
      .filter((finding: LockedLookFinding): boolean => {
        return finding.file.startsWith("ee/");
      })
      .map(describeFinding);

    if (findings.length > 0) {
      throw new Error(
        `${findings.length} class strings in ee/ draw a locked look of their own:\n\n${findings.join("\n")}\n\n${LOCKED_LOOK_ADVICE}`,
      );
    }

    expect(findings).toEqual([]);
  });
});
