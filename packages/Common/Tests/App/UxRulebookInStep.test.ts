import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE UX RULEBOOK AND ITS GUARDS STAY IN STEP (#6833).
 *
 * Docs/ux/README.md is the rulebook a person reads before building a page:
 * every rule ends with the test that enforces it, or says "Not enforced: use
 * judgement". Each of those tests starts with one line pointing back to the
 * section of its rule:
 *
 *   // UX rule: Docs/ux/README.md#steps
 *
 * The rules used to live only in the headers of about sixty guards, so a
 * person learned them by failing tests one at a time. This suite keeps the
 * written rules and the guards from drifting apart. It fails when:
 *
 *   - the guide links a file, a folder or a section that does not exist;
 *   - a test the guide names does not carry its UX rule line, carries two,
 *     or its line names a section that does not name the test;
 *   - a test carries a UX rule line (or something close to one) for a
 *     section that does not name it;
 *   - a rule names no test and does not say "Not enforced: use judgement";
 *   - a test named *Guard* in one of the UX test folders carries no UX rule
 *     line and is not listed in NOT_UX_GUARDS with its reason, or an entry
 *     there no longer matches a guard.
 *
 * The checks are pure functions over the guide's text and what the scan
 * found, pinned on small fixtures first and then run on the repository.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

export const GUIDE_PATH: string = "Docs/ux/README.md";

const THIS_SUITE: string = "packages/Common/Tests/App/UxRulebookInStep.test.ts";

// Where a test that enforces a UX rule can live.
const SCANNED_ROOTS: Array<string> = [
  "packages/Common/Tests",
  "packages/App/Tests",
  "packages/E2E",
  "Tests/Ops",
];

// The folders whose *Guard* tests are about what a person sees, unless listed below.
export const UX_FOLDERS: Array<string> = [
  "packages/Common/Tests/UI",
  "packages/Common/Tests/App",
  "packages/App/Tests/Dashboard",
];

/*
 * Guards in the UX folders that keep something other than what a person sees
 * or reads: security and permissions, performance, the build, how the
 * browser treats the app. Each with the reason it is not in the guide.
 */
export const NOT_UX_GUARDS: Record<string, string> = {
  "packages/Common/Tests/UI/ButtonMarginTakeBackGuard.test.ts":
    "Styling mechanics: where a box takes back the shared Button's own margin.",
  "packages/Common/Tests/UI/Components/CountModelSideMenuItemGuard.test.tsx":
    "Performance: a side menu's count badge does not fetch again on every render.",
  "packages/Common/Tests/UI/Components/EditionLabelLicenseWritesGuard.test.tsx":
    "Licensing: the Apache-2.0 edition dialog only reads the license.",
  "packages/Common/Tests/UI/Components/PeoplePicker/AvatarInitialsGuard.test.ts":
    "Code health: a name's initials are worked out by one helper.",
  "packages/Common/Tests/UI/Components/ShortcutDialogGuard.test.tsx":
    "A contract between the keyboard shortcuts and Modal's aria-modal.",
  "packages/Common/Tests/UI/Components/Workflow/WorkflowViewOnlyEveryStepGuard.test.tsx":
    "Permissions: a workflow's view-only Builder changes nothing.",
  "packages/Common/Tests/UI/Components/Workflow/WorkflowViewOnlyGuard.test.ts":
    "Permissions: every Builder control honours the view-only Builder.",
  "packages/Common/Tests/UI/ForeignHiddenRuleGuard.test.ts":
    "Browser robustness: a stylesheet the app does not ship cannot hide the navigation.",
  "packages/Common/Tests/UI/HookOrderGuard.test.ts":
    "Code health: React hooks run in the same order on every render.",
  "packages/Common/Tests/UI/LazyLoadedLibrariesGuard.test.ts":
    "The build: libraries loaded with import() are ES modules.",
  "packages/Common/Tests/UI/SearchBoxesNeverUnsavedGuard.test.ts":
    "New-version mechanics: what a search box holds never delays a reload.",
  "packages/Common/Tests/UI/Utils/BrowserStorageKeptPerProjectGuard.test.ts":
    "Browser storage: what each tab keeps, and under which project.",
  "packages/Common/Tests/UI/Utils/ForeignDomMutationGuard.test.tsx":
    "Browser robustness: extensions that move React's nodes do not take a page down.",
  "packages/Common/Tests/UI/Utils/PermissionGateGuard.test.ts":
    "Permissions: the Dashboard decides what a person may do by the server's rule.",
  "packages/Common/Tests/App/Dashboard/FlowViewportGuard.test.tsx":
    "Tests the FlowViewportGuard component, which keeps the Service Map on its canvas.",
  "packages/Common/Tests/App/Dashboard/PrivateRecordGatesGuard.test.ts":
    "Permissions: a private record's gates ask with its owning teams' scope.",
};

// Sections of the guide that hold no rules: the principles and the guide's own upkeep.
const SECTIONS_WITHOUT_RULES: Array<string> = [
  "",
  "the-oneuptime-ux-rulebook",
  "principles",
  "rules-still-to-come",
  "adding-a-rule-or-a-guard",
];

export const JUDGEMENT: string = "Not enforced: use judgement.";

const MARKER_PREFIX: string = "// UX rule: ";

export const MARKER_PATTERN: RegExp =
  /^\/\/ UX rule: Docs\/ux\/README\.md#([a-z0-9-]+)$/;

// Something that reads like a UX rule line, written any way.
const MARKER_LIKE_PATTERN: RegExp = /UX rule\s*:/i;

const TEST_FILE_PATTERN: RegExp = /\.(test|spec)\.(ts|tsx|js)$/;

// A Markdown link: [words](target). The words may run over a line break.
const LINK_PATTERN: RegExp = /\[[^\]]*\]\(([^)\s]+)\)/g;

const HEADING_PATTERN: RegExp = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

const FENCE_PATTERN: RegExp = /^\s*(```|~~~)/;

// A link that names a scheme (https:, mailto:) leaves the repository.
const EXTERNAL_LINK_PATTERN: RegExp = /^[a-z][a-z0-9+.-]*:/i;

// An indented line carries on the bullet above it.
const CONTINUATION_PATTERN: RegExp = /^\s+\S/;

// How much of a file's top is read for its UX rule line.
const HEADER_BYTES: number = 4096;

export interface GuideSection {
  anchor: string;
  title: string;
  level: number;
  text: string;
}

export interface FoundMarker {
  anchors: Array<string>;
  malformed: Array<string>;
}

export interface RulebookInputs {
  guide: string;
  exists: (repositoryPath: string) => boolean;
  markers: Map<string, FoundMarker>;
  uxFolderGuards: Array<string>;
  notUxGuards: Record<string, string>;
  keeper: string;
}

// The anchor GitHub gives a heading.
export function headingAnchor(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function guideSections(markdown: string): Array<GuideSection> {
  const sections: Array<GuideSection> = [
    { anchor: "", title: "", level: 0, text: "" },
  ];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    const current: GuideSection = sections[sections.length - 1]!;

    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      current.text += line + "\n";
      continue;
    }

    const heading: RegExpExecArray | null = inFence
      ? null
      : HEADING_PATTERN.exec(line);

    if (heading) {
      sections.push({
        anchor: headingAnchor(heading[2]!),
        title: heading[2]!,
        level: heading[1]!.length,
        text: "",
      });
      continue;
    }

    current.text += line + "\n";
  }

  return sections;
}

// Every link target in a stretch of the guide, as written.
export function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

export function isExternalLink(target: string): boolean {
  return EXTERNAL_LINK_PATTERN.test(target);
}

// A link from the guide, as a path from the repository's root (no #section).
export function repositoryPathOf(target: string): string {
  const withoutSection: string = target.split("#")[0]!;

  return path.posix.normalize(
    path.posix.join(path.posix.dirname(GUIDE_PATH), withoutSection),
  );
}

export function isTestFile(repositoryPath: string): boolean {
  return TEST_FILE_PATTERN.test(repositoryPath);
}

export function testsLinkedIn(text: string): Array<string> {
  return linkTargets(text)
    .filter((target: string): boolean => {
      return !isExternalLink(target) && !target.startsWith("#");
    })
    .map(repositoryPathOf)
    .filter(isTestFile);
}

// The guide's rules in a section: each bullet that opens with words in bold, with its lines joined.
export function rulesIn(text: string): Array<string> {
  const rules: Array<string> = [];
  let current: string | null = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("- **")) {
      if (current !== null) {
        rules.push(current);
      }

      current = line;
      continue;
    }

    if (current !== null && CONTINUATION_PATTERN.test(line)) {
      current += "\n" + line.trim();
      continue;
    }

    if (current !== null) {
      rules.push(current);
      current = null;
    }
  }

  if (current !== null) {
    rules.push(current);
  }

  return rules;
}

export type RuleVerdict = "enforced" | "judgement" | "missing";

export function ruleVerdict(rule: string): RuleVerdict {
  const enforcedAt: number = rule.search(/Enforced\s+by/);

  if (enforcedAt >= 0 && testsLinkedIn(rule.slice(enforcedAt)).length > 0) {
    return "enforced";
  }

  if (rule.replace(/\s+/g, " ").includes(JUDGEMENT)) {
    return "judgement";
  }

  return "missing";
}

// The UX rule lines at the top of a test file, and lines that look like one but are not.
export function markersIn(header: string): FoundMarker {
  const found: FoundMarker = { anchors: [], malformed: [] };

  for (const rawLine of header.split("\n")) {
    const line: string = rawLine.trim();
    const marker: RegExpExecArray | null = MARKER_PATTERN.exec(line);

    if (marker) {
      found.anchors.push(marker[1]!);
    } else if (MARKER_LIKE_PATTERN.test(line)) {
      found.malformed.push(line);
    }
  }

  return found;
}

function shortRule(rule: string): string {
  const firstLine: string = rule.split("\n")[0]!;

  return firstLine.length > 90 ? firstLine.slice(0, 90) + "..." : firstLine;
}

export function rulebookProblems(inputs: RulebookInputs): Array<string> {
  const problems: Array<string> = [];
  const sections: Array<GuideSection> = guideSections(inputs.guide);
  const anchors: Set<string> = new Set<string>();

  for (const section of sections) {
    if (section.level === 0) {
      continue;
    }

    if (anchors.has(section.anchor)) {
      problems.push(
        `${GUIDE_PATH} has two sections whose anchor is #${section.anchor}: a UX rule line could not say which it means.`,
      );
    }

    anchors.add(section.anchor);
  }

  // Which sections name each test.
  const sectionsLinking: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  for (const section of sections) {
    for (const target of linkTargets(section.text)) {
      if (isExternalLink(target)) {
        continue;
      }

      if (target.startsWith("#")) {
        if (!anchors.has(target.slice(1))) {
          problems.push(
            `${GUIDE_PATH} links ${target}, which is not a section of it.`,
          );
        }

        continue;
      }

      const linked: string = repositoryPathOf(target);

      if (!inputs.exists(linked)) {
        problems.push(
          `${GUIDE_PATH} links ${linked}, which does not exist. A guard that moved or was renamed is linked by its new path.`,
        );
        continue;
      }

      if (isTestFile(linked) && linked !== inputs.keeper) {
        const linking: Set<string> =
          sectionsLinking.get(linked) || new Set<string>();
        linking.add(section.anchor);
        sectionsLinking.set(linked, linking);
      }
    }

    if (section.level > 0 && !SECTIONS_WITHOUT_RULES.includes(section.anchor)) {
      for (const rule of rulesIn(section.text)) {
        if (ruleVerdict(rule) === "missing") {
          problems.push(
            `The rule "${shortRule(rule)}" in #${section.anchor} names no test: end it with "Enforced by" and a link to its guard, or with "${JUDGEMENT}"`,
          );
        }
      }
    }
  }

  // Every test the guide names points back to a section that names it.
  for (const [test, linking] of Array.from(sectionsLinking.entries()).sort()) {
    const marker: FoundMarker | undefined = inputs.markers.get(test);
    const named: string = Array.from(linking)
      .map((anchor: string): string => {
        return `#${anchor}`;
      })
      .join(", ");

    if (!marker || marker.anchors.length === 0) {
      problems.push(
        `${test} is named in ${GUIDE_PATH} (${named}) but does not start with its line "${MARKER_PREFIX}${GUIDE_PATH}#<section>".`,
      );
      continue;
    }

    if (marker.anchors.length > 1) {
      problems.push(
        `${test} has ${marker.anchors.length} UX rule lines; a guard points to the one section of its rule.`,
      );
    }
  }

  // Every test that says it enforces a rule is named in the section it points to.
  for (const [test, marker] of Array.from(inputs.markers.entries()).sort()) {
    for (const line of marker.malformed) {
      problems.push(
        `${test} has a line that reads like a UX rule line but is not one: "${line}". Write it as "${MARKER_PREFIX}${GUIDE_PATH}#<section>".`,
      );
    }

    for (const anchor of marker.anchors) {
      if (!anchors.has(anchor)) {
        problems.push(
          `${test} points to ${GUIDE_PATH}#${anchor}, which is not a section of the guide.`,
        );
        continue;
      }

      const linking: Set<string> | undefined = sectionsLinking.get(test);

      if (!linking) {
        problems.push(
          `${test} enforces a UX rule but ${GUIDE_PATH} does not name it: add its rule to #${anchor}, ending with "Enforced by" and a link to it.`,
        );
      } else if (!linking.has(anchor)) {
        problems.push(
          `${test} points to #${anchor}, but the guide names it in ${Array.from(
            linking,
          )
            .map((linkedAnchor: string): string => {
              return `#${linkedAnchor}`;
            })
            .join(", ")}.`,
        );
      }
    }
  }

  // Every guard in a UX folder belongs to a rule, or says why not.
  for (const guard of inputs.uxFolderGuards.slice().sort()) {
    const marker: FoundMarker | undefined = inputs.markers.get(guard);
    const marked: boolean = Boolean(marker && marker.anchors.length > 0);
    const listed: boolean = guard in inputs.notUxGuards;

    if (!marked && !listed) {
      problems.push(
        `${guard} is a guard in a UX test folder with no UX rule line. Add its rule to ${GUIDE_PATH} and start the guard with "${MARKER_PREFIX}${GUIDE_PATH}#<section>", or list it in NOT_UX_GUARDS with the reason.`,
      );
    }

    if (marked && listed) {
      problems.push(
        `${guard} has a UX rule line and is listed in NOT_UX_GUARDS: it is one or the other.`,
      );
    }
  }

  for (const listed of Object.keys(inputs.notUxGuards).sort()) {
    if (!inputs.uxFolderGuards.includes(listed)) {
      problems.push(
        `NOT_UX_GUARDS lists ${listed}, which is no longer a guard in a UX test folder: take it off the list.`,
      );
    }
  }

  return problems;
}

function walkTests(root: string, found: Array<string>): void {
  const absolute: string = path.join(REPOSITORY_ROOT, root);

  if (!fs.existsSync(absolute)) {
    return;
  }

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const child: string = path.posix.join(root, entry.name);

    if (entry.isDirectory()) {
      walkTests(child, found);
    } else if (entry.isFile() && isTestFile(child)) {
      found.push(child);
    }
  }
}

function readHeader(repositoryPath: string): string {
  const descriptor: number = fs.openSync(
    path.join(REPOSITORY_ROOT, repositoryPath),
    "r",
  );

  try {
    const buffer: Buffer = Buffer.alloc(HEADER_BYTES);
    const read: number = fs.readSync(descriptor, buffer, 0, HEADER_BYTES, 0);

    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function scanRepository(): {
  testFiles: Array<string>;
  markers: Map<string, FoundMarker>;
  uxFolderGuards: Array<string>;
} {
  const testFiles: Array<string> = [];

  for (const root of SCANNED_ROOTS) {
    walkTests(root, testFiles);
  }

  const markers: Map<string, FoundMarker> = new Map<string, FoundMarker>();

  for (const testFile of testFiles) {
    if (testFile === THIS_SUITE) {
      continue;
    }

    const found: FoundMarker = markersIn(readHeader(testFile));

    if (found.anchors.length > 0 || found.malformed.length > 0) {
      markers.set(testFile, found);
    }
  }

  const uxFolderGuards: Array<string> = testFiles.filter(
    (testFile: string): boolean => {
      return (
        UX_FOLDERS.some((folder: string): boolean => {
          return testFile.startsWith(folder + "/");
        }) && path.posix.basename(testFile).includes("Guard")
      );
    },
  );

  return { testFiles, markers, uxFolderGuards };
}

function existsInRepository(repositoryPath: string): boolean {
  return fs.existsSync(path.join(REPOSITORY_ROOT, repositoryPath));
}

describe("reading the guide", () => {
  test("a heading's anchor is the one GitHub gives it", () => {
    expect(headingAnchor("Steps")).toBe("steps");
    expect(headingAnchor("A product's first page")).toBe(
      "a-products-first-page",
    );
    expect(headingAnchor("Tone, capitals and buttons")).toBe(
      "tone-capitals-and-buttons",
    );
    expect(headingAnchor("Numbers, dates and plurals")).toBe(
      "numbers-dates-and-plurals",
    );
    expect(headingAnchor("The `Toggle` switch")).toBe("the-toggle-switch");
  });

  test("a heading inside a code block is not a section", () => {
    const sections: Array<GuideSection> = guideSections(
      [
        "# Guide",
        "",
        "```md",
        "## Not a section",
        "```",
        "## Forms",
        "text",
      ].join("\n"),
    );

    expect(
      sections.map((section: GuideSection): string => {
        return section.anchor;
      }),
    ).toEqual(["", "guide", "forms"]);
    expect(sections[1]!.text).toContain("## Not a section");
    expect(sections[2]!.level).toBe(2);
  });

  test("links are read with their words over a line break, as paths from the repository's root", () => {
    const text: string =
      "See [Adding a rule or a\nguard](#adding-a-rule-or-a-guard), [the docs](https://oneuptime.com/docs) and [LongFormStepsGuard](../../packages/Common/Tests/UI/Components/Forms/LongFormStepsGuard.test.ts).";

    expect(linkTargets(text)).toEqual([
      "#adding-a-rule-or-a-guard",
      "https://oneuptime.com/docs",
      "../../packages/Common/Tests/UI/Components/Forms/LongFormStepsGuard.test.ts",
    ]);
    expect(testsLinkedIn(text)).toEqual([
      "packages/Common/Tests/UI/Components/Forms/LongFormStepsGuard.test.ts",
    ]);
    expect(
      repositoryPathOf("../../packages/E2E/Journeys/README.md#run-it"),
    ).toBe("packages/E2E/Journeys/README.md");
    expect(isTestFile("packages/E2E/Journeys/Journeys.spec.ts")).toBe(true);
    expect(isTestFile("Tests/Ops/JourneyBudgets.test.js")).toBe(true);
    expect(isTestFile("Tests/Ops/JourneyBudgets.json")).toBe(false);
  });

  test("a rule is a bullet that opens in bold, with its lines joined", () => {
    const rules: Array<string> = rulesIn(
      [
        "A paragraph.",
        "",
        "- **First rule.** Why. Enforced by",
        "  [A](../../packages/App/Tests/A.test.ts).",
        "- **Second rule.** Not enforced: use",
        "  judgement.",
        "",
        "- a plain bullet, not a rule",
        "- **Third rule.**",
      ].join("\n"),
    );

    expect(rules).toEqual([
      "- **First rule.** Why. Enforced by\n[A](../../packages/App/Tests/A.test.ts).",
      "- **Second rule.** Not enforced: use\njudgement.",
      "- **Third rule.**",
    ]);
  });

  test("a rule names a test after 'Enforced by', or says it is not enforced", () => {
    expect(
      ruleVerdict(
        "- **R.** Enforced by\n[G](../../packages/App/Tests/Dashboard/G.test.ts).",
      ),
    ).toBe("enforced");
    expect(
      ruleVerdict(
        "- **R.** Enforced by [G](../../packages/App/Tests/G.test.ts) for copy buttons; for everything else, not enforced: use judgement.",
      ),
    ).toBe("enforced");
    expect(ruleVerdict("- **R.** Not enforced: use\njudgement.")).toBe(
      "judgement",
    );
    // A link before "Enforced by" is an example, not the guard.
    expect(
      ruleVerdict(
        "- **R.** Like [G](../../packages/App/Tests/G.test.ts). Enforced by review.",
      ),
    ).toBe("missing");
    // A link to something other than a test is not a guard.
    expect(
      ruleVerdict(
        "- **R.** Enforced by [the README](../../Tests/Ops/README.md).",
      ),
    ).toBe("missing");
    expect(ruleVerdict("- **R.** Why it matters.")).toBe("missing");
  });

  test("a UX rule line is one exact comment; anything close to one is reported", () => {
    expect(
      markersIn("// UX rule: Docs/ux/README.md#steps\nimport x from 'y';\n"),
    ).toEqual({ anchors: ["steps"], malformed: [] });
    expect(
      markersIn(
        "/*\n * UX rule: Docs/ux/README.md#steps\n */\n// ux rule:Docs/ux/README.md#Forms\n",
      ),
    ).toEqual({
      anchors: [],
      malformed: [
        "* UX rule: Docs/ux/README.md#steps",
        "// ux rule:Docs/ux/README.md#Forms",
      ],
    });
    expect(markersIn("import x from 'y';\n")).toEqual({
      anchors: [],
      malformed: [],
    });
  });
});

describe("what keeps the guide and the guards in step", () => {
  const KEEPER: string = "packages/Common/Tests/App/Keeper.test.ts";
  const STEPS_GUARD: string = "packages/Common/Tests/UI/StepsGuard.test.ts";
  const DIALOG_GUARD: string = "packages/Common/Tests/UI/DialogGuard.test.ts";
  const PLUMBING_GUARD: string =
    "packages/Common/Tests/UI/PlumbingGuard.test.ts";

  const GUIDE: string = [
    "# The OneUptime UX rulebook",
    "",
    "Kept by [Keeper](../../packages/Common/Tests/App/Keeper.test.ts); see [Forms](#forms).",
    "",
    "## Principles",
    "",
    "1. **Outcome before object.** A flow ends when the thing works.",
    "",
    "## Forms",
    "",
    "### Steps",
    "",
    "- **Long forms walk steps.** Enforced by",
    "  [StepsGuard](../../packages/Common/Tests/UI/StepsGuard.test.ts).",
    "- **Help comes first.** Not enforced: use judgement.",
    "",
    "## Dialogs and confirmations",
    "",
    "- **One primary button.** Enforced by",
    "  [DialogGuard](../../packages/Common/Tests/UI/DialogGuard.test.ts).",
    "",
    "## Adding a rule or a guard",
    "",
    "- **Start the guard with its line.** Run [Keeper](../../packages/Common/Tests/App/Keeper.test.ts).",
  ].join("\n");

  function inputs(overrides: Partial<RulebookInputs> = {}): RulebookInputs {
    const files: Set<string> = new Set<string>([
      KEEPER,
      STEPS_GUARD,
      DIALOG_GUARD,
      PLUMBING_GUARD,
    ]);

    return {
      guide: GUIDE,
      exists: (repositoryPath: string): boolean => {
        return files.has(repositoryPath);
      },
      markers: new Map<string, FoundMarker>([
        [STEPS_GUARD, { anchors: ["steps"], malformed: [] }],
        [
          DIALOG_GUARD,
          { anchors: ["dialogs-and-confirmations"], malformed: [] },
        ],
      ]),
      uxFolderGuards: [STEPS_GUARD, DIALOG_GUARD, PLUMBING_GUARD],
      notUxGuards: { [PLUMBING_GUARD]: "Code health." },
      keeper: KEEPER,
      ...overrides,
    };
  }

  test("a guide and guards that agree have no problems", () => {
    expect(rulebookProblems(inputs())).toEqual([]);
  });

  test("a guard the guide names that does not exist", () => {
    // Gone from the disk, so the scan found no line in it and no guard in its folder.
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.delete(DIALOG_GUARD);

    expect(
      rulebookProblems(
        inputs({
          exists: (repositoryPath: string): boolean => {
            return repositoryPath !== DIALOG_GUARD;
          },
          markers,
          uxFolderGuards: [STEPS_GUARD, PLUMBING_GUARD],
        }),
      ),
    ).toEqual([
      `${GUIDE_PATH} links ${DIALOG_GUARD}, which does not exist. A guard that moved or was renamed is linked by its new path.`,
    ]);
  });

  test("a guard the guide names that does not point back", () => {
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.delete(STEPS_GUARD);

    expect(rulebookProblems(inputs({ markers }))).toEqual([
      `${STEPS_GUARD} is named in ${GUIDE_PATH} (#steps) but does not start with its line "// UX rule: ${GUIDE_PATH}#<section>".`,
      `${STEPS_GUARD} is a guard in a UX test folder with no UX rule line. Add its rule to ${GUIDE_PATH} and start the guard with "// UX rule: ${GUIDE_PATH}#<section>", or list it in NOT_UX_GUARDS with the reason.`,
    ]);
  });

  test("a guard that points to a section that does not name it", () => {
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.set(STEPS_GUARD, { anchors: ["forms"], malformed: [] });

    expect(rulebookProblems(inputs({ markers }))).toEqual([
      `${STEPS_GUARD} points to #forms, but the guide names it in #steps.`,
    ]);
  });

  test("a guard that points to a section the guide does not have", () => {
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.set(STEPS_GUARD, { anchors: ["wizards"], malformed: [] });

    expect(rulebookProblems(inputs({ markers }))).toEqual([
      `${STEPS_GUARD} points to ${GUIDE_PATH}#wizards, which is not a section of the guide.`,
    ]);
  });

  test("a guard with two UX rule lines", () => {
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.set(STEPS_GUARD, { anchors: ["steps", "steps"], malformed: [] });

    expect(rulebookProblems(inputs({ markers }))).toEqual([
      `${STEPS_GUARD} has 2 UX rule lines; a guard points to the one section of its rule.`,
    ]);
  });

  test("a guard that says it enforces a rule the guide does not name it for", () => {
    const elsewhere: string =
      "packages/App/Tests/Notification/WordsGuard.test.ts";
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.set(elsewhere, { anchors: ["steps"], malformed: [] });

    expect(rulebookProblems(inputs({ markers }))).toEqual([
      `${elsewhere} enforces a UX rule but ${GUIDE_PATH} does not name it: add its rule to #steps, ending with "Enforced by" and a link to it.`,
    ]);
  });

  test("a UX rule line written another way", () => {
    const markers: Map<string, FoundMarker> = inputs().markers;
    markers.set(DIALOG_GUARD, {
      anchors: ["dialogs-and-confirmations"],
      malformed: ["* UX rule: Docs/ux/README.md#steps"],
    });

    expect(rulebookProblems(inputs({ markers }))).toEqual([
      `${DIALOG_GUARD} has a line that reads like a UX rule line but is not one: "* UX rule: Docs/ux/README.md#steps". Write it as "// UX rule: ${GUIDE_PATH}#<section>".`,
    ]);
  });

  test("a rule that names no test and does not say it is not enforced", () => {
    const guide: string = GUIDE.replace(
      "- **Help comes first.** Not enforced: use judgement.",
      "- **Help comes first.** Say what the field does.",
    );

    expect(rulebookProblems(inputs({ guide }))).toEqual([
      `The rule "- **Help comes first.** Say what the field does." in #steps names no test: end it with "Enforced by" and a link to its guard, or with "${JUDGEMENT}"`,
    ]);
  });

  test("the principles and the guide's own upkeep are not rules", () => {
    const guide: string = GUIDE.replace(
      "1. **Outcome before object.**",
      "- **Outcome before object.**",
    );

    expect(rulebookProblems(inputs({ guide }))).toEqual([]);
  });

  test("a link to a section the guide does not have", () => {
    const guide: string = GUIDE.replace("(#forms)", "(#form)");

    expect(rulebookProblems(inputs({ guide }))).toEqual([
      `${GUIDE_PATH} links #form, which is not a section of it.`,
    ]);
  });

  test("two sections with one anchor", () => {
    const guide: string = GUIDE + "\n\n## Steps\n";

    expect(rulebookProblems(inputs({ guide }))).toEqual([
      `${GUIDE_PATH} has two sections whose anchor is #steps: a UX rule line could not say which it means.`,
    ]);
  });

  test("a guard in a UX folder that belongs to no rule and is not listed", () => {
    expect(rulebookProblems(inputs({ notUxGuards: {} }))).toEqual([
      `${PLUMBING_GUARD} is a guard in a UX test folder with no UX rule line. Add its rule to ${GUIDE_PATH} and start the guard with "// UX rule: ${GUIDE_PATH}#<section>", or list it in NOT_UX_GUARDS with the reason.`,
    ]);
  });

  test("a guard both in the guide and listed as not about the interface", () => {
    expect(
      rulebookProblems(
        inputs({
          notUxGuards: {
            [PLUMBING_GUARD]: "Code health.",
            [STEPS_GUARD]: "Listed by mistake.",
          },
        }),
      ),
    ).toEqual([
      `${STEPS_GUARD} has a UX rule line and is listed in NOT_UX_GUARDS: it is one or the other.`,
    ]);
  });

  test("an entry in NOT_UX_GUARDS that matches no guard any more", () => {
    const gone: string = "packages/Common/Tests/UI/GoneGuard.test.ts";

    expect(
      rulebookProblems(
        inputs({
          notUxGuards: { [PLUMBING_GUARD]: "Code health.", [gone]: "Gone." },
        }),
      ),
    ).toEqual([
      `NOT_UX_GUARDS lists ${gone}, which is no longer a guard in a UX test folder: take it off the list.`,
    ]);
  });
});

describe("the rulebook in this repository", () => {
  const guide: string = fs.readFileSync(
    path.join(REPOSITORY_ROOT, GUIDE_PATH),
    "utf8",
  );
  const scan: {
    testFiles: Array<string>;
    markers: Map<string, FoundMarker>;
    uxFolderGuards: Array<string>;
  } = scanRepository();

  test("the guide and every guard agree", () => {
    expect(
      rulebookProblems({
        guide,
        exists: existsInRepository,
        markers: scan.markers,
        uxFolderGuards: scan.uxFolderGuards,
        notUxGuards: NOT_UX_GUARDS,
        keeper: THIS_SUITE,
      }),
    ).toEqual([]);
  });

  test("the scan really read the test folders and the guide's guards", () => {
    // A moved folder must not empty the check: these are far below today's counts.
    expect(scan.testFiles.length).toBeGreaterThan(3000);
    expect(scan.markers.size).toBeGreaterThan(80);

    for (const folder of UX_FOLDERS) {
      expect(
        scan.uxFolderGuards.filter((guard: string): boolean => {
          return guard.startsWith(folder + "/");
        }).length,
      ).toBeGreaterThan(10);
    }

    // The guards the issue named are in the guide.
    for (const named of [
      "packages/Common/Tests/UI/Components/Forms/LongFormStepsGuard.test.ts",
      "packages/Common/Tests/UI/DialogPrimaryActionGuard.test.ts",
      "packages/App/Tests/Dashboard/ShortDescriptionsGuard.test.ts",
      "packages/Common/Tests/UI/Components/CardHeaderActionsGuard.test.tsx",
      "packages/Common/Tests/App/Dashboard/EveryPageHasATrail.test.tsx",
      "packages/App/Tests/Dashboard/SettingsFoundByName.test.ts",
      "packages/Common/Tests/UI/Components/Table/ColumnResize/TableColumnResizeCoverage.test.ts",
      "packages/App/Tests/Dashboard/GlossaryTermsPerPage.test.ts",
    ]) {
      expect(testsLinkedIn(guide)).toContain(named);
    }
  });

  test("every rule section holds rules, and most of them are enforced", () => {
    const verdicts: Array<RuleVerdict> = guideSections(guide)
      .filter((section: GuideSection): boolean => {
        return !SECTIONS_WITHOUT_RULES.includes(section.anchor);
      })
      .flatMap((section: GuideSection): Array<RuleVerdict> => {
        return rulesIn(section.text).map(ruleVerdict);
      });

    expect(verdicts.length).toBeGreaterThan(80);
    expect(
      verdicts.filter((verdict: RuleVerdict): boolean => {
        return verdict === "enforced";
      }).length,
    ).toBeGreaterThan(
      verdicts.filter((verdict: RuleVerdict): boolean => {
        return verdict === "judgement";
      }).length,
    );
  });

  test("the journey budgets are linked, not copied", () => {
    expect(guide).toContain("(../../packages/E2E/Journeys/README.md)");
    expect(guide).toContain("(../../Tests/Ops/JourneyBudgets.json)");
    expect(guide).not.toContain("## How to read a failure");
  });

  test("AGENTS.md, the contributing guide and the pull request template point to it", () => {
    const agents: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "AGENTS.md"),
      "utf8",
    );
    const simpleSection: string = agents.slice(
      agents.indexOf("### Keep OneUptime simple to use"),
      agents.indexOf(
        "\n### ",
        agents.indexOf("### Keep OneUptime simple to use") + 1,
      ),
    );

    expect(simpleSection).toContain(`[${GUIDE_PATH}](${GUIDE_PATH})`);

    expect(
      fs.readFileSync(
        path.join(REPOSITORY_ROOT, ".github/CONTRIBUTING.md"),
        "utf8",
      ),
    ).toContain(`(../${GUIDE_PATH})`);

    expect(
      fs.readFileSync(
        path.join(REPOSITORY_ROOT, ".github/pull_request_template.md"),
        "utf8",
      ),
    ).toContain(
      `I looked at this as a newcomer, at 1280 and 390, and it follows the [UX guide](https://github.com/OneUptime/oneuptime/blob/main/${GUIDE_PATH}).`,
    );
  });
});
