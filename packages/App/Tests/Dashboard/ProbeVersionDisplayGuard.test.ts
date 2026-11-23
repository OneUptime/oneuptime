// UX rule: Docs/ux/README.md#a-records-overview
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A CUSTOM PROBE'S RELEASE SAYS WHEN THE PROBE IS OLDER THAN THE ONEUPTIME
 * IT REPORTS TO, WITH HOW TO UPDATE IT ONE CLICK AWAY (OneUptime issue
 * #9815), as an agent's version does (AgentVersionDisplayGuard).
 *
 * A probe says the release it runs on every request, and OneUptime keeps it
 * as Probe.reportedVersion. Every page that draws it draws it with the
 * shared ProbeVersionElement (Components/Probe/ProbeVersion): the component
 * compares it with this OneUptime's release, says when the probe is older
 * and what it misses until it is updated, and links Update a probe. A page
 * that drew the release any other way would show an outdated probe with no
 * sign, and nothing else would notice. This fails on:
 *
 *   1. a front-end file that mentions reportedVersion and is in neither list
 *      below - every new one is a page to wire, or a reason to write down;
 *   2. a page in DISPLAYS whose field or column on reportedVersion does not
 *      draw ProbeVersionElement, as many times as the page lists;
 *   3. a stale entry in either list.
 *
 * Rendering is tested in Common/Tests/App/Dashboard/ProbeOlderThanOneUptime
 * and CustomProbesVersionColumn.
 *
 * The App suite runs in plain Node with no renderer, so this reads the
 * sources, comments stripped.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

// The component itself, which is where the release is drawn.
const COMPONENT: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Probe/ProbeVersion.tsx";

/*
 * Every page that draws a probe's release, and how many fields or columns
 * on it each has.
 */
const DISPLAYS: Record<string, number> = {
  // The probe's page: Version, under Probe Status.
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx": 1,
  // Custom Probes: the Version column.
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes.tsx": 1,
};

// Files that read a probe's release without drawing it, each with why.
const READERS: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/ProbesTooOld.ts":
    "reads it to name, in the monitor forms, the probes too old for what the monitor's steps need; the probe's name is drawn, not its release",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/ProbesTooOldWarning.tsx":
    "asks for it with the project's probes, for ProbesTooOld to read",
};

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const SOURCE_FILE_NAME: RegExp = /\.tsx?$/;

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function sourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        found.push(...sourceFiles(full));
      }
    } else if (SOURCE_FILE_NAME.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

const mentions: Map<string, string> = new Map<string, string>();

for (const directory of SCAN_DIRS) {
  for (const file of sourceFiles(directory)) {
    const source: string = stripComments(fs.readFileSync(file, "utf8"));

    if (source.includes("reportedVersion")) {
      mentions.set(relative(file), source);
    }
  }
}

/*
 * Each field or column on reportedVersion (`field: { reportedVersion: true }`;
 * a select that asks for it draws nothing), and whether the element it draws
 * is ProbeVersionElement: what follows it, up to the next field.
 */
const FIELD_ON_IT: RegExp = /field:\s*\{\s*reportedVersion:\s*true,?\s*\}/g;

function fieldsOf(source: string): Array<{ drawsTheComponent: boolean }> {
  const fields: Array<{ drawsTheComponent: boolean }> = [];

  for (const match of source.matchAll(FIELD_ON_IT)) {
    const end: number = (match.index || 0) + match[0].length;
    const next: number = source.indexOf("field: {", end);
    const field: string = source.slice(end, next === -1 ? undefined : next);

    fields.push({ drawsTheComponent: field.includes("<ProbeVersionElement") });
  }

  return fields;
}

describe("a probe's release is drawn by ProbeVersionElement", () => {
  test("the scan read the component and the pages", () => {
    expect(mentions.has(COMPONENT)).toBe(true);
    expect(mentions.size).toBeGreaterThanOrEqual(
      Object.keys(DISPLAYS).length + Object.keys(READERS).length + 1,
    );
  });

  test("every file that mentions it is a page that draws it, or reads it with a reason", () => {
    const unlisted: Array<string> = [...mentions.keys()].filter(
      (file: string): boolean => {
        return file !== COMPONENT && !DISPLAYS[file] && !READERS[file];
      },
    );

    expect(unlisted).toEqual([]);
  });

  test.each(Object.entries(DISPLAYS))(
    "%s draws each field on it with ProbeVersionElement",
    (file: string, count: number) => {
      const source: string | undefined = mentions.get(file);

      expect([file, Boolean(source)]).toEqual([file, true]);

      const fields: Array<{ drawsTheComponent: boolean }> = fieldsOf(source!);

      expect(fields).toHaveLength(count);
      expect(fields).toEqual(
        fields.map(() => {
          return { drawsTheComponent: true };
        }),
      );
    },
  );

  test("no reader draws it", () => {
    for (const file of Object.keys(READERS)) {
      const source: string | undefined = mentions.get(file);

      // Still a reader: a stale entry would let a new page through.
      expect([file, Boolean(source)]).toEqual([file, true]);
      expect([file, fieldsOf(source!).length]).toEqual([file, 0]);
    }
  });
});
