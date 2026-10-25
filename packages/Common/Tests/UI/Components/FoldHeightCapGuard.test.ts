import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ClassCandidate,
  collectClassCandidates,
  describeCandidate,
} from "../../ClassStrings";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../../ForeignHiddenRuleGuard";

/*
 * A fold - a section that opens and closes - animated its height with a
 * max-height: max-h-0 folded, a big number open. The big number was a cap:
 * FoldedSection's 5,000 pixels cut off the end of the Microsoft Teams setup
 * guide (#5220), and CollapsibleSection (5,000), SideMenuSection (2,000), a
 * monitor's criteria (5,000) and a runbook's steps (5,000) cut off whatever
 * ran longer, with overflow-hidden and nothing to scroll to. Open, a fold is
 * as tall as what it holds now.
 *
 * This holds every frontend to that: no class string caps a height at a
 * thousand pixels or more. A real scroll area says so with a small cap and
 * overflow-y-auto (max-h-96, max-h-[60vh]), which this leaves alone.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// A pixel cap of four digits or more: a fold's "open" height, not a scroller.
const BIG_HEIGHT_CAP: RegExp = /(?:^|[\s:])max-h-\[(\d{4,})px\]/u;

const classStringsOf: (file: string) => Array<ClassCandidate> = (
  file: string,
): Array<ClassCandidate> => {
  return collectClassCandidates(
    toRelativePath(REPOSITORY_ROOT, file),
    fs.readFileSync(file, "utf8"),
  );
};

const findBigHeightCaps: (
  candidates: Array<ClassCandidate>,
) => Array<ClassCandidate> = (
  candidates: Array<ClassCandidate>,
): Array<ClassCandidate> => {
  return candidates.filter((candidate: ClassCandidate) => {
    return BIG_HEIGHT_CAP.test(candidate.classText);
  });
};

describe("no fold caps its open height", () => {
  test("no class string in a frontend caps a height at 1,000 pixels or more", () => {
    const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
      (root: string) => {
        return listSourceFiles(root);
      },
    );

    // The walk reached the frontends, so an empty list means something.
    expect(files.length).toBeGreaterThan(1000);

    const caps: Array<string> = files
      .flatMap((file: string) => {
        return findBigHeightCaps(classStringsOf(file));
      })
      .map(describeCandidate);

    expect(caps).toEqual([]);
  });

  test("the shared folds the guard was written for are among what it reads", () => {
    const sharedFolds: Array<string> = [
      "packages/Common/UI/Components/CollapsibleSection/CollapsibleSection.tsx",
      "packages/Common/UI/Components/SideMenu/SideMenuSection.tsx",
      "packages/Common/UI/Components/FoldedSection/FoldedSection.tsx",
    ];

    const files: Array<string> = listScanRoots(REPOSITORY_ROOT)
      .flatMap((root: string) => {
        return listSourceFiles(root);
      })
      .map((file: string) => {
        return toRelativePath(REPOSITORY_ROOT, file);
      });

    for (const fold of sharedFolds) {
      expect(files).toContain(fold);
    }
  });

  test("it finds a cap in a class string, a template's branch and a variant, and not in a scroller or a comment", () => {
    const found: Array<string> = findBigHeightCaps(
      collectClassCandidates(
        "Example.tsx",
        [
          "/* the open body was max-h-[5000px] */",
          'const a: string = "overflow-hidden max-h-[5000px] opacity-100";',
          'const b: string = `overflow-hidden ${open ? "max-h-[2000px]" : "max-h-0"}`;',
          'const c: string = "md:max-h-[1200px]";',
          'const d: string = "max-h-96 overflow-y-auto";',
          'const e: string = "max-h-[60vh] overflow-y-auto";',
          'const f: string = "max-h-[600px] overflow-y-auto";',
        ].join("\n"),
      ),
    ).map((candidate: ClassCandidate) => {
      return candidate.classText;
    });

    // The template is read as the strings it renders, its open branch among them.
    expect(found).toEqual([
      "overflow-hidden max-h-[5000px] opacity-100",
      "overflow-hidden max-h-[2000px]",
      "md:max-h-[1200px]",
    ]);
  });
});
