"use strict";

/**
 * Every opt-in Postgres suite is run by a workflow.
 *
 * A Common, App or ee test that needs a real Postgres opts in with a
 * RUN_POSTGRES_<NAME>_TESTS flag and skips itself otherwise, so the ordinary
 * test jobs never run it by accident. Only a workflow step that sets the flag
 * does - mostly the Postgres Schema Drift workflow, once it has applied every
 * registered migration to an empty database. Twelve such suites ran nowhere
 * until f8513a0c1a wired them on 2026-10-05, and a thirteenth
 * (ContainerSnapshotUpsertPostgres) was found when this check was written: a
 * suite that never runs never fails, so nothing noticed. This fails the next
 * one.
 *
 * A suite is a test file that reads a RUN_POSTGRES_ flag (as a quoted string:
 * a comment naming the flag does not make a suite). It runs when a workflow
 * step sets every flag it reads to "true" - in its own `env`, its job's or
 * its workflow's - and either names the file in its `run`, relative to the
 * step's working directory, or runs the whole test script (`npm test`, `npm
 * run test`) of the package the file is in, as Common Test does for the
 * suites that need only the Postgres its test-setup.sh starts.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const TEST_ROOTS = ["packages/Common/Tests", "packages/App/Tests", "ee/Tests"];
const TEST_FILE = /\.test\.[jt]sx?$/;
const FLAG_READ = /["'](RUN_POSTGRES_[A-Z0-9_]+)["']/g;
const PACKAGE_TEST_SCRIPT = /\bnpm (?:run )?test\b/;
const WHITESPACE = /\s+/;

function testFilesUnder(relativeDirectory) {
  const directory = path.join(REPO_ROOT, relativeDirectory);

  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : testFilesUnder(relative);
    }

    return TEST_FILE.test(entry.name) ? [relative] : [];
  });
}

// Each opt-in Postgres suite, with the flags it reads.
const SUITES = TEST_ROOTS.flatMap(testFilesUnder)
  .map((file) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

    return {
      file,
      flags: [
        ...new Set(
          [...source.matchAll(FLAG_READ)].map((match) => {
            return match[1];
          }),
        ),
      ].sort(),
    };
  })
  .filter((suite) => {
    return suite.flags.length > 0;
  })
  .sort((a, b) => {
    return a.file.localeCompare(b.file);
  });

function workingDirectoryOf(workflow, job, step) {
  const directory =
    step["working-directory"] ||
    ((job.defaults || {}).run || {})["working-directory"] ||
    ((workflow.defaults || {}).run || {})["working-directory"] ||
    ".";

  return path.posix.normalize(directory).replace(/(.)\/+$/, "$1");
}

/*
 * Every step that runs shell, as "where it runs, what it sets, what it runs".
 * A step sees its workflow's env, then its job's, then its own.
 */
const STEPS = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .flatMap((file) => {
    const workflow = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, WORKFLOWS_DIR, file), "utf8"),
    );

    return Object.entries(workflow.jobs || {}).flatMap(([name, job]) => {
      return (job.steps || [])
        .filter((step) => {
          return typeof step.run === "string";
        })
        .map((step) => {
          return {
            where: `${WORKFLOWS_DIR}/${file}: ${name}: ${step.name || step.run}`,
            workingDirectory: workingDirectoryOf(workflow, job, step),
            env: {
              ...(workflow.env || {}),
              ...(job.env || {}),
              ...(step.env || {}),
            },
            run: step.run,
          };
        });
    });
  });

// Whether a step runs the whole test script of the package a file is in.
function runsPackageTests(step, file) {
  return (
    step.workingDirectory !== "." &&
    file.startsWith(`${step.workingDirectory}/`) &&
    PACKAGE_TEST_SCRIPT.test(step.run)
  );
}

/*
 * The steps that run a suite: they set every flag it reads, and name its file
 * or run its package's tests.
 */
function stepsRunning(suite) {
  return STEPS.filter((step) => {
    const file =
      step.workingDirectory === "."
        ? suite.file
        : path.posix.relative(step.workingDirectory, suite.file);

    return (
      !file.startsWith("..") &&
      (step.run.split(WHITESPACE).includes(file) ||
        runsPackageTests(step, suite.file)) &&
      suite.flags.every((flag) => {
        return String(step.env[flag]) === "true";
      })
    );
  });
}

function suiteEndingWith(name) {
  const suite = SUITES.find((candidate) => {
    return candidate.file.endsWith(name);
  });

  if (!suite) {
    throw new Error(`no opt-in Postgres suite ends with ${name}`);
  }

  return suite;
}

function whereEachRuns(suite) {
  return stepsRunning(suite).map((step) => {
    return step.where;
  });
}

describe("the helpers this suite reads the tests and workflows with", () => {
  test("find the opt-in Postgres suites and the steps that run shell (the checks below are not vacuous)", () => {
    expect(SUITES.length).toBeGreaterThan(40);
    expect(STEPS.length).toBeGreaterThan(100);
  });

  test("read a suite's flag from its code, not from a comment", () => {
    expect(suiteEndingWith("LlmLogDailyUsageIndexPostgres.test.ts")).toEqual({
      file: "packages/Common/Tests/Server/Services/LlmLogDailyUsageIndexPostgres.test.ts",
      flags: ["RUN_POSTGRES_LLM_LOG_USAGE_INDEX_TESTS"],
    });

    // Names RUN_POSTGRES_INCIDENT_CUSTOM_FIELD_TESTS in a comment only.
    expect(
      SUITES.map((suite) => {
        return suite.file;
      }),
    ).not.toContain(
      "packages/Common/Tests/Server/Utils/CustomField/CustomFieldRename.test.ts",
    );
  });

  test("match a step by its working directory, its flag and the file it names", () => {
    const usageIndex = suiteEndingWith("LlmLogDailyUsageIndexPostgres.test.ts");

    expect(whereEachRuns(usageIndex)).toEqual([
      `${WORKFLOWS_DIR}/postgres-schema-drift.yaml: postgres-schema-drift: Test the AI daily usage index on migrated Postgres`,
    ]);

    // The same file without its flag set runs nowhere.
    expect(
      whereEachRuns({
        ...usageIndex,
        flags: ["RUN_POSTGRES_NOT_A_FLAG_TESTS"],
      }),
    ).toEqual([]);
  });

  test("see a flag set on the job, for a step that runs its package's whole test script", () => {
    const backfill = suiteEndingWith("BackfillFileOwnersPostgres.test.ts");

    expect(backfill.flags).toEqual(["RUN_POSTGRES_FILE_OWNER_BACKFILL_TESTS"]);
    expect(whereEachRuns(backfill)).toContain(
      `${WORKFLOWS_DIR}/test.common.yaml: test: Run test shard`,
    );
  });

  test("do not count a step that sets the flag but runs other files", () => {
    // The Databases SQL step sets this flag and names its own suites only.
    const containerCommand = suiteEndingWith(
      "DatabaseContainerCommandPostgres.test.ts",
    );

    expect(
      whereEachRuns({
        file: "packages/Common/Tests/Server/Services/NotRunAnywherePostgres.test.ts",
        flags: containerCommand.flags,
      }),
    ).toEqual([]);
  });
});

describe("every opt-in Postgres suite runs in a workflow", () => {
  test.each(
    SUITES.map((suite) => {
      return [suite.file, suite];
    }),
  )("%s", (_file, suite) => {
    expect({
      suite: suite.file,
      flags: suite.flags,
      isRun: stepsRunning(suite).length > 0,
    }).toEqual({ suite: suite.file, flags: suite.flags, isRun: true });
  });
});
