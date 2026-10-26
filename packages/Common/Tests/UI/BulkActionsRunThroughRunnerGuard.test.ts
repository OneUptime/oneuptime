import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY BULK ACTION RUNS THROUGH THE SHARED RUNNER (issue #5299).
 *
 * Bulk actions used to run their own loops - one item at a time, a progress
 * report rebuilt after every item, no way to stop - and a bulk Resolve of
 * 4,594 alerts ran for hours. They now go through runBulkAction
 * (Common/UI/Components/BulkUpdate/BulkActionRunner): several items at
 * once where the writes allow it, progress at most ten times a second, a
 * time-left estimate, and Stop. This guard keeps it that way: it reads every
 * browser module and fails on one that starts a bulk action or reports its
 * progress itself - a call to onBulkActionStart( or onProgressInfo( - other
 * than the runner and the flows listed below, each with why.
 *
 * The list only shrinks: a listed flow moved onto the runner must leave it,
 * or the guard fails too.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Where the browser's modules are: Common's UI, each front end, ee's when present.
const SCAN_ROOTS: Array<string> = [
  "packages/Common/UI",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// The runner itself: the one place a run starts and reports.
const RUNNER: string =
  "packages/Common/UI/Components/BulkUpdate/BulkActionRunner.ts";

/*
 * Flows that still run their own loop, and why. Both are in the Admin
 * Dashboard's Users page, pinned by their own suites:
 *   - Require / Do Not Require Two Factor Auth posts to an endpoint that
 *     signs each user out, one user at a time on purpose (its rate limit),
 *     with its own reporting (BulkTwoFactorAuthWiring);
 *   - Add to Project reports the progress of its own module
 *     (bulkAddUsersToProject), which records who was dealt with before a
 *     late failure (BulkAddUsersToProjectWiring).
 */
const OWN_LOOPS: Record<string, number> = {
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx": 2,
};

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/.*$/gm;
const START_CALL: RegExp = /\bonBulkActionStart\s*\(/g;
const PROGRESS_CALL: RegExp = /\bonProgressInfo\s*\(/g;
const MODULE_FILE: RegExp = /\.(ts|tsx)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

function withoutComments(source: string): string {
  return source.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

function countMatches(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

// The calls in a module that start a bulk run itself.
function countOwnRunStarts(source: string): number {
  return countMatches(withoutComments(source), START_CALL);
}

function countOwnProgressReports(source: string): number {
  return countMatches(withoutComments(source), PROGRESS_CALL);
}

function listModules(root: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, root);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const found: Array<string> = [];
  const stack: Array<string> = [absolute];

  while (stack.length > 0) {
    const directory: string = stack.pop()!;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        MODULE_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name)
      ) {
        found.push(
          path.relative(REPOSITORY_ROOT, full).split(path.sep).join("/"),
        );
      }
    }
  }

  return found.sort();
}

describe("the detector", () => {
  test("finds a run started and reported by hand", () => {
    const source: string = [
      "const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } = props;",
      "onBulkActionStart();",
      "for (const item of items) {",
      "  onProgressInfo({ totalItems: items, successItems: [], failed: [], inProgressItems: [] });",
      "}",
      "props.onBulkActionEnd();",
    ].join("\n");

    expect(countOwnRunStarts(source)).toBe(1);
    expect(countOwnProgressReports(source)).toBe(1);
  });

  test("finds one through the props object and one with options", () => {
    expect(countOwnRunStarts("props.onBulkActionStart();")).toBe(1);
    expect(countOwnRunStarts("onBulkActionStart({ isStoppable: true });")).toBe(
      1,
    );
    expect(countOwnProgressReports("onClickProps.onProgressInfo({});")).toBe(1);
  });

  test("leaves alone a bare name, a declaration and a comment", () => {
    const source: string = [
      "// onBulkActionStart() is called by the runner.",
      "/* onProgressInfo({ ... }) reports a run. */",
      "export type OnBulkActionStart = (options?: X) => void;",
      "onBulkActionStart: (options?: BulkActionStartOptions) => {",
      "const props = { onProgressInfo: report };",
      "await runBulkAction({ actionProps: props, step: step });",
    ].join("\n");

    expect(countOwnRunStarts(source)).toBe(0);
    expect(countOwnProgressReports(source)).toBe(0);
  });
});

describe("every bulk action runs through the shared runner", () => {
  const modules: Array<string> = SCAN_ROOTS.flatMap((root: string) => {
    return listModules(root);
  });

  test("the walk reads the front ends and the runner", () => {
    expect(modules.length).toBeGreaterThan(1000);
    expect(modules).toContain(RUNNER);
    expect(modules).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/EventView/useEventStateActions.tsx",
    );
    expect(modules).toContain(
      "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
    );
  });

  test("no module but the runner, and the flows listed with why, starts a run or reports its progress itself", () => {
    const ownLoops: Record<string, number> = {};

    for (const modulePath of modules) {
      if (modulePath === RUNNER) {
        continue;
      }

      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, modulePath),
        "utf8",
      );
      const starts: number = countOwnRunStarts(source);

      if (starts > 0 || countOwnProgressReports(source) > 0) {
        ownLoops[modulePath] = starts;
      }
    }

    /*
     * A module here that is not listed above runs a bulk action by hand:
     * move it onto runBulkAction. A listed one that is gone was moved onto
     * the runner: take it off the list.
     */
    expect(ownLoops).toEqual(OWN_LOOPS);
  });

  test("the runner is where a run starts and reports", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, RUNNER),
      "utf8",
    );

    expect(countOwnRunStarts(source)).toBe(1);
    expect(countOwnProgressReports(source)).toBe(1);
  });
});
