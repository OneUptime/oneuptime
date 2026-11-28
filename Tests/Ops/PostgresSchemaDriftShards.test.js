"use strict";

/**
 * Postgres Schema Drift runs its real-Postgres suites in shards.
 *
 * One job ran the drift check and then every opt-in Postgres suite in a row:
 * a step each, each starting jest again. It had grown to 29 minutes of its
 * 30 and started running out of time with nothing failing (2026-10-26), so
 * the job became a matrix of shards. Every shard sets up, migrates and checks
 * its database - the steps up to the drift check - and then runs only the
 * suite steps marked `if: matrix.shard == N` for it.
 *
 * What would quietly undo that: a suite step with no shard (it would run in
 * every shard, its time spent once in each), one naming a shard the matrix
 * does not have (it would run nowhere), a set-up step given a shard (the
 * other shards would test an empty database), a suite separated from the
 * install it needs (App's and ee's installs, and the PostgreSQL client
 * tools, are run only by the shard whose suites need them), or a test of a
 * suite the shards share out by name (jest's -t) that no shard's name
 * matches - it would run nowhere, and jest passes a file whose every test
 * it skipped - or that two shards run.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github/workflows/postgres-schema-drift.yaml",
);
const JOB = "postgres-schema-drift";
const DRIFT_STEP = "Check for Postgres schema drift";
const SHARD_CONDITION = /^matrix\.shard == (\d+)$/;
const TEST_FILE = /\.test\.[jt]sx?$/;
// The tests a step runs of its suite, by name: jest's -t (--testNamePattern).
const TEST_NAME_PATTERN = /(?:^|\s)(?:-t|--testNamePattern)(?:=|\s+)"([^"]*)"/;
// A describe block's name, and a test's, as a suite's source writes them.
const DESCRIBE_NAME = /\bdescribe\w*\(\s*"((?:[^"\\]|\\.)*)"/g;
const TEST_NAME = /\b(?:test|it)\(\s*"((?:[^"\\]|\\.)*)"/g;

const workflow = yaml.load(fs.readFileSync(WORKFLOW, "utf8"));
const job = workflow.jobs[JOB];
const steps = job.steps;
const driftAt = steps.findIndex((step) => {
  return step.name === DRIFT_STEP;
});
const setUp = steps.slice(0, driftAt + 1);
const suites = steps.slice(driftAt + 1);

function shardOf(step) {
  const match = SHARD_CONDITION.exec(String(step.if || "").trim());

  return match ? Number(match[1]) : null;
}

function nameOf(step) {
  return step.name || step.uses || step.run;
}

// Where an install step installs: the working directory its suites run in.
function installDirectory(step) {
  return ((step.with || {})["working-directory"] || ".").replace(/\/+$/, "");
}

// The suite files a step runs, from the repository's root.
function suiteFilesOf(step) {
  return String(step.run || "")
    .split(/\s+/)
    .filter((token) => {
      return TEST_FILE.test(token);
    })
    .map((file) => {
      return path.posix.join(step["working-directory"] || ".", file);
    });
}

/*
 * Each test of a suite by its whole name, which -t is matched against: its
 * describe block's name, a space, then its own. For a suite whose tests are
 * all in one describe block, as those the shards share out are.
 */
function wholeTestNamesOf(file) {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const describes = [...source.matchAll(DESCRIBE_NAME)].map((match) => {
    return match[1];
  });

  expect({ file, describes: describes.length }).toEqual({
    file,
    describes: 1,
  });

  return [...source.matchAll(TEST_NAME)].map((match) => {
    return `${describes[0]} ${match[1]}`;
  });
}

describe("Postgres Schema Drift's shards", () => {
  test("the job is a matrix of shards numbered from 1", () => {
    const shards = job.strategy.matrix.shard;

    expect(shards.length).toBeGreaterThan(1);
    expect(shards).toEqual(
      shards.map((_shard, index) => {
        return index + 1;
      }),
    );
    // One shard's failure does not cancel the others.
    expect(job.strategy["fail-fast"]).toBe(false);
  });

  test("every shard sets up, migrates and checks the database first", () => {
    expect(driftAt).toBeGreaterThan(0);

    expect(
      setUp
        .filter((step) => {
          return step.if !== undefined;
        })
        .map(nameOf),
    ).toEqual([]);
  });

  test("every step after the drift check runs in exactly one shard the matrix has", () => {
    const shards = job.strategy.matrix.shard;

    expect(suites.length).toBeGreaterThan(100);
    expect(
      suites
        .filter((step) => {
          return !shards.includes(shardOf(step));
        })
        .map((step) => {
          return `${nameOf(step)}: ${step.if}`;
        }),
    ).toEqual([]);
  });

  test("a suite runs in the shard that installed what it needs", () => {
    const stray = [];
    // Directory -> the shard whose install step installed it.
    const installedIn = new Map();

    for (const step of suites) {
      const shard = shardOf(step);

      if (String(step.uses || "").endsWith("/npm-install")) {
        installedIn.set(installDirectory(step), shard);
        continue;
      }

      const directory = (step["working-directory"] || ".").replace(/\/+$/, "");

      if (
        (directory === "packages/App" || directory === "ee") &&
        installedIn.get(directory) !== shard
      ) {
        stray.push(
          `${nameOf(step)} (shard ${shard}) runs in ${directory}, installed ${
            installedIn.has(directory)
              ? `in shard ${installedIn.get(directory)}`
              : "nowhere before it"
          }`,
        );
      }
    }

    expect(stray).toEqual([]);
  });

  test("the PostgreSQL client tools are there for the backup suite", () => {
    const toolsAt = suites.findIndex((step) => {
      return (
        /postgresql-client-16/.test(String(step.run || "")) &&
        !step["working-directory"]
      );
    });
    const backup = suites.find((step) => {
      return /PostgresBackupEnginePostgres/.test(String(step.run || ""));
    });

    expect(toolsAt).toBeGreaterThan(-1);
    expect(backup).toBeDefined();
    expect(suites.indexOf(backup)).toBeGreaterThan(toolsAt);
    expect(shardOf(suites[toolsAt])).toBe(shardOf(backup));
  });

  test("a suite the shards share out by name runs each of its tests in exactly one shard", () => {
    // Each suite file, with the steps that run it.
    const stepsRunning = new Map();

    for (const step of suites) {
      for (const file of suiteFilesOf(step)) {
        stepsRunning.set(file, [...(stepsRunning.get(file) || []), step]);
      }
    }

    // Shared out: a step runs only the tests its -t names.
    const shared = [...stepsRunning].filter(([, steps]) => {
      return steps.some((step) => {
        return TEST_NAME_PATTERN.test(String(step.run));
      });
    });

    // The probe results burst suite's nine runs take three shards.
    expect(
      shared.map(([file, steps]) => {
        return [file, steps.map(shardOf)];
      }),
    ).toContainEqual([
      "packages/Common/Tests/Server/Utils/Monitor/ProbeResultsBurstPostgres.test.ts",
      [6, 7, 8],
    ]);

    const misplaced = [];

    for (const [file, steps] of shared) {
      // jest matches -t against each test's whole name, in any case; no -t runs them all.
      const shards = steps.map((step) => {
        const pattern = TEST_NAME_PATTERN.exec(String(step.run));

        return {
          shard: shardOf(step),
          runs: (name) => {
            return !pattern || new RegExp(pattern[1], "i").test(name);
          },
        };
      });

      for (const name of wholeTestNamesOf(file)) {
        const runIn = shards
          .filter((shard) => {
            return shard.runs(name);
          })
          .map((shard) => {
            return shard.shard;
          });

        if (runIn.length !== 1) {
          misplaced.push(`${file}: "${name}" runs in shards [${runIn}]`);
        }
      }
    }

    expect(misplaced).toEqual([]);
  });
});
