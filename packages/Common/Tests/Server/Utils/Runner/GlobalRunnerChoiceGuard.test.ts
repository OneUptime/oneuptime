import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE RULE AND ONE PICKER FOR WHERE A STEP RUNS, HELD.
 *
 * A step that picks no Runner of its own runs on the global Runners - the
 * Runners OneUptime runs for every project - only when the one rule says so
 * (Types/Runner/RunnerChoice.decideRunnerChoice, read on the server by
 * Utils/Runner/GlobalRunnerChoice.decideForStep): a type global Runners run,
 * a project that uses them, a global Runner there to run it. And a person
 * picks a step's Runner with the one picker (Dashboard
 * Components/Runner/RunnerPicker, fed by RunnerChoicesLoader), which offers
 * the same choice in the same order and words wherever a Runner is picked.
 *
 * A second path to either would skip what the rule checks, or show people a
 * choice the server does not make. This reads the sources and fails on a
 * new one:
 *
 *   - only the files below name RunnerJob.runsOnGlobalRunner, and the one
 *     place that writes it on a job writes it where the rule decided
 *     "global";
 *   - only the files below load Runners in the Dashboard and the Admin
 *     Dashboard; a runbook's Steps page picks with the picker.
 *
 * A new place that sends work to a Runner decides with
 * GlobalRunnerChoice.decideForStep (or decideRunnerChoice) and enqueues as
 * StepExecutors does; a new place where people pick a Runner renders
 * RunnerPicker with RunnerChoicesLoader.load's choices. A place that must do
 * otherwise is added below, with the reason.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES, relativePath), "utf8");
}

// A TypeScript file, and a test of one.
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// A job written for the global Runners.
const GLOBAL_JOB_WRITE: RegExp = /\{\s*runsOnGlobalRunner:\s*true\s*\}/;

// StepExecutors' enqueue: a Runner the rule picked, or the global Runners.
const ENQUEUE_AS_DECIDED: RegExp =
  /decision\.kind === "custom"\s*\?\s*\{\s*targetAgentId: new ObjectID\(decision\.runnerId\)\s*\}\s*:\s*\{\s*runsOnGlobalRunner: true\s*\}/;

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "public",
]);

// The product's TypeScript under a folder: no tests, no build output.
function sourcesUnder(relativeDirectory: string): Array<string> {
  const found: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(PACKAGES, directory), {
      withFileTypes: true,
    })) {
      const child: string = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(child);
        }
        continue;
      }
      if (
        TYPESCRIPT_FILE.test(entry.name) &&
        !TEST_FILE.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        found.push(child);
      }
    }
  };
  walk(relativeDirectory);
  return found;
}

const SERVER_SOURCES: Array<string> = [
  ...sourcesUnder("Common/Server"),
  ...sourcesUnder("Common/Models"),
  ...sourcesUnder("Common/Types"),
  ...sourcesUnder("App/FeatureSet"),
  ...sourcesUnder("Runner"),
];

// Every file that names the column, and why it may.
const NAMES_RUNS_ON_GLOBAL_RUNNER: Record<string, string> = {
  "Common/Models/DatabaseModels/RunnerJob.ts": "the column",
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1803950000000-AddGlobalRunners.ts":
    "adds it",
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1804000000000-AddGlobalRunnerJobIndex.ts":
    "indexes it",
  "Common/Server/Services/RunnerJobService.ts":
    "enqueue's checks, claimNextGlobalJob and the reads that word a timeout",
  "App/FeatureSet/Runbook/Services/StepExecutors.ts":
    "sends a step to the global Runners where GlobalRunnerChoice decided so",
  "App/FeatureSet/Runbook/API/RunnerIngress.ts":
    "tells the global Runner the job it claimed is one",
};

const RUNNER_LOADS: RegExp =
  /ModelAPI\.getList<Runner>|modelType:\s*Runner\b|modelType=\{Runner\}|\btype:\s*Runner,/;

// Every Dashboard and Admin Dashboard file that loads Runners, and why.
const LOADS_RUNNERS: Record<string, string> = {
  "App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices.ts":
    "the one picker's choices: the project's own Runners, the global ones, the switch",
  "App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersTable.tsx":
    "Runbooks -> Runners: the global Runners, read-only",
  "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners.tsx":
    "Runbooks -> Runners: the project's own",
  "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx":
    "one Runner's own page",
  "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials.tsx":
    "which of the project's Runners may use a credential; a global Runner never gets one",
  "App/FeatureSet/Dashboard/src/Pages/Runbook/Secrets.tsx":
    "which of the project's own Runners may use a secret; the global Runners have their own switch",
  "App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Agent.tsx":
    "the Runner that runs a cluster's AI commands, which global Runners never run",
  "App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalRunners/Index.tsx":
    "a master admin's global Runners",
};

describe("where a step runs is decided by one rule", () => {
  test("only these files name RunnerJob.runsOnGlobalRunner", () => {
    const naming: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return read(file).includes("runsOnGlobalRunner");
      },
    ).sort();

    expect(naming).toEqual(Object.keys(NAMES_RUNS_ON_GLOBAL_RUNNER).sort());
  });

  test("the one job written for the global Runners is written where the rule decided so", () => {
    const writers: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return GLOBAL_JOB_WRITE.test(read(file));
      },
    );

    expect(writers).toEqual([
      "App/FeatureSet/Runbook/Services/StepExecutors.ts",
    ]);

    const executors: string = read(
      "App/FeatureSet/Runbook/Services/StepExecutors.ts",
    );
    const decided: number = executors.indexOf(
      "GlobalRunnerChoice.decideForStep(",
    );
    const written: RegExpExecArray | null = ENQUEUE_AS_DECIDED.exec(executors);

    expect(decided).toBeGreaterThan(0);
    expect(written).not.toBeNull();
    expect(decided).toBeLessThan(written!.index);
  });
});

describe("a Runner is picked with one picker", () => {
  const UI_SOURCES: Array<string> = [
    ...sourcesUnder("App/FeatureSet/Dashboard/src"),
    ...sourcesUnder("App/FeatureSet/AdminDashboard/src"),
  ];

  test("only these Dashboard and Admin Dashboard files load Runners", () => {
    const loading: Array<string> = UI_SOURCES.filter(
      (file: string): boolean => {
        return RUNNER_LOADS.test(read(file));
      },
    ).sort();

    expect(loading).toEqual(Object.keys(LOADS_RUNNERS).sort());
  });

  test("a runbook's Steps page picks each step's Runner with the picker", () => {
    const steps: string = read(
      "App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
    );

    expect(steps).toContain(
      'import RunnerPicker from "../../../Components/Runner/RunnerPicker";',
    );
    expect(steps).toContain("RunnerChoicesLoader.load(");
    expect(steps).toMatch(/<RunnerPicker\b/);
    expect(RUNNER_LOADS.test(steps)).toBe(false);
  });
});
