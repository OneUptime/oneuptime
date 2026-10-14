import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "WHO IS ON CALL" HAS ONE ANSWER: ScheduleResolution.
 *
 * A schedule's layers, the people away in them, and the people covering
 * for them make one answer to "who is on call at T": expand each layer's
 * rotation, skip whoever is away in it (their turn goes to the next person
 * in that layer who is not), merge the layers by priority, then hand named
 * covers their pages. Paging, the roster and hand-off times, calendar feeds,
 * my shifts, shift reminders, the timeline API and every schedule card on
 * the dashboard must agree on it (task oncall-skip-user-until), so the steps
 * are taken in one place - ScheduleResolution - and nowhere else.
 *
 * Read from source, so a new caller is held to it the day it is written:
 *
 *   - outside the engine (Layer.ts) and ScheduleResolution.ts, nothing
 *     expands several layers, merges them, or applies skips or covers to
 *     their events by itself: a caller that did would answer without the
 *     people away being skipped, or with them skipped after the merge;
 *   - the places that answer "who is on call" do it through
 *     ScheduleResolution.
 *
 * The enterprise folder is scanned when it is there.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const SCANNED_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages"),
  path.join(REPOSITORY_ROOT, "ee"),
].filter((root: string): boolean => {
  return fs.existsSync(root);
});

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  ".git",
  "coverage",
]);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

// The engine itself, and the one place that runs its steps in order.
const ENGINE_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Types/OnCallDutyPolicy/Layer.ts",
);
const RESOLUTION_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Types/OnCallDutyPolicy/ScheduleResolution.ts",
);

/*
 * The steps of the resolution: expanding several layers, merging them,
 * skipping the people away, handing covers their pages.
 */
const RESOLUTION_STEP_CALL: RegExp =
  /\.(getMultiLayerEvents|getMultiLayerEventsWithMeta|getLayerEventsWithMeta|mergeLayerEvents|removeOverlappingEvents|applyOverridesToEvents|applySkipsToLayerEvents)\s*\(/g;

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:"'`\\])\/\/.*$/gm;

function listSources(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listSources(fullPath));
      }
      continue;
    }

    if (
      TYPESCRIPT_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

// Comments hold prose ("getMultiLayerEvents used to..."), not code.
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

interface Source {
  file: string;
  relative: string;
  code: string;
}

const SOURCES: Array<Source> = SCANNED_ROOTS.flatMap(listSources).map(
  (file: string): Source => {
    return {
      file,
      relative: path.relative(REPOSITORY_ROOT, file),
      code: stripComments(fs.readFileSync(file, "utf8")),
    };
  },
);

function sourceOf(relative: string): Source {
  const found: Source | undefined = SOURCES.find((source: Source) => {
    return source.relative === relative;
  });

  if (!found) {
    throw new Error(`${relative} is not where this guard expects it`);
  }

  return found;
}

describe("who is on call is resolved in one place", () => {
  test("the scan sees the code it guards", () => {
    // A scan that read nothing would pass everything.
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(
      SOURCES.some((source: Source) => {
        return source.file === RESOLUTION_FILE;
      }),
    ).toBe(true);
  });

  test("nothing but the engine and ScheduleResolution runs the resolution's steps", () => {
    const callers: Array<string> = [];

    for (const source of SOURCES) {
      if (source.file === ENGINE_FILE || source.file === RESOLUTION_FILE) {
        continue;
      }

      for (const match of source.code.matchAll(RESOLUTION_STEP_CALL)) {
        callers.push(`${source.relative}: ${match[1]}`);
      }
    }

    expect(callers).toEqual([]);
  });

  test("ScheduleResolution skips the people away before it merges the layers", () => {
    const code: string = sourceOf(
      "packages/Common/Types/OnCallDutyPolicy/ScheduleResolution.ts",
    ).code;

    const skipAt: number = code.indexOf(".applySkipsToLayerEvents(");
    const mergeAt: number = code.indexOf(".mergeLayerEvents(");
    const coverAt: number = code.indexOf(".applyOverridesToEvents(");

    expect(skipAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(-1);
    expect(coverAt).toBeGreaterThan(-1);

    // Skips per layer, then the merge, then the named covers.
    expect(code.indexOf("skipLayer(")).toBeLessThan(mergeAt);
    expect(mergeAt).toBeLessThan(coverAt);
  });

  test.each([
    // Paging, the roster, hand-off times, feeds, my shifts, reminders, timeline.
    "packages/Common/Server/Services/OnCallDutyPolicyScheduleService.ts",
    // The layer card, its turns list and the people in it.
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview.ts",
    // The final schedule: who is on call now, next, the hand-offs, the calendar.
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview.tsx",
    // The coverage banner over the layers.
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx",
  ])("%s asks ScheduleResolution", (relative: string) => {
    expect(sourceOf(relative).code).toContain("ScheduleResolution.");
  });
});
