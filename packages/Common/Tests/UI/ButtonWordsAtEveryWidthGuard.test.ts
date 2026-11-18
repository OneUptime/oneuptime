// UX rule: Docs/ux/README.md#one-control-for-one-job

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A BUTTON KEEPS ITS WORDS FROM A TABLET TO A WIDE SCREEN (#9455).
 *
 * The Logs and Traces explorers drew Create monitor as a bell alone from
 * md up until their toolbars were 77rem (80rem) wide: its words were
 * `md:hidden [@container(min-width:77rem)]:inline`. A 1280px window beside a
 * service's side menu showed the bare bell, named only by its tooltip, and
 * a newcomer found it by hovering. A row with no room for a button's words
 * wraps, as the explorers' toolbars do now, or folds its lesser actions
 * into ⋯, as a table's header does - it never drops the words for the
 * middle widths.
 *
 * This reads every string the front ends write - Common's components and
 * each app's sources - and fails on a class list that hides what it styles
 * from a small or medium width up (`sm:hidden`, `md:hidden`) and shows it
 * again wider, at a breakpoint or at a container's width (`lg:inline`,
 * `xl:flex`, `[@container(min-width:77rem)]:inline`): the shape of words
 * dropped for the middle widths only. A phone is not the middle: a button
 * may keep its icon alone there beside what says what it does (Button's
 * isTitleHiddenOnPhone).
 *
 * Something that is no control's words, and is hidden at the middle widths
 * for a reason of its own, is listed in ALLOWED with that reason.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SCANNED_ROOTS: Array<string> = [
  "packages/Common/UI",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
];

// A file's class lists that may hide in the middle, and why.
const ALLOWED: Record<string, string> = {
  "packages/Common/UI/Components/Footer/Footer.tsx":
    "The footer's copyright line, no control: from md to lg the footer's row holds its links alone, and the line comes back below them from lg.",
};

// What hides an element from a small or medium width up.
const HIDES_FROM_THE_MIDDLE: RegExp = /^(sm|md):hidden$/;

// What shows it again, wider: at a breakpoint, or at a container's width.
const SHOWS_AGAIN_WIDER: RegExp =
  /^(lg|xl|2xl|\[@container\([^\s]*\)\]):(inline|inline-flex|inline-block|block|flex|grid|table|contents)$/;

// A TypeScript source, with or without JSX.
const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

// A string literal: quoted, or a template literal's text.
const STRING_LITERAL: RegExp = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g;

export function hidesInTheMiddle(classList: string): boolean {
  const tokens: Array<string> = classList.split(/\s+/);

  return (
    tokens.some((token: string): boolean => {
      return HIDES_FROM_THE_MIDDLE.test(token);
    }) &&
    tokens.some((token: string): boolean => {
      return SHOWS_AGAIN_WIDER.test(token);
    })
  );
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "build") {
        files.push(...listSourceFiles(fullPath));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

interface Found {
  file: string;
  line: number;
  classList: string;
}

function findMiddleHides(): Array<Found> {
  const found: Array<Found> = [];

  for (const root of SCANNED_ROOTS) {
    for (const fullPath of listSourceFiles(path.join(REPOSITORY_ROOT, root))) {
      const file: string = path
        .relative(REPOSITORY_ROOT, fullPath)
        .split(path.sep)
        .join("/");
      const source: string = fs.readFileSync(fullPath, "utf8");

      for (const match of source.matchAll(STRING_LITERAL)) {
        const classList: string = match[1] ?? match[2] ?? match[3] ?? "";

        if (hidesInTheMiddle(classList)) {
          found.push({
            file,
            line: source.slice(0, match.index).split("\n").length,
            classList: classList.trim(),
          });
        }
      }
    }
  }

  return found;
}

describe("a button keeps its words from a tablet to a wide screen", () => {
  test("tells a class list that hides in the middle from one that does not", () => {
    // #9455: the explorers' Create monitor, a bell between 768px and 77rem.
    expect(
      hidesInTheMiddle("md:hidden [@container(min-width:77rem)]:inline"),
    ).toBe(true);
    expect(hidesInTheMiddle("inline-flex md:hidden lg:inline-flex")).toBe(true);
    expect(hidesInTheMiddle("sm:hidden xl:block text-xs")).toBe(true);

    // A phone's own control, hidden from md up for good.
    expect(hidesInTheMiddle("md:hidden")).toBe(false);
    // Hidden on a phone only (isTitleHiddenOnPhone's shape).
    expect(hidesInTheMiddle("max-md:sr-only")).toBe(false);
    expect(hidesInTheMiddle("hidden md:inline")).toBe(false);
    // Hidden below a wide screen: a hint, not words dropped in the middle.
    expect(hidesInTheMiddle("max-xl:hidden xl:inline")).toBe(false);
    expect(hidesInTheMiddle("lg:hidden xl:block")).toBe(false);
  });

  test("no class list in the front ends hides what it styles between a phone and a wide screen", () => {
    const found: Array<Found> = findMiddleHides();

    expect(
      found
        .filter((each: Found): boolean => {
          return !ALLOWED[each.file];
        })
        .map((each: Found): string => {
          return `${each.file}:${each.line} "${each.classList}"`;
        }),
    ).toEqual([]);
  });

  test("every file allowed still has such a class list, and says why", () => {
    const files: Set<string> = new Set<string>(
      findMiddleHides().map((each: Found): string => {
        return each.file;
      }),
    );

    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect({ file, isFound: files.has(file) }).toEqual({
        file,
        isFound: true,
      });
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  test("the explorers' Create monitor is no longer a bell between a phone and a wide screen", () => {
    for (const file of [
      "packages/Common/UI/Components/LogsViewer/components/LogsViewerToolbar.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({
        file,
        hasCreateMonitor: source.includes("Create monitor"),
      }).toEqual({ file, hasCreateMonitor: true });
      expect({ file, holds: source.includes("@container(min-width") }).toEqual({
        file,
        holds: false,
      });
    }
  });
});
