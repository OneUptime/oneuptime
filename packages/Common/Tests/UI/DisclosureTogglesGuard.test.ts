import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import {
  DisclosureFinding,
  findFixedAriaExpanded,
  findSilentShowMoreToggles,
} from "./DisclosureToggles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SHOW MORE, SHOW LESS: A DISCLOSURE SAYS WHICH WAY IT IS, FROM ITS STATE.
 *
 * Issue #5364: Create Monitor's "More monitor types" had aria-expanded
 * written as false and was drawn only while folded - pressed once, it went,
 * and the rest of the monitor types stayed open until the page was
 * reloaded. The sweep that fixed it found the same faults elsewhere: the
 * header's project picker said its list was open while it was shut
 * (aria-expanded="true"), a filter footer's two buttons each wrote their own
 * fixed value, and show more / show less buttons across the Dashboard never
 * said which way they were.
 *
 * This reads every frontend's source (each feature set's src, Common's UI,
 * and ee's screens when the checkout has them) for:
 *
 *   1. an aria-expanded written as a fixed value - true, false, "true",
 *      "false" - rather than from the state, except on a combobox, whose
 *      list is drawn for as long as the box is;
 *   2. a button whose words switch between showing more and showing less
 *      (open ? "Show less" : "Show all 12") with no aria-expanded at all.
 *
 * A control that is right to write a fixed value goes in FIXED_ON_PURPOSE
 * with why; an entry fails once it stops matching, so it cannot outlive the
 * code it excuses. The detectors are in Tests/UI/DisclosureToggles.ts and are
 * tested below on small sources of each shape.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface FixedOnPurpose {
  // How many fixed values the file writes.
  count: number;
  reason: string;
}

const FIXED_ON_PURPOSE: Record<string, FixedOnPurpose> = {
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyNodes.tsx":
    {
      count: 2,
      reason:
        "Two node types, each drawn only in its own state: a closed part's card carries Open (aria-expanded false), and the frame of a part that is open carries Close (aria-expanded true). Opening or closing swaps the node for the other type.",
    },
};

interface FileFinding extends DisclosureFinding {
  file: string;
}

function scan(
  detector: (fileName: string, source: string) => Array<DisclosureFinding>,
): Array<FileFinding> {
  const findings: Array<FileFinding> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      if (!file.endsWith(".tsx")) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");

      for (const finding of detector(file, source)) {
        findings.push({
          ...finding,
          file: toRelativePath(REPOSITORY_ROOT, file),
        });
      }
    }
  }

  return findings;
}

function describeFinding(finding: FileFinding): string {
  return `${finding.file}:${finding.line}:${finding.column} <${finding.tag}> ${finding.detail}`;
}

describe("disclosures say which way they are, from their state", () => {
  const fixed: Array<FileFinding> = scan(findFixedAriaExpanded);

  test("the scan reads the frontends, CardSelect among them", () => {
    const roots: Array<string> = listScanRoots(REPOSITORY_ROOT).map(
      (root: string): string => {
        return toRelativePath(REPOSITORY_ROOT, root);
      },
    );

    expect(roots).toContain("packages/Common/UI");
    expect(roots).toContain("packages/App/FeatureSet/Dashboard/src");
    expect(
      fs.existsSync(
        path.join(
          REPOSITORY_ROOT,
          "packages/Common/UI/Components/CardSelect/CardSelect.tsx",
        ),
      ),
    ).toBe(true);
  });

  test("no aria-expanded is written as a fixed value, but a combobox's", () => {
    const unexcused: Array<string> = fixed
      .filter((finding: FileFinding): boolean => {
        return !FIXED_ON_PURPOSE[finding.file];
      })
      .map(describeFinding);

    expect(unexcused).toEqual([]);
  });

  test("every control excused for a fixed value still writes exactly that many", () => {
    for (const file of Object.keys(FIXED_ON_PURPOSE)) {
      const count: number = fixed.filter((finding: FileFinding): boolean => {
        return finding.file === file;
      }).length;

      expect({ file, count }).toEqual({
        file,
        count: FIXED_ON_PURPOSE[file]!.count,
      });
    }
  });

  test("a show more / show less button says whether it is open", () => {
    expect(scan(findSilentShowMoreToggles).map(describeFinding)).toEqual([]);
  });
});

describe("what the detectors find", () => {
  test("the More button issue #5364 was about: a fixed false, drawn only while folded", () => {
    const source: string = `
      const More = () => (
        !isOpen && (
          <button type="button" aria-expanded={false} aria-controls={id}>
            More monitor types
          </button>
        )
      );
    `;

    expect(findFixedAriaExpanded("More.tsx", source)).toEqual([
      expect.objectContaining({
        tag: "button",
        detail: "aria-expanded={false}",
      }),
    ]);
  });

  test.each([
    'aria-expanded="true"',
    'aria-expanded="false"',
    "aria-expanded={true}",
    "aria-expanded={false}",
    'aria-expanded={"true"}',
    "ariaExpanded={true}",
    "aria-expanded",
  ])("finds %s", (attribute: string) => {
    const source: string = `const A = () => <button ${attribute}>Projects</button>;`;

    expect(findFixedAriaExpanded("A.tsx", source)).toHaveLength(1);
  });

  test.each([
    "aria-expanded={isOpen}",
    "aria-expanded={!isCollapsed}",
    "ariaExpanded={props.isShowingAll}",
    'aria-expanded={isOpen ? "true" : "false"}',
  ])("leaves %s alone", (attribute: string) => {
    const source: string = `const A = () => <button ${attribute}>More</button>;`;

    expect(findFixedAriaExpanded("A.tsx", source)).toEqual([]);
  });

  test("leaves a combobox's fixed true alone: its list is drawn for as long as it is", () => {
    const source: string = `
      const Search = () => (
        <input role="combobox" aria-expanded={true} aria-controls="list" />
      );
    `;

    expect(findFixedAriaExpanded("Search.tsx", source)).toEqual([]);
  });

  test.each([
    [
      "a ternary title on Button",
      `<Button title={isOpen ? "Hide Details" : "Show More Details"} onClick={toggle} />`,
    ],
    [
      "translated words in a button",
      `<button type="button" onClick={toggle}>{translator.translateText(isOpen ? "Show less" : "Show more")}</button>`,
    ],
    [
      "a count to show and fewer",
      `<button onClick={toggle}>{showAll ? translator.translateText("Show fewer") : translator.translatePlural({ one: "Show all {{count}} tool", other: "Show all {{count}} tools" }, count)}</button>`,
    ],
    [
      "constants named for what they say",
      `<button onClick={toggle}>{translator.translateText(isOpen ? SHOW_LESS : SHOW_WHOLE_LINE)}</button>`,
    ],
    [
      "words in a span inside the button",
      `<button type="button" onClick={toggle}><span>{isOpen ? "Show less" : "Show more"}</span></button>`,
    ],
  ])(
    "finds a show-more toggle that does not say it is open: %s",
    (_name: string, element: string) => {
      const source: string = `const A = () => (${element});`;

      expect(findSilentShowMoreToggles("A.tsx", source)).toHaveLength(1);
    },
  );

  test.each([
    [
      "aria-expanded on the button",
      `<button aria-expanded={isOpen} onClick={toggle}>{isOpen ? "Show less" : "Show more"}</button>`,
    ],
    [
      "ariaExpanded on Button",
      `<Button ariaExpanded={isOpen} title={isOpen ? "Hide Details" : "Show More Details"} onClick={toggle} />`,
    ],
    [
      "a choice that is not a fold",
      `<button onClick={toggle}>{isPaused ? "Resume" : "Pause"}</button>`,
    ],
    [
      "show more words that are not in a button",
      `<p>{hidden > 0 ? "Show 3 more" : "Show less"}</p>`,
    ],
    [
      "a label worked out in a callback the button is handed",
      `<Thing render={() => (open ? "Show less" : "Show more")} />`,
    ],
    [
      "an icon named Expand or Collapse: full screen, focus, all frames",
      `<button onClick={toggle}><Icon icon={isFullScreen ? IconProp.Collapse : IconProp.Expand} /></button>`,
    ],
    [
      "a condition that only holds the words: Fewer than / More than",
      `<button onClick={flip}>{isBelow ? "Fewer than" : "More than"}</button>`,
    ],
  ])("leaves alone: %s", (_name: string, element: string) => {
    const source: string = `const A = () => (${element});`;

    expect(findSilentShowMoreToggles("A.tsx", source)).toEqual([]);
  });
});
